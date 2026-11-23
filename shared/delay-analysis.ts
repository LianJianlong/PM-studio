import {calendarDate} from './project-calendar.ts';
function wholeSignedHours(value:number){return Math.sign(value)*Math.ceil(Math.abs(value)-1e-7);}
function edges(value:any[]=[]){return JSON.stringify(value.map(d=>`${d.id}:${d.type}:${d.lag}`).sort());}
export function compareScheduleDelay(current:any,baseline:any,start:string,hoursPerDay:number){
 if(!baseline)return [];
 const snapshot=baseline.snapshot||{},origin=(Date.parse(snapshot.start_date||start)-Date.parse(start))/86400000;
 const original=new Map<string,any>((snapshot.activities||[]).map((a:any)=>[a.id,a]));
 const rows=current.activities.map((a:any)=>{const old=original.get(a.id),reasons:string[]=[];
  if(!old)reasons.push('新增作业，无对应基线');
  else{
   if(Number(a.original_duration??a.duration)>Number(old.original_duration??old.duration))reasons.push('原定工期增加');
   if(edges(a.predecessors)!==edges(old.predecessors))reasons.push('前置逻辑或时距变化');
   if(a.actual_start&&a.actual_start>calendarDate(snapshot.start_date||start,old.es))reasons.push('实际开工晚于基线');
  }
  if(a.start_not_before||a.constraint_type&&a.constraint_type!=='尽早开始')reasons.push(['强制开始','强制完成'].includes(a.constraint_type)?'受强制日期约束':'受日期约束');
  if(current.forecast_remaining&&a.progress<100)reasons.push('按剩余工期重排');
  const finishHours=old?wholeSignedHours((a.ef-old.ef-origin)*24):null;
  return {id:a.id,code:a.code,name:a.name,baseline_finish:old?calendarDate(snapshot.start_date||start,old.ef):null,current_finish:calendarDate(start,a.ef),finish_delay_hours:finishHours,duration_change_hours:old?wholeSignedHours(Number(a.original_duration??a.duration)*hoursPerDay-Number(old.original_duration??old.duration)*(snapshot.calendar_config?.hours_per_day||hoursPerDay)):null,total_float_hours:wholeSignedHours(a.float*hoursPerDay),critical:a.critical,reasons};
 });
 for(const old of snapshot.activities||[])if(!current.activities.some((a:any)=>a.id===old.id))rows.push({id:old.id,code:old.code,name:old.name,baseline_finish:calendarDate(snapshot.start_date||start,old.ef),current_finish:null,finish_delay_hours:null,duration_change_hours:null,total_float_hours:null,critical:false,reasons:['不在当前可分析作业范围']});
 return rows.sort((a:any,b:any)=>(b.finish_delay_hours??-Infinity)-(a.finish_delay_hours??-Infinity)||String(a.code).localeCompare(String(b.code),undefined,{numeric:true}));
}
export function compareScenario(before:any,after:any,start:string,hoursPerDay:number){
 const originals=new Map<string,any>(before.activities.map((a:any)=>[a.id,a]));
 return after.activities.map((a:any)=>{const old=originals.get(a.id)!;return {id:a.id,code:a.code,name:a.name,before_finish:calendarDate(start,old.ef),after_finish:calendarDate(start,a.ef),work_delay_hours:wholeSignedHours((a.work_ef-old.work_ef)*hoursPerDay),calendar_delay_hours:wholeSignedHours((a.ef-old.ef)*24),critical_before:old.critical,critical_after:a.critical};}).filter((a:any)=>a.work_delay_hours!==0||a.calendar_delay_hours!==0||a.critical_before!==a.critical_after);
}
