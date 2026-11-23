import {workingDateMinutes,calendarDate} from './project-calendar.ts';
import {distributeResourceByMinutes,resourceTicks,resourceText,resourceUnits} from './resource-values.ts';
export function activityResourceRows(resources:any[],planned:any,start:string,calendar:any){
 const activities=new Map<string,any>(planned.activities.map((a:any)=>[a.id,a]));
 return resources.flatMap(r=>(r.allocations||[]).map((allocation:any)=>{const a=activities.get(allocation.activity_id);if(!a)return null;
 const slices=workingDateMinutes(calendar,start,a.es,a.ef),minutes=slices.reduce((n,d)=>n+d.minutes,0),durationDays=minutes/(calendar.hours_per_day*60);
 const totalUnits=resourceUnits(allocation.quantity,String(a.duration));
 const values=distributeResourceByMinutes(totalUnits,slices.length?slices.map(s=>s.minutes):[1]);const peak=values.reduce((m,v)=>v>m?v:m,0n);
 let months:string|null=null;const unit=String(r.unit).trim().toLowerCase();if(r.kind==='human'){
 const denominator=['人','人日','工日','人天','person','people','person-day','person-days'].includes(unit)?217500n:['人时','工时','person-hour','person-hours'].includes(unit)?BigInt(Math.round(21.75*calendar.hours_per_day*10000)):['人月','工月','person-month'].includes(unit)?10000n:0n;
 if(denominator)months=resourceText((resourceTicks(totalUnits)*10000n+denominator/2n)/denominator);
 }
 return {id:allocation.id,activity_id:a.id,activity_code:a.code,activity_name:a.name,resource_id:r.id,resource_name:r.name,kind:r.kind,unit:r.unit,quantity:allocation.quantity,total_units:totalUnits,peak_daily_quantity:resourceText(peak),working_days:durationDays,working_hours:minutes/60,start_date:slices[0]?.date||calendarDate(start,a.es),finish_date:slices.at(-1)?.date||calendarDate(start,a.ef),person_months:months};
 }).filter(Boolean)).sort((a:any,b:any)=>a.activity_code.localeCompare(b.activity_code)||a.resource_name.localeCompare(b.resource_name));
}
