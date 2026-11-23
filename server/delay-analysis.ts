import {delayEvidence} from '../shared/delay-evidence.ts';
import {createHash} from 'node:crypto';import {version as appVersion} from './version.ts';import {tx,requestTransaction} from './db.ts';import {lockReferenceProject} from './references.ts';
import {Router} from 'express';import {z} from 'zod';import {id,date} from './validation.ts';import {pool} from './db.ts';import {access,requireThat} from './auth.ts';import {readPlanActivities} from './plan-activities.ts';import {schedule} from './schedule.ts';import {defaultProjectCalendar,calendarDate} from '../shared/project-calendar.ts';import {compareScheduleDelay,compareScenario} from '../shared/delay-analysis.ts';
export const delayAnalysis=Router();
const request=z.object({baseline_id:id.optional(),scope:z.enum(['published','preview']).default('published'),mode:z.enum(['current','what_if']).default('current'),data_date:date.optional(),activity_id:id.optional(),trace_activity_id:id.optional(),additional_duration_hours:z.number().int().min(0).max(87600).default(0),start_delay_hours:z.number().int().min(0).max(87600).default(0)}).strict();
delayAnalysis.post('/projects/:project/delay-analysis',async(req,res)=>{
 const project=id.parse(req.params.project),body=request.parse(req.body);
 const result=await tx(c=>requestTransaction.run(c,async()=>{await lockReferenceProject(c,project);const initial=await access(req.user.id,project,c);await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[initial.workspace_id]);await c.query('SELECT id FROM projects WHERE id=$1 FOR SHARE',[project]);const a=await access(req.user.id,project,c);
 const activities=await readPlanActivities(req.user.id,a,body.scope==='preview');
 const policy=(await pool.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[project])).rows[0]?.options||{};
 const calendar=a.calendar_config||defaultProjectCalendar,baselineId=body.baseline_id||policy.baseline_id;
 const baseline=baselineId?(await pool.query('SELECT * FROM baselines WHERE id=$1 AND project_id=$2',[baselineId,project])).rows[0]:(await pool.query('SELECT * FROM baselines WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[project])).rows[0];
 if(baselineId)requireThat(baseline,404,'基线不属于当前项目');
 const current=schedule(activities,calendar,a.start_date,a.progress_method,policy);
 if(body.trace_activity_id)requireThat(current.activities.some(x=>x.id===body.trace_activity_id),404,'作业不在当前可分析范围');
 const warnings:string[]=[];if(!baseline)warnings.push('尚无批准基线，不能计算基线偏差，仍可进行假设分析');
 let scenario:any=null;
 if(body.mode==='what_if'){
  requireThat(body.activity_id,400,'请选择假设分析的作业');requireThat(body.additional_duration_hours>0||body.start_delay_hours>0,400,'至少设置1小时的工期增加或开始推迟');
  const target=activities.find(x=>x.id===body.activity_id);requireThat(target,404,'作业不在当前可分析范围');requireThat(target.activity_type!=='LOE持续性作业',400,'LOE随关联作业变化，请对关联的普通作业试算');requireThat(!target.actual_finish&&Number(target.progress)<100,400,'已完成作业不能假设修改实际历史');
  const dataDate=body.data_date||policy.data_date||new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const forecastPolicy={...policy,forecast_remaining:true,data_date:dataDate};
  const before=schedule(activities,calendar,a.start_date,a.progress_method,forecastPolicy),reference=before.activities.find(x=>x.id===target.id)!;
  const modified=activities.map(x=>x.id!==target.id?x:{...x,remaining_duration:reference.remaining_duration+body.additional_duration_hours/calendar.hours_per_day,start_offset:Math.max(Number(x.start_offset||0),reference.work_ef-reference.remaining_duration+body.start_delay_hours/calendar.hours_per_day)});
  requireThat(Number(modified.find(x=>x.id===target.id)!.remaining_duration)<=3650,400,'假设后的剩余工期超过3650工作日');
  const after=schedule(modified,calendar,a.start_date,a.progress_method,forecastPolicy);
  const end=(p:any)=>p.duration_summary.finish_offset;
  scenario={data_date:dataDate,before_finish:calendarDate(a.start_date,end(before)),after_finish:calendarDate(a.start_date,end(after)),project_delay_hours:Math.round((Math.max(0,...after.activities.map(x=>x.work_ef))-Math.max(0,...before.activities.map(x=>x.work_ef)))*calendar.hours_per_day),calendar_delay_days:Math.floor(end(after))-Math.floor(end(before)),affected:compareScenario(before,after,a.start_date,calendar.hours_per_day),logic_violations:after.logic_violations,critical_paths:after.critical_paths};
  if(target.constraint_type==='强制开始'||target.constraint_type==='强制完成')warnings.push('强制日期可能抵消假设推迟，请同时检查逻辑冲突');
 }
 const evidence=delayEvidence(current,baseline,a.start_date,calendar,body.trace_activity_id);
 if(baseline&&!evidence.supported)warnings.push('基线快照缺少作业信息，不能可靠比较关键路线');
 if(current.historical_logic_violations?.length)warnings.push('存在历史逻辑冲突，当前驱动追踪不代表历史实际日期满足逻辑');
 if(evidence.trace.truncated)warnings.push('追踪超过显示上限，请选择具体作业缩小范围');
 return {scope:body.scope,baseline_id:baseline?.id||null,baseline_name:baseline?.name||null,hours_per_day:calendar.hours_per_day,duration_summary:current.duration_summary,rows:compareScheduleDelay(current,baseline,a.start_date,calendar.hours_per_day),paths:current.critical_paths,logic_violations:current.logic_violations,warnings,scenario,evidence,analyzed_at:new Date().toISOString(),analysis_fingerprint:createHash('sha256').update(JSON.stringify({appVersion,project,body,activities,baseline,calendar,start:a.start_date,policy})).digest('hex'),read_only:true};
 }));res.json(result);
});
