import {Router} from 'express';import {z} from 'zod';import {createHash} from 'node:crypto';
import {pool,tx,requestTransaction,audit} from './db.ts';import {id} from './validation.ts';
import {access,tableAccess,canRecordAction,rowAllowed,requireThat,operationAllowed} from './auth.ts';
import {readPlanActivities} from './plan-activities.ts';import {requireFullPlanRead} from './planning-read-access.ts';
import {updateRecord} from './data.ts';import {applyResourceChange} from './resource-changes.ts';
import {durationTypes,planningProgress} from '../shared/p6-planning.ts';import {durationLink} from '../shared/duration-types.ts';
import {inProgress,remainingDays} from '../shared/remaining-resources.ts';import {resourceText,resourceTicks} from '../shared/resource-values.ts';
import {editableRecord} from '../shared/record-policy.ts';import {lockReferenceProject} from './references.ts';
import {remainingWindow,currentPlanDate} from './remaining-plan.ts';import {schedule} from './schedule.ts';import {defaultProjectCalendar,calendarDate} from '../shared/project-calendar.ts';
export const durationLinks=Router();const path='/projects/:project/duration-link';
const proposal=z.object({activity_id:id,type:z.enum(durationTypes),driver:z.enum(['duration','rate','units']),value:z.string().max(40),target:id,source_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirm:z.boolean().optional()}).strict();
durationLinks.get(path,async(req,res)=>{
 const a=await access(req.user.id,id.parse(req.params.project)),calendar=a.calendar_config||defaultProjectCalendar,activities=await readPlanActivities(req.user.id,a,true);
 const policy=(await pool.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[a.id])).rows[0]?.options||{};
 res.json({hours_per_day:calendar.hours_per_day,data_date:policy.data_date||currentPlanDate(),forecast_enabled:!!policy.forecast_remaining,activities:activities.filter(x=>x.activity_type!=='LOE持续性作业'&&Number(x.duration)>0&&!x.actual_finish&&Number(x.progress)<100).map(x=>({id:x.id,code:x.code,name:x.name,activity_type:x.activity_type||'任务',duration:Number(x.duration),remaining_duration:remainingDays(x,calendar.hours_per_day),phase:inProgress(x)?'remaining':'planned',progress:Number(x.progress),duration_type:x.duration_type||durationTypes[0]}))});
});
durationLinks.get(path+'/:activity/resources',async(req,res)=>{
 const a=await access(req.user.id,id.parse(req.params.project)),key=id.parse(req.params.activity),rows=await readPlanActivities(req.user.id,a,true);requireThat(rows.some(x=>x.id===key),404,'作业不在当前可查看计划范围');
 res.json((await pool.query('SELECT x.id,r.name,r.unit,x.quantity::text,v.quantity::text remaining_quantity FROM activity_resource_allocations x JOIN project_resources r ON r.id=x.resource_id AND r.project_id=$2 LEFT JOIN activity_resource_remaining v ON v.allocation_id=x.id WHERE x.activity_id=$1 ORDER BY x.id',[key,a.id])).rows);
});
async function prepare(c:any,user:string,project:string,b:z.infer<typeof proposal>){
 let a=await access(user,project,c);
 await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[a.workspace_id]);await c.query('SELECT id FROM projects WHERE id=$1 FOR SHARE',[project]);a=await access(user,project,c);await requireFullPlanRead(a,c);
 requireThat(operationAllowed(a,'$data','read'),403,'没有资源读取权限');
 const record=(await c.query(`SELECT r.* FROM records r JOIN plan_activity_records l ON l.record_id=r.id JOIN activities x ON x.id=l.activity_id JOIN plan_data_tables p ON p.table_id=r.table_id AND p.project_id=x.project_id WHERE x.id=$1 AND x.project_id=$2 FOR UPDATE OF r`,[b.activity_id,project])).rows[0];requireThat(record,404,'未找到此项目的原生作业记录');
 const {table,permission}=await tableAccess(user,record.table_id,c);requireThat(rowAllowed(permission,record,user),403,'没有此作业的数据权限');requireThat(record.lifecycle==='active'&&record.status!=='obsolete',409,'作业记录不可使用');
 const visible=await readPlanActivities(user,a,true,c),source=visible.find(x=>x.id===b.activity_id);requireThat(source,404,'此作业不在当前可查看计划范围');
 requireThat(record.data.activity_type!=='LOE持续性作业',400,'LOE工期由关联作业决定，不使用固定工期联动');requireThat(!['开始里程碑','完成里程碑'].includes(record.data.activity_type)&&Number(record.data.duration)>0,400,'里程碑不分配资源，请选择普通作业');
 requireThat(!record.data.actual_finish&&Number(source.progress)<100,409,'已完成作业不再调整剩余资源');
 const phase=inProgress(source)?'remaining':'planned',calendar=a.calendar_config||defaultProjectCalendar;
 const policyRow=(await c.query('SELECT options,version FROM project_schedule_options WHERE project_id=$1 FOR SHARE',[project])).rows[0]||{options:{},version:0},dataDate=policyRow.options.data_date||currentPlanDate();
 const activity=(await c.query('SELECT * FROM activities WHERE id=$1 AND project_id=$2 FOR UPDATE',[b.activity_id,project])).rows[0];
 const allocations=(await c.query(`SELECT x.id,x.resource_id,x.quantity::text,x.planned_cost::text,x.actual_cost::text,x.version,r.version resource_version,r.name,r.unit,r.rate::text,r.currency,r.active,v.quantity::text remaining_quantity,v.version remaining_version,v.as_of_date FROM activity_resource_allocations x JOIN project_resources r ON r.id=x.resource_id AND r.project_id=$2 LEFT JOIN activity_resource_remaining v ON v.allocation_id=x.id WHERE x.activity_id=$1 ORDER BY x.id FOR UPDATE OF x FOR SHARE OF r`,[activity.id,project])).rows;
 requireThat(allocations.length>0,400,'请先为作业分配资源');requireThat(allocations.every((x:any)=>x.active&&x.currency===a.currency),409,'资源已停用或币种与项目不同');
 const beforeDuration=phase==='remaining'?remainingDays(source,calendar.hours_per_day):Number(activity.duration);requireThat(beforeDuration>0,400,'剩余工期为0，请先在作业表核对剩余工期');
 let calculated;try{calculated=durationLink({type:b.type,driver:b.driver,value:b.value,duration:beforeDuration,hoursPerDay:calendar.hours_per_day,target:b.target,allocations:allocations.map((x:any)=>({...x,quantity:phase==='remaining'?(x.remaining_quantity??x.quantity):x.quantity}))});}catch(e){requireThat(false,400,(e as Error).message);throw e}
 const afterProgress=planningProgress({...record.data,duration:phase==='remaining'?Number(activity.duration):calculated.duration,remaining_duration:calculated.duration},Number(record.data.progress));
 const before=schedule(visible,calendar,a.start_date,a.progress_method,{...policyRow.options,forecast_remaining:true,data_date:dataDate});
 const after=schedule(visible.map(x=>x.id===activity.id?{...x,duration:phase==='planned'?calculated.duration:Number(activity.duration),remaining_duration:calculated.duration,progress:afterProgress}:x),calendar,a.start_date,a.progress_method,{...policyRow.options,forecast_remaining:true,data_date:dataDate});
 const rows=calculated.rows.map(row=>{const original=allocations.find((x:any)=>x.id===row.id);return {...row,name:original.name,unit:original.unit,plan_quantity:original.quantity,original_planned_cost:original.planned_cost,actual_cost:original.actual_cost,forecast_total_cost:resourceText(resourceTicks(original.actual_cost)+resourceTicks(row.planned_cost))}});
 const forecast={window_valid:remainingWindow(after.activities.find(x=>x.id===activity.id)!,calendar,a.start_date,dataDate).valid,target_before_finish:calendarDate(a.start_date,before.activities.find(x=>x.id===activity.id)!.ef),target_after_finish:calendarDate(a.start_date,after.activities.find(x=>x.id===activity.id)!.ef),data_date:dataDate,enabled:!!policyRow.options.forecast_remaining,before_finish:calendarDate(a.start_date,before.duration_summary.finish_offset),after_finish:calendarDate(a.start_date,after.duration_summary.finish_offset),affected:after.activities.filter(x=>{const old=before.activities.find(y=>y.id===x.id);return old&&Math.abs(x.ef-old.ef)>1e-7}).length};
 const source_hash=createHash('sha256').update(JSON.stringify({project,record:{id:record.id,data:record.data,version:record.version,status:record.status},activity,allocations,calendar,policyRow,dataDate,input:{type:b.type,driver:b.driver,value:b.value,target:b.target},calculated,phase,forecast})).digest('hex');
 const can_apply=canRecordAction(permission,table,'update')&&operationAllowed(a,'$data','update')&&editableRecord(table,record.status)&&a.lifecycle==='active'&&a.workspace_lifecycle==='active'&&table.lifecycle==='active';
 return {a,table,record,activity,allocations,calculated:{...calculated,rows},source_hash,can_apply,phase,beforeDuration,afterProgress,forecast};
}
durationLinks.post(path+'/preview',async(req,res)=>{
 const project=id.parse(req.params.project),b=proposal.parse(req.body);const p=await tx(async c=>{await lockReferenceProject(c,project);return prepare(c,req.user.id,project,b)});
 const warnings=[p.phase==='remaining'?'本轮仅调整剩余工期和剩余资源，不改原计划工期、计划分配数量、实际日期、实际费用或批准基线。':'未开工作业更新计划工期和分配数量；确认后记录回到草稿。','主管确认有效后参与正式资源、费用及预测；不同资源单位分别计算，不能混加。','推算工期向上取整至工作小时，投入率保留4位小数；请核对舍入后的工作量及费用。'];
 if(p.phase==='planned'&&p.allocations.some((x:any)=>x.remaining_quantity!=null))warnings.push('已有剩余分配预测将重置，按新的未开工计划重新估算。');
 if(!p.forecast.window_valid)warnings.push('强制日期无法容纳状态日期之后的剩余工作，请先核对排程检查；未排入的工作不会伪造负荷日期。');
 if(p.phase==='remaining'&&!p.record.data.actual_start)warnings.push('已报告进度但尚未填写实际开始；本次仅估算剩余工作，不推定已发生工量。');
 if(p.afterProgress!==Number(p.record.data.progress))warnings.push('当前采用工期完成率，剩余工期变化会按现有公式改变完成率；请核对下方前后值。');
 if(p.phase==='remaining'&&!p.forecast.enabled)warnings.push('尚未启用按剩余工期重排，横道图原计划不变；可在排程设置启用，剩余预测仍可查看。');
 res.json({source_hash:p.source_hash,can_apply:p.can_apply,phase:p.phase,before_duration:p.beforeDuration,original_duration:Number(p.activity.duration),before_progress:Number(p.record.data.progress),after_progress:p.afterProgress,forecast:p.forecast,...p.calculated,warnings});
});
durationLinks.post(path+'/apply',async(req,res)=>{
 const project=id.parse(req.params.project),b=proposal.parse(req.body);requireThat(b.confirm===true&&!!b.source_hash,400,'请先预览并确认联动结果');
 const result=await tx(async c=>requestTransaction.run(c,async()=>{
  await lockReferenceProject(c,project);const p=await prepare(c,req.user.id,project,b);requireThat(p.can_apply,403,'没有此作业的修改权限或记录不可编辑');requireThat(p.source_hash===b.source_hash,409,'作业、资源或预览输入已变化，请重新预览');
  await updateRecord(req.user.id,p.record.id,{version:p.record.version,data:{duration_type:b.type,...(p.phase==='planned'?{duration:p.calculated.duration}:{}),remaining_duration:p.calculated.duration}});
  if(p.phase==='remaining')for(const row of p.calculated.rows)await c.query(`INSERT INTO activity_resource_remaining(allocation_id,quantity,as_of_date,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(allocation_id) DO UPDATE SET quantity=excluded.quantity,as_of_date=excluded.as_of_date,updated_by=excluded.updated_by,version=activity_resource_remaining.version+1,updated_at=now()`,[row.id,row.quantity,p.forecast.data_date,req.user.id]);
  else{for(const row of p.calculated.rows){const old=p.allocations.find((x:any)=>x.id===row.id)!;const fresh=(await c.query('SELECT version FROM activity_resource_allocations WHERE id=$1',[row.id])).rows[0];await applyResourceChange(c,req.user.id,project,{activity_id:p.activity.id,resource_id:old.resource_id,version:fresh.version,quantity:row.quantity,actual_cost:old.actual_cost,reason:'工期类型联动确认'});}await c.query('DELETE FROM activity_resource_remaining WHERE allocation_id=ANY($1::uuid[])',[p.allocations.map((x:any)=>x.id)]);}
  await audit(c,p.a.workspace_id,req.user.id,'确认工期资源联动',p.activity.id,{phase:p.phase,type:b.type,driver:b.driver,before_duration:p.beforeDuration,after_duration:p.calculated.duration,resources:p.calculated.rows.map(row=>({name:row.name,before:row.before_quantity,after:row.quantity})),data_date:p.forecast.data_date});
  return {ok:true,status:'draft',phase:p.phase,duration:p.calculated.duration};
 }));res.json(result);
});
