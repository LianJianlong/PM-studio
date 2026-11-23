import {calendarDate,calendarHours,calendarPeriods,type ProjectCalendar} from './project-calendar.ts';
import type {ScheduleOptions} from './p6-planning.ts';
export const constraintTypes=['尽早开始','开始不早于','开始不晚于','完成不早于','完成不晚于','开始于','完成于','强制开始','强制完成'] as const;
export function constraintDiagnostics(activities:any[],calendar:ProjectCalendar,start:string,policy:ScheduleOptions={},violations:any[]=[]){
 const offsets=new Map<string,number>(),related=new Map<string,any[]>();
 for(const edge of violations)for(const id of [edge.predecessor,edge.successor]){if(!related.has(id))related.set(id,[]);related.get(id)!.push(edge);}
 const offset=(date:string,finish=false)=>{const target=finish?calendarDate(date,1):date;if(offsets.has(target))return offsets.get(target)!;const value=(target>=start?calendarHours(calendar,start,target):-calendarHours(calendar,target,start))/calendar.hours_per_day;offsets.set(target,value);return value;};
 return activities.filter(a=>a.constraint_type&&a.constraint_type!=='尽早开始'&&a.constraint_date).map(a=>{
  const type=String(a.constraint_type),date=String(a.constraint_date),finish=type.startsWith('完成')||type==='强制完成',hard=type.startsWith('强制'),bound=offset(date,finish),event=finish?a.work_ef:a.work_es;
  const lower=type.includes('不早于'),upper=type.includes('不晚于'),actual=finish?a.actual_finish:a.actual_start;
  const gap=lower?Math.max(0,bound-event):upper?Math.max(0,event-bound):Math.abs(event-bound);
  const actualConflict=!!actual&&(lower?actual<date:upper?actual>date:actual!==date);
  const nonWorking=!calendarPeriods(calendar,date).length,messages:string[]=[];
  if(actualConflict)messages.push('约束与已填报实际日期冲突，实际历史保持不变');
  if(nonWorking)messages.push(hard?'强制日期落在非工作日，无法精确落位，请调整日期或项目日历':'约束日期落在非工作日，按项目工作边界换算');
  if(gap>1e-7)messages.push(hard?'强制约束未生效，实际历史保持不变':'当前早日期未满足约束，软约束不会强行破坏前置逻辑');
  const logic=related.get(a.id)||[];
  if(logic.length)messages.push('关联逻辑关系存在冲突，请核对强制日期与实际日期');
  let remainingConflict=false;
  if(policy.forecast_remaining&&policy.data_date&&!a.actual_finish&&Number(a.progress)<100){
   const remaining=Number(a.remaining_duration),begin=Math.max(a.work_es,a.work_ef-remaining),status=offset(policy.data_date);
   remainingConflict=remaining>0&&(begin<status-1e-7||a.work_ef-begin<remaining-1e-7);
   if(remainingConflict)messages.push('状态日期之后无法容纳剩余工期，请核对强制日期');
  }
  if(a.float< -1e-7)messages.push('存在负浮时，当前逻辑与目标日期不能同时满足');
  return {id:a.id,code:a.code,name:a.name,type,date,kind:hard?'hard':'soft',phase:hard?'fixed':lower?'early':upper?'late':'both',
   actual_conflict:actualConflict,non_working:nonWorking,remaining_conflict:remainingConflict,logic_conflicts:logic.length,
   shortfall_hours:Math.max(0,Math.ceil(gap*calendar.hours_per_day-1e-7)),total_float_hours:Math.round(a.float*calendar.hours_per_day*1e6)/1e6,
   blocking:hard&&(actualConflict||nonWorking||remainingConflict),messages,status:messages.length?'warning':'satisfied'};
 });
}
