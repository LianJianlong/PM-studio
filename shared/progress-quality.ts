import {isLoe} from './loe.ts';import {calendarDate,calendarPeriods,workMoment,type ProjectCalendar} from './project-calendar.ts';
export type ProgressIssue={id:string;code:string;name:string;severity:'error'|'warning'|'info';message:string};
export function progressQuality(activities:any[],calendar:ProjectCalendar,start?:string,dataDate?:string,today?:string){
 const items:ProgressIssue[]=[],byId=new Map(activities.map(a=>[a.id,a]));
 const add=(a:any,severity:ProgressIssue['severity'],message:string)=>items.push({id:a?.id||'',code:a?.code||'—',name:a?.name||'项目',severity,message});
 if(!dataDate)add(null,'info','尚未设置状态日期，无法核对进度截止边界');
 if(dataDate&&start&&dataDate<start)add(null,'warning','状态日期早于项目起点，未开始作业仍不会早于项目起点');
 if(dataDate&&today&&dataDate>today)add(null,'warning','状态日期晚于今天，请确认这是计划预测而非已发生实绩');
 if(dataDate&&!calendarPeriods(calendar,dataDate).length)add(null,'warning','状态日期为非工作日，剩余工作从后续可用工作时段开始');
 for(const a of activities){
  const progress=Number(a.progress),duration=Number(a.duration),remaining=a.remaining_duration==null?null:Number(a.remaining_duration);
  if(a.actual_finish&&!a.actual_start)add(a,'error','填写实际完成前，请填写实际开始');
  if(a.actual_start&&a.actual_finish&&a.actual_finish<a.actual_start)add(a,'error','实际完成不能早于实际开始');
  if(dataDate&&a.actual_start&&a.actual_start>dataDate)add(a,'error','实际开始晚于状态日期');
  if(dataDate&&a.actual_finish&&a.actual_finish>dataDate)add(a,'error','实际完成晚于状态日期');
  if(start&&a.actual_start&&a.actual_start<start)add(a,'warning','实际开始早于项目起点，请核对项目起点与历史记录');
  if(!Number.isFinite(progress)||progress<0||progress>100)add(a,'error','完成率无效');
  if(isLoe(a))continue;
  if(progress>0&&!a.actual_start)add(a,'error','已报告进度但未填写实际开始');
  if(progress===100&&!a.actual_finish)add(a,'error','完成率为100%但未填写实际完成');
  if(duration===0&&progress<100&&(progress>0||a.actual_start))add(a,'error','里程碑已有实绩但未完成，请核对实际日期与完成率');
  if(a.actual_finish&&progress!==100)add(a,'error','已填写实际完成日期，完成率须为100%');
  if(remaining!==null&&(!Number.isFinite(remaining)||remaining<0))add(a,'error','剩余工期无效');
  if(remaining!==null&&Number.isFinite(remaining)&&Math.abs(remaining*calendar.hours_per_day-Math.round(remaining*calendar.hours_per_day))>1e-6)add(a,'error','剩余工期须为整数工作小时，请修正后重排');
  if((progress===100||a.actual_finish)&&remaining!==null&&remaining>0)add(a,'error','已完成作业的剩余工期须为0');
  if(progress<100&&!a.actual_finish&&duration>0&&remaining===0)add(a,'error','未完成作业的剩余工期为0');
  if(progress<100&&duration>0&&remaining===null&&(progress>0||a.actual_start))add(a,'warning','未填写剩余工期，重排将按原工期与完成率估算');
  if(a.actual_start&&!a.actual_finish)for(const d of a.predecessors||[]){const pred=byId.get(d.id);if(d.type==='FS'&&pred&&!pred.actual_finish&&Number(pred.progress)<100){add(a,'warning','已开工作业仍有未完成前置，保留逻辑会约束其剩余工作');break;}}
 }
 const anchor=dataDate&&start&&dataDate<start?start:dataDate;
 return {data_date:dataDate||null,effective_work_date:anchor?calendarDate(anchor,workMoment(calendar,anchor,0,'start')):null,items,blocking_count:items.filter(i=>i.severity==='error').length,warning_count:items.filter(i=>i.severity==='warning').length};
}
