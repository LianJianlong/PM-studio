import {Router,type RequestHandler} from 'express';
import {pool} from './db.ts';
import {isSystemAdmin,workspaceOwner,requireThat} from './auth.ts';
import {z} from 'zod';
import {mkdir,realpath,stat,rename,unlink,chmod,open} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const operationRecorder:RequestHandler=(req,res,next)=>{
 res.once('finish',()=>{if(!req.user)return;const url=req.path;const project=url.match(/\/projects\/([a-f0-9-]{36})(?:\/|$)/)?.[1]||null;const workspace=url.match(/\/workspaces\/([a-f0-9-]{36})(?:\/|$)/)?.[1]||null;
 const table=url.match(/\/tables\/([a-f0-9-]{36})(?:\/|$)/)?.[1]||null,record=url.match(/\/records\/([a-f0-9-]{36})(?:\/|$)/)?.[1]||null,approval=url.match(/\/approvals\/([a-f0-9-]{36})(?:\/|$)/)?.[1]||null;
 void pool.query(`WITH scope AS (SELECT COALESCE($4::uuid,(SELECT project_id FROM data_tables WHERE id=$9),(SELECT t.project_id FROM records r JOIN data_tables t ON t.id=r.table_id WHERE r.id=$10),(SELECT project_id FROM approvals WHERE id=$11)) AS project_id) INSERT INTO operation_events(actor_id,username,workspace_id,project_id,method,path,status,address) SELECT $1,$2,COALESCE($3::uuid,(SELECT workspace_id FROM projects WHERE id=scope.project_id)),scope.project_id,$5,$6,$7,$8 FROM scope`,[req.user.id,req.user.username,workspace,project,req.method,url.slice(0,1000),res.statusCode,req.ip,table,record,approval]).catch(()=>console.error('Operation audit write failed'));
 });next();
};
export async function backupDirectory(value:string){
 requireThat(path.isAbsolute(value)&&value!==path.parse(value).root,400,'请填写独立备份文件夹的绝对路径');
 const requested=path.resolve(value);
 if(process.platform==='darwin'&&requested.startsWith('/Volumes/')){
   const volume='/Volumes/'+requested.split('/')[2];
   const mounted=await stat(volume).catch(()=>null);
   requireThat(mounted&&mounted.dev!==(await stat('/Volumes')).dev,409,'备份磁盘未挂载，请挂载后再试');
 }
 await mkdir(requested,{recursive:true,mode:0o700});
 const dir=await realpath(requested),app=await realpath(process.cwd());
 requireThat(dir!==app&&!dir.startsWith(app+path.sep),400,'备份目录应位于软件文件夹之外');
 const info=await stat(dir);
 requireThat(process.platform==='win32'||(info.uid===process.getuid?.()&&(info.mode&0o022)===0),400,'备份文件夹须归当前服务用户所有，且不能向其他用户开放写权限');
 return dir;
}
let running=false;
export async function runDatabaseBackup(){
 requireThat(!running,409,'已有备份正在执行');running=true;const c=await pool.connect().catch(e=>{running=false;throw e;});let run:any,temp:string|undefined;
 try{const locked=(await c.query('SELECT pg_try_advisory_lock(90904001) AS ok')).rows[0].ok;requireThat(locked,409,'已有备份正在执行');const settings=(await c.query('SELECT * FROM database_backup_settings WHERE singleton')).rows[0];const directory=await backupDirectory(settings.directory);run=(await c.query("INSERT INTO database_backup_runs(status) VALUES('running') RETURNING id")).rows[0];const file=path.join(directory,`project-studio-${new Date().toISOString().replace(/[:.]/g,'-')}-${run.id}.dump`);temp=file+'.partial';const prepared=await open(temp,'wx',0o600);await prepared.close();
 const u=new URL(process.env.DATABASE_URL!);const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1))};
 await exec(process.env.PG_DUMP_BIN||'pg_dump',['--format=custom','--no-password','--file',temp],{env,timeout:30*60*1000,maxBuffer:1024*1024});
 await chmod(temp,0o600);
 await exec(process.env.PG_RESTORE_BIN||'pg_restore',['--list',temp],{timeout:60000,maxBuffer:4*1024*1024});await rename(temp,file);const size=(await stat(file)).size;await c.query("UPDATE database_backup_runs SET status='success',filename=$1,bytes=$2,finished_at=now() WHERE id=$3",[file,size,run.id]);const old=(await c.query("SELECT id,filename FROM database_backup_runs WHERE status='success' AND retained AND id<>$1 ORDER BY id DESC",[run.id])).rows.filter(r=>r.filename&&path.dirname(r.filename)===directory&&/^project-studio-[0-9TZ.:-]+-\d+\.dump$/.test(path.basename(r.filename))).slice(settings.retention-1);
 for(const item of old){await unlink(item.filename).catch(e=>{if(e.code!=='ENOENT')throw e;});await c.query('UPDATE database_backup_runs SET retained=false WHERE id=$1',[item.id]);}
 return {filename:file,bytes:size};
 }catch(e){if(temp)await unlink(temp).catch(()=>{});if(run)await c.query("UPDATE database_backup_runs SET status='failed',error=$1,finished_at=now() WHERE id=$2",['备份失败，请检查目录权限、磁盘空间和数据库连接',run.id]);throw Error('数据库备份失败，请检查目录权限、磁盘空间和数据库连接');}
 finally{await c.query("UPDATE database_backup_settings SET next_run=now()+interval_minutes*interval '1 minute' WHERE singleton AND enabled").catch(()=>{});await c.query('SELECT pg_advisory_unlock(90904001)').catch(()=>{});c.release();running=false;}
}
export function startBackupScheduler(){const timer=setInterval(()=>{if(running)return;void pool.query('SELECT 1 FROM database_backup_settings WHERE singleton AND enabled AND (next_run IS NULL OR next_run<=now())').then(r=>{if(r.rowCount)return runDatabaseBackup();}).catch(()=>console.error('Scheduled database backup failed'));},30000);timer.unref();}
export const securityConsole=Router();
securityConsole.get('/workspaces/:workspace/operation-events',async(req,res)=>{requireThat(await workspaceOwner(req.user.id,req.params.workspace as string));const system=await isSystemAdmin(req.user.id);const page=z.coerce.number().int().min(1).default(1).parse(req.query.page);const search=z.string().max(100).default('').parse(req.query.search);const project=z.uuid().optional().parse(req.query.project_id);const params=[req.params.workspace,system,project||null,`%${search}%`];const where="($2 OR workspace_id=$1::uuid) AND ($3::uuid IS NULL OR project_id=$3::uuid) AND (username ILIKE $4 OR path ILIKE $4)";res.json({rows:(await pool.query(`SELECT * FROM operation_events WHERE ${where} ORDER BY id DESC LIMIT 50 OFFSET ${(page-1)*50}`,params)).rows,total:(await pool.query(`SELECT count(*)::int AS n FROM operation_events WHERE ${where}`,params)).rows[0].n,page});});
securityConsole.use('/system/database-backup',async(req,_res,next)=>{requireThat(await isSystemAdmin(req.user.id));next();});
securityConsole.get('/system/database-backup',async(_req,res)=>res.json({database:(await pool.query('SELECT current_database() AS name,inet_server_addr()::text AS address,inet_server_port() AS port')).rows[0],settings:(await pool.query('SELECT * FROM database_backup_settings WHERE singleton')).rows[0],runs:(await pool.query('SELECT * FROM database_backup_runs ORDER BY id DESC LIMIT 30')).rows,running}));
securityConsole.put('/system/database-backup',async(req,res)=>{const b=z.object({enabled:z.boolean(),directory:z.string().trim().min(1).max(1000),retention:z.union([z.literal(1),z.literal(3),z.literal(5)]).default(5),interval_minutes:z.number().int().min(15).max(525600)}).strict().parse(req.body);const dir=await backupDirectory(b.directory);await pool.query("UPDATE database_backup_settings SET enabled=$1,directory=$2,interval_minutes=$3,retention=$4,next_run=CASE WHEN $1 THEN now()+$3::integer*interval '1 minute' ELSE NULL END,updated_at=now() WHERE singleton",[b.enabled,dir,b.interval_minutes,b.retention]);res.json({ok:true});});
securityConsole.post('/system/database-backup/run',async(_req,res)=>res.json(await runDatabaseBackup()));
