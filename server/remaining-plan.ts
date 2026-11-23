import type pg from 'pg';import {pool} from './db.ts';import {schedule,type Activity} from './schedule.ts';import {calendarDate,calendarHours,workMoment,type ProjectCalendar} from '../shared/project-calendar.ts';import {remainingDays,remainingAllocation} from '../shared/remaining-resources.ts';
export const currentPlanDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function remainingOverrides(project:string,c:pg.Pool|pg.PoolClient=pool,ids?:string[]){return (await c.query(`SELECT v.*,v.quantity::text FROM activity_resource_remaining v JOIN activity_resource_allocations x ON x.id=v.allocation_id JOIN activities a ON a.id=x.activity_id WHERE a.project_id=$1 AND ($2::uuid[] IS NULL OR a.id=ANY($2::uuid[])) ORDER BY v.allocation_id`,[project,ids??null])).rows;}
export function remainingWindow(a:any,calendar:ProjectCalendar,start:string,dataDate:string){
 const days=remainingDays(a,calendar.hours_per_day),end=a.work_ef,begin=Math.max(a.work_es,end-days),status=(dataDate>=start?calendarHours(calendar,start,dataDate):-calendarHours(calendar,dataDate,start))/calendar.hours_per_day;
 return {days,end,begin,valid:days===0||begin>=status-1e-7&&end-begin>=days-1e-7};
}
export function remainingPlan(activities:Activity[],calendar:ProjectCalendar,start:string,options:any,dataDate=options.data_date||currentPlanDate()){
 const calculated=schedule(activities,calendar,start,'duration',{...options,forecast_remaining:true,data_date:dataDate});
 const moment=(value:number,edge:'start'|'finish')=>{if(value>=0)return workMoment(calendar,start,value,edge);let days=7;while(days<60000){const base=calendarDate(start,-days),offset=calendarHours(calendar,base,start)/calendar.hours_per_day;if(offset+value>=0)return -days+workMoment(calendar,base,offset+value,edge);days*=2;}throw Error('剩余预测日期超出排程范围')};
 const future=calculated.activities.map(a=>{const {days,end,begin,valid}=remainingWindow(a,calendar,start,dataDate);return {...a,duration:days,remaining_window_valid:valid,es:days&&valid?moment(begin,'start'):a.ef,ef:days&&valid?moment(end,'finish'):a.ef};});
 return {data_date:dataDate,calculated,activities:future};
}
export function decorateRemainingResources(resources:any[],future:any,overrides:any[],hoursPerDay:number){
 const values=new Map(overrides.map(r=>[r.allocation_id,r])),activities=new Map<string,any>(future.activities.map((a:any)=>[a.id,a]));
 return resources.map(r=>({...r,allocations:(r.allocations||[]).map((x:any)=>{const a=activities.get(x.activity_id),v=values.get(x.id);return {...x,...remainingAllocation(a,r,{...x,remaining_quantity:v?.quantity},r.active===false?0:a?.duration||0,hoursPerDay),remaining_window_valid:a?.remaining_window_valid!==false,remaining_version:v?.version||0};})}));
}
