import {Router} from 'express';import {z} from 'zod';
import {pool,uid,audit,requestActor,tx} from './db.ts';
import {access,canManage,requireThat} from './auth.ts';
import {generateReportWorkbook} from './report-documents.ts';
import {nextReportOccurrence,reportClockAnchor} from '../shared/report-recurrence.ts';
export const reportSchedules=Router();
const input=z.object({name:z.string().trim().min(1).max(120),report_id:z.string().uuid(),run_at:z.iso.datetime({offset:true}).optional(),time_of_day:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),repeat_kind:z.enum(['once','day','week','month']).default('once'),repeat_interval:z.number().int().min(1).max(365).default(1),month_days:z.array(z.number().int().min(1).max(31)).max(31).optional(),weekdays:z.array(z.number().int().min(1).max(7)).max(7).default([]),time_zone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true}catch{return false}},'无效时区').default('Europe/Helsinki'),version:z.number().int().positive().optional()}).refine(b=>!!b.run_at||!!b.time_of_day,'请选择执行时间');
async function manager(user:string,project:string){requireThat((await pool.query('SELECT 1 FROM users WHERE id=$1 AND active',[user])).rowCount,403,'用户已停用');const a=await access(user,project);requireThat(canManage(a),403,'仅项目管理员可管理定时报表');return a}
async function task(user:string,id:string){const row=(await pool.query('SELECT * FROM report_schedules WHERE id=$1',[z.string().uuid().parse(id)])).rows[0];requireThat(row,404,'任务不存在');return {row,a:await manager(user,row.project_id)}}
reportSchedules.get('/projects/:project/report-schedules',async(req,res)=>{await manager(req.user.id,z.string().uuid().parse(req.params.project));res.json((await pool.query('SELECT s.id,s.name,s.report_id,s.run_at,s.anchor_at,s.repeat_kind,s.repeat_interval,s.weekdays,s.month_days,s.time_zone,s.version,s.status,s.created_by,s.started_at,s.finished_at,s.error,s.filename,s.report_version,r.name AS report_name FROM report_schedules s JOIN report_documents r ON r.id=s.report_id WHERE s.project_id=$1 ORDER BY s.created_at DESC LIMIT 200',[req.params.project])).rows)});
async function save(req:any,res:any,edit=false){
 const a=await manager(req.user.id,z.string().uuid().parse(req.params.project)),b=input.parse(req.body);
 let previous:any;if(edit){previous=(await pool.query('SELECT anchor_at,run_at,time_zone,repeat_kind,month_days FROM report_schedules WHERE id=$1 AND project_id=$2',[z.string().uuid().parse(req.params.id),a.id])).rows[0];requireThat(previous,404,'任务不存在')}
 b.run_at=b.time_of_day?reportClockAnchor(b.time_of_day,b.time_zone,b.repeat_kind,previous?{anchor_at:previous.anchor_at||previous.run_at,time_zone:previous.time_zone,repeat_kind:previous.repeat_kind}:undefined):b.run_at!;
 b.month_days=b.month_days??(previous?.repeat_kind===b.repeat_kind?previous.month_days:[]);
 requireThat(b.repeat_kind!=='month'||req.body.month_days===undefined||!!b.month_days?.length,400,'请选择每月日期');
 requireThat(b.repeat_kind!=='once'||Date.parse(b.run_at!)>Date.now(),400,'请选择未来日期时间');requireThat(b.repeat_kind!=='week'||b.weekdays.length>0,400,'请选择星期');
 requireThat((await pool.query('SELECT 1 FROM report_documents WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL',[b.report_id,a.id])).rowCount,400,'请选择当前项目报表');
 const next=nextReportOccurrence({...b,anchor_at:b.run_at!}),key=edit?z.string().uuid().parse(req.params.id):uid();
 const values=[key,a.id,b.report_id,req.user.id,b.name,next,b.run_at,b.repeat_kind,b.repeat_interval,JSON.stringify([...new Set(b.weekdays)]),b.time_zone,JSON.stringify([...new Set(b.month_days||[])].sort((a,b)=>a-b))];
 if(edit){requireThat(b.version,400,'缺少任务版本');const changed=await pool.query("UPDATE report_schedules SET report_id=$3,created_by=$4,name=$5,run_at=$6,anchor_at=$7,repeat_kind=$8,repeat_interval=$9,weekdays=$10,time_zone=$11,month_days=$12,status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'pending' END,error=NULL,version=version+1 WHERE id=$1 AND project_id=$2 AND status<>'running' AND version=$13 RETURNING id",[...values,b.version]);requireThat(changed.rowCount,409,'任务已变更或正在执行，请刷新')}
 else await pool.query('INSERT INTO report_schedules(id,project_id,report_id,created_by,name,run_at,anchor_at,repeat_kind,repeat_interval,weekdays,time_zone,month_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',values);
 await audit(pool,a.workspace_id,req.user.id,edit?'report.schedule.edit':'report.schedule.create',key,b);res.json({id:key});
}
reportSchedules.post('/projects/:project/report-schedules',(req,res)=>save(req,res));
reportSchedules.put('/projects/:project/report-schedules/:id',(req,res)=>save(req,res,true));
reportSchedules.post('/report-schedules/:id/cancel',async(req,res)=>{const {row,a}=await task(req.user.id,req.params.id);requireThat((await pool.query("UPDATE report_schedules SET status='cancelled',version=version+1 WHERE id=$1 AND status='pending' RETURNING id",[row.id])).rowCount,409,'仅待执行任务可停用');await audit(pool,a.workspace_id,req.user.id,'report.schedule.pause',row.id,{});res.json({ok:true})});
reportSchedules.post('/report-schedules/:id/resume',async(req,res)=>{const {row,a}=await task(req.user.id,req.params.id);const next=nextReportOccurrence({...row,anchor_at:row.anchor_at||row.run_at});requireThat(next,400,'一次性任务已过期，请编辑后设置新时间');requireThat((await pool.query("UPDATE report_schedules SET status='pending',run_at=$2,error=NULL,version=version+1 WHERE id=$1 AND status='cancelled' AND version=$3 RETURNING id",[row.id,next,row.version])).rowCount,409,'任务状态已变更，请刷新');await audit(pool,a.workspace_id,req.user.id,'report.schedule.resume',row.id,{});res.json({ok:true})});
reportSchedules.get('/report-schedules/:id/runs',async(req,res)=>{const {row}=await task(req.user.id,req.params.id);res.json((await pool.query('SELECT id,scheduled_at,started_at,finished_at,status,error,filename,report_version FROM report_schedule_runs WHERE schedule_id=$1 ORDER BY scheduled_at DESC LIMIT 200',[row.id])).rows)});
async function download(req:any,res:any,run=false){let row:any,a:any;if(run){row=(await pool.query('SELECT r.*,s.project_id FROM report_schedule_runs r JOIN report_schedules s ON s.id=r.schedule_id WHERE r.id=$1',[z.string().uuid().parse(req.params.id)])).rows[0];requireThat(row,404,'文件不存在');a=await manager(req.user.id,row.project_id)}else({row,a}=await task(req.user.id,req.params.id));requireThat(row.content,404,'尚无生成文件');await audit(pool,a.workspace_id,req.user.id,'report.schedule.download',row.id,{});res.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`).type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(row.content)}
reportSchedules.get('/report-schedules/:id/download',(req,res)=>download(req,res));
reportSchedules.get('/report-schedule-runs/:id/download',(req,res)=>download(req,res,true));
async function finish(row:any,result?:{buffer:Buffer;name:string;version:number},error?:string){
 const next=row.repeat_kind==='once'?null:nextReportOccurrence({...row,anchor_at:row.anchor_at||row.run_at});
 const filename=result?`${result.name}-${new Date(row.run_at).toISOString().replace(/[:.]/g,'-')}.xlsx`:null;
 await tx(async c=>{
  const current=(await c.query('SELECT status,started_at FROM report_schedules WHERE id=$1 FOR UPDATE',[row.id])).rows[0];if(current?.status!=='running'||String(current.started_at)!==String(row.started_at))return;
  await c.query('INSERT INTO report_schedule_runs(id,schedule_id,scheduled_at,started_at,status,error,filename,content,report_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(schedule_id,scheduled_at) DO NOTHING',[uid(),row.id,row.run_at,row.started_at,result?'succeeded':'failed',error||null,filename,result?.buffer||null,result?.version||null]);
  await c.query("UPDATE report_schedules SET status=$2,run_at=$3,finished_at=now(),error=$4,filename=coalesce($5,filename),content=coalesce($6,content),report_version=coalesce($7,report_version),version=version+1 WHERE id=$1",[row.id,next?'pending':result?'succeeded':'failed',next||row.run_at,error||null,filename,result?.buffer||null,result?.version||null]);
 });
}
let busy=false;
export async function runDueReportSchedules(){if(busy)return;busy=true;try{
 for(const row of (await pool.query("SELECT * FROM report_schedules WHERE status='running' AND started_at<now()-interval '30 minutes'")).rows)await finish(row,undefined,'执行中断');
 for(let i=0;i<5;i++){
  const row=(await pool.query("UPDATE report_schedules SET status='running',started_at=now(),version=version+1 WHERE id=(SELECT id FROM report_schedules WHERE status='pending' AND run_at<=now() ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) AND status='pending' RETURNING *")).rows[0];if(!row)break;
  await requestActor.run(row.created_by,async()=>{try{const a=await manager(row.created_by,row.project_id),result=await generateReportWorkbook(row.created_by,row.report_id,undefined,row.time_zone);requireThat(result.buffer.length<=20*1024*1024,400,'报表超过20MB，请拆分报表');await finish(row,result);await audit(pool,a.workspace_id,row.created_by,'report.schedule.completed',row.id,{scheduled_at:row.run_at,version:result.version})}catch(error:any){await finish(row,undefined,String(error.message||'生成失败').slice(0,500))}});
 }
}finally{busy=false}}
export function startReportScheduler(){const run=()=>runDueReportSchedules().catch(()=>console.error('Report scheduler failed'));void run();setInterval(run,30000).unref()}
