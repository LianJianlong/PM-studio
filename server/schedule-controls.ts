import {cpmReport} from '../shared/cpm-report.ts';import {progressQuality} from '../shared/progress-quality.ts';
import {Router} from 'express';import {z} from 'zod';import {createHash} from 'node:crypto';
import {access,canManage,operationAllowed,requireThat} from './auth.ts';import {requireFullPlanRead} from './planning-read-access.ts';
import {pool,tx,requestTransaction,audit} from './db.ts';import {id,date} from './validation.ts';import {version as appVersion} from './version.ts';
import {effectiveActivities} from './effective-activities.ts';import {readPlanActivities} from './plan-activities.ts';import {lockReferenceProject} from './references.ts';import {schedule} from './schedule.ts';
import {defaultProjectCalendar,calendarDate,calendarHours,workMoment} from '../shared/project-calendar.ts';import {inspectSchedule} from '../shared/plan-inspection.ts';
export const scheduleControls=Router();const path='/projects/:project/schedule-options';
const policy=z.object({baseline_id:id.optional(),comparison_baseline_ids:z.array(id.nullable()).length(3).optional(),data_date:date.optional(),forecast_remaining:z.boolean().default(false),must_finish_by:date.optional(),critical_method:z.enum(['float','longest']).default('float'),critical_threshold:z.number().min(0).max(3650).default(0),near_critical_hours:z.number().int().min(0).max(87600).default(16),path_count:z.number().int().min(1).max(20).default(5),path_end_id:id.optional()}).strict();
async function current(project:string,c:any=pool){return (await c.query('SELECT options,version FROM project_schedule_options WHERE project_id=$1',[project])).rows[0]||{options:{},version:0};}
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function lockedAccess(c:any,user:string,project:string){const initial=await access(user,project,c);await lockReferenceProject(c,project);await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[initial.workspace_id]);await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);const a=await access(user,project,c);await requireFullPlanRead(a,c);return a;}
async function validate(c:any,a:any,options:z.infer<typeof policy>){
 requireThat(Math.abs(options.critical_threshold*(a.calendar_config?.hours_per_day||8)-Math.round(options.critical_threshold*(a.calendar_config?.hours_per_day||8)))<1e-6,400,'关键浮时阈值须为整数工作小时');
 requireThat(!options.forecast_remaining||!!options.data_date,400,'剩余工期重排需要状态日期');
 if(options.baseline_id)requireThat((await c.query('SELECT 1 FROM baselines WHERE id=$1 AND project_id=$2',[options.baseline_id,a.id])).rowCount,400,'基线不属于当前项目');
 const comparisons=(options.comparison_baseline_ids||[]).filter(Boolean);
 requireThat(new Set(comparisons).size===comparisons.length,400,'比较基线不能重复');
 if(comparisons.length)requireThat((await c.query('SELECT id FROM baselines WHERE project_id=$1 AND id=ANY($2::uuid[])',[a.id,comparisons])).rowCount===comparisons.length,400,'基线不属于当前项目');
 if(options.path_end_id)requireThat((await c.query('SELECT 1 FROM activities WHERE id=$1 AND project_id=$2',[options.path_end_id,a.id])).rowCount,400,'路径终点不属于当前项目');
}
async function calculate(c:any,user:string,a:any,options:z.infer<typeof policy>,issuedAt:number){
 await validate(c,a,options);const old=await current(a.id,c),rows=await effectiveActivities(a.id,c),visible=await readPlanActivities(user,a,true,c),calendar=a.calendar_config||defaultProjectCalendar,day=today();
 const before=schedule(rows,calendar,a.start_date,a.progress_method,old.options),after=schedule(rows,calendar,a.start_date,a.progress_method,options);
 const quality=progressQuality(rows,calendar,a.start_date,options.data_date,day),ids=new Set(rows.map(x=>x.id));
 const excluded=visible.filter(x=>!ids.has(x.id)).length;
 if(excluded){quality.items.push({id:'',code:'—',name:'项目',severity:'warning',message:'有可见草稿或未就绪依赖未纳入正式试算，请先核对数据状态'});quality.warning_count++;}
 for(const d of after.constraint_diagnostics.filter(x=>x.blocking)){quality.items.push({id:d.id,code:d.code,name:d.name,severity:'error',message:'强制日期与状态日期、实际历史或工作日历冲突，不能安全重排'});quality.blocking_count++;}
 const previous=new Map(before.activities.map(x=>[x.id,x]));
 const remainingDates=new Map<number,string>();
 const remainingStart=(plan:any,row:any)=>{if(!plan.forecast_remaining||row.actual_finish||Number(row.progress)===100)return null;const begin=Math.max(row.work_es,row.work_ef-row.remaining_duration);if(Math.abs(begin-row.work_es)<1e-7)return calendarDate(a.start_date,row.es);if(remainingDates.has(begin))return remainingDates.get(begin)!;if(begin>=0){const date=calendarDate(a.start_date,workMoment(calendar,a.start_date,begin,'start'));remainingDates.set(begin,date);return date;}let days=7;while(days<60000){const base=calendarDate(a.start_date,-days),count=calendarHours(calendar,base,a.start_date)/calendar.hours_per_day;if(count+begin>=0)return calendarDate(base,workMoment(calendar,base,count+begin,'start'));days*=2;}return null;};
 const changes=after.activities.filter(x=>{const p=previous.get(x.id)!;return (['es','ef','ls','lf','float','critical'] as const).some(k=>x[k]!==p[k])||remainingStart(before,p)!==remainingStart(after,x);}).map(x=>{const p=previous.get(x.id)!;return {id:x.id,code:x.code,name:x.name,before_start:calendarDate(a.start_date,p.es),after_start:calendarDate(a.start_date,x.es),before_finish:calendarDate(a.start_date,p.ef),after_finish:calendarDate(a.start_date,x.ef),before_remaining_start:remainingStart(before,p),after_remaining_start:remainingStart(after,x),finish_change_hours:Math.round((x.work_ef-p.work_ef)*calendar.hours_per_day),before_float_hours:Math.round(p.float*calendar.hours_per_day),after_float_hours:Math.round(x.float*calendar.hours_per_day),actual_start:x.actual_start||null,actual_finish:x.actual_finish||null};});
 const source_hash=createHash('sha256').update(JSON.stringify({appVersion,project:a.id,issuedAt,day,old,rows:[...rows].sort((a,b)=>a.id.localeCompare(b.id)),visible:[...visible].sort((a,b)=>a.id.localeCompare(b.id)),calendar,start:a.start_date,method:a.progress_method,options,quality})).digest('hex');
 return {old,after,quality,changes,source_hash,excluded,issuedAt,before_finish:calendarDate(a.start_date,before.duration_summary.finish_offset),after_finish:calendarDate(a.start_date,after.duration_summary.finish_offset)};
}
scheduleControls.get(path,async(req,res)=>{const a=await access(req.user.id,id.parse(req.params.project));await requireFullPlanRead(a);res.json({...await current(a.id),baselines:(await pool.query('SELECT id,name FROM baselines WHERE project_id=$1 ORDER BY created_at DESC,id DESC',[a.id])).rows,can_edit:canManage(a)&&operationAllowed(a,'$data','update')&&a.lifecycle==='active'&&a.workspace_lifecycle==='active'});});
scheduleControls.post('/projects/:project/schedule-preview',async(req,res)=>{
 const project=id.parse(req.params.project),options=policy.parse(req.body),issued=Date.now();
 const out=await tx(c=>requestTransaction.run(c,async()=>{const a=await lockedAccess(c,req.user.id,project),p=await calculate(c,req.user.id,a,options,issued);return {duration:p.after.work_duration,duration_summary:p.after.duration_summary,finish:p.after.duration,progress:p.after.progress,inspection:inspectSchedule(p.after),cpm_report:cpmReport(p.after),calendar_config:a.calendar_config||defaultProjectCalendar,start_date:a.start_date,schedule_options:options,progress_quality:p.quality,reschedule_changes:p.changes,before_finish:p.before_finish,after_finish:p.after_finish,reforecast_source_hash:p.source_hash,previewed_at:issued,excluded_visible_count:p.excluded};}));res.json(out);
});
scheduleControls.put(path,async(req,res)=>{
 const project=id.parse(req.params.project),body=z.object({options:policy,version:z.number().int().min(0),source_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),previewed_at:z.number().int().optional(),confirm_reforecast:z.boolean().optional(),accept_warnings:z.boolean().optional()}).strict().parse(req.body);
 const result=await tx(c=>requestTransaction.run(c,async()=>{const a=await lockedAccess(c,req.user.id,project);requireThat(canManage(a)&&operationAllowed(a,'$data','update'));requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目非活动状态');
 const old=await current(project,c);requireThat(old.version===body.version,409,'排程设置已更新，请刷新后重试');
 const reforecast=body.options.forecast_remaining&&(!old.options.forecast_remaining||old.options.data_date!==body.options.data_date);
 if(reforecast){requireThat(body.confirm_reforecast===true&&!!body.source_hash&&!!body.previewed_at,400,'启用或调整状态日期重排前，请先试算并确认');requireThat(Date.now()-body.previewed_at!<=600000&&body.previewed_at!<=Date.now()+5000,409,'重排试算已过期，请重新试算');}
 const p=await calculate(c,req.user.id,a,body.options,body.previewed_at||Date.now());
 if(reforecast){requireThat(p.source_hash===body.source_hash,409,'计划数据或排程输入已变化，请重新试算');requireThat(p.quality.blocking_count===0,409,'请先修正进度完整性阻断项，再启用重排');requireThat(!p.quality.warning_count||body.accept_warnings===true,400,'请确认已了解状态日期重排警告');}
 await c.query('INSERT INTO project_schedule_options(project_id,options,version) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET options=EXCLUDED.options,version=EXCLUDED.version,updated_at=now()',[project,JSON.stringify(body.options),old.version+1]);
 await audit(c,a.workspace_id,req.user.id,'更新项目排程设置',project,{before:old.options,after:body.options,reforecast,quality:{blocking:p.quality.blocking_count,warnings:p.quality.warning_count},affected:p.changes.length});return {options:body.options,version:old.version+1,can_edit:true};}));res.json(result);
});
