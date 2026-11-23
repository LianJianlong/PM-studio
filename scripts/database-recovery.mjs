import pg from 'pg';
import {lstat,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import path from 'node:path';

const [mode,input,requested]=process.argv.slice(2);
const exec=promisify(execFile);
const bin=process.env.STUDIO_PG_BIN||'';
let client, restored, name, created=false, succeeded=false;
try{
 if(!['verify','restore-new'].includes(mode)||!input||mode==='restore-new'&&!requested)
   throw Error('用法：node --env-file=.env.migrate scripts/database-recovery.mjs verify <备份.dump>，或 restore-new <备份.dump> <studio_recovery_名称>');
 name=requested||'studio_recovery_'+Date.now()+'_'+randomBytes(3).toString('hex');
 if(!/^studio_recovery_[a-z0-9_]{1,40}$/.test(name))throw Error('恢复目标必须是新的 studio_recovery_ 开头的数据库名');
 const file=await realpath(input), info=await lstat(file);
 if(!info.isFile()||!file.endsWith('.dump'))throw Error('请指定受信任的 PostgreSQL .dump 文件');
 const u=new URL(process.env.DATABASE_URL);
 const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:name};
 await exec(path.join(bin,'pg_restore'),['--list',file],{timeout:60_000,maxBuffer:8*1024*1024});
 client=new pg.Client({connectionString:u.toString()});await client.connect();
 const {rows}=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name]);
 if(rows.length)throw Error('恢复目标已存在。请选择全新的数据库名');
 await client.query('CREATE DATABASE '+name+' TEMPLATE template0');created=true;
 await client.query('REVOKE CONNECT ON DATABASE '+name+' FROM PUBLIC');
 await exec(path.join(bin,'pg_restore'),['--dbname',name,'--no-password','--no-owner',...(mode==='verify'?['--no-acl']:[]),'--exit-on-error','--single-transaction',file],{env,timeout:30*60_000,maxBuffer:8*1024*1024});
 u.pathname='/'+name;
 restored=new pg.Client({connectionString:u.toString()});await restored.connect();
 const counts=(await restored.query('SELECT (SELECT count(*) FROM workspaces)::int AS workspaces,(SELECT count(*) FROM projects)::int AS projects,(SELECT count(*) FROM data_tables)::int AS tables,(SELECT count(*) FROM records)::int AS records')).rows[0];
 console.log(JSON.stringify({verified:true,counts,...mode==='restore-new'?{database:name}:{}}));
 succeeded=true;
}catch(e){
 const message=String(e?.message||'');
 console.error(message.startsWith('Command failed:')?'备份校验或恢复失败，请确认备份版本、数据库权限与环境配置。':message.split('\n')[0].replace(/postgres(?:ql)?:\/\/\S+/gi,'[连接已隐藏]'));
 process.exitCode=1;
}finally{
 if(restored)await restored.end().catch(()=>{});
 if(created&&(mode==='verify'||!succeeded))await client.query('DROP DATABASE '+name+' WITH (FORCE)').catch(()=>{console.error('无法移除恢复演练用数据库：'+name);process.exitCode=1;});
 if(client)await client.end().catch(()=>{});
}
