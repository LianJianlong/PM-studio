import {calendarDate,calendarPeriods,minute} from './project-calendar.ts';
import {resourceTicks,resourceText,calendarCapacity} from './resource-values.ts';
export type ResourceInterval='day'|'week'|'month';
const key=(date:string,interval:ResourceInterval)=>interval==='month'?date.slice(0,7)+'-01':interval==='week'?calendarDate(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7)):date;
/** A backdated confirmed correction supersedes later points in its allocation's active chronology. */
export function activeResourceObservations(rows:any[]){
 const byAllocation=new Map<string,any[]>();
 for(const row of [...rows].sort((a,b)=>a.source_version-b.source_version)){
  const before=byAllocation.get(row.allocation_id)||[];byAllocation.set(row.allocation_id,[...before.filter(v=>v.as_of_date<row.as_of_date),row]);
 }
 return byAllocation;
}
export function resourceTimeSeries(resource:any,observations:any[],calendar:any,cutoff:string,interval:ResourceInterval,from:string,to:string){
 const allocations=new Set<string>((resource.allocations||[]).map((a:any)=>a.id)),validObservations=observations.filter(r=>allocations.has(r.allocation_id)),active=activeResourceObservations(validObservations);
 const incompatible=validObservations.some(r=>r.unit!==resource.unit),known=new Map<string,any>();
 const events=[...active.values()].flat().filter(r=>r.as_of_date<=cutoff).sort((a,b)=>a.as_of_date.localeCompare(b.as_of_date)||a.source_version-b.source_version);
 const plan=new Map<string,any>((resource.curve||[]).map((r:any)=>[r.date,r])),remaining=new Map<string,any>((resource.remaining_curve||[]).map((r:any)=>[r.date,r]));
 const periods=new Map<string,any>();let pTotal=0n,rTotal=0n,index=0;
 const earliest=[from,...plan.keys(),...remaining.keys(),...events.map(r=>r.as_of_date)].sort()[0];
 // Iterate from source origin so cumulative values do not reset when the display window changes.
 const days=Math.round((Date.parse(to)-Date.parse(earliest))/86400000)+1;
 if(days>30000)throw Error('资源时间跨度过大，请核对计划起点');
 let cutoffActual:bigint|null=null,cutoffReported=0,cutoffKnown=0n,cached:any=null;const atCutoff=()=>{
  if(cached)return cached;const values=[...known.values()].filter(v=>v.units!=null&&v.unit===resource.unit);return cached={reported:values.length,total:values.reduce((sum:bigint,v:any)=>sum+resourceTicks(v.units),0n),dates:values.map(v=>v.as_of_date).sort()};
 };
 for(let i=0;i<days;i++){
  const date=calendarDate(earliest,i),period=key(date,interval);let eventCount=0;
  while(index<events.length&&events[index].as_of_date<=date){const v=events[index++];known.set(v.allocation_id,v);cached=null;if(v.as_of_date===date)eventCount++;}
  if(date<=cutoff){const state=atCutoff();cutoffActual=state.reported===allocations.size&&allocations.size>0?state.total:null;cutoffReported=state.reported;cutoffKnown=state.total;}
  const p=plan.get(date),r=remaining.get(date),pv=resourceTicks(p?.quantity||'0'),rv=resourceTicks(r?.quantity||'0');pTotal+=pv;rTotal+=rv;
  if(date<from||date>to)continue;
  const minutes=calendarPeriods(calendar,date).reduce((n,[s,e])=>n+minute(e)-minute(s),0),capacity=calendarCapacity(resource.capacity,minutes,calendar.hours_per_day);
  const bucket=periods.get(period)||{date:period,from:date,to:date,plan:0n,remaining:0n,capacity:0n,planned_overload_days:0,remaining_overload_days:0,actual_events:0};
  bucket.to=date;bucket.plan+=pv;bucket.remaining+=rv;bucket.capacity+=capacity;bucket.planned_overload_days+=p?.overloaded?1:0;bucket.remaining_overload_days+=r?.overloaded?1:0;bucket.planned_cumulative=pTotal;bucket.remaining_cumulative=rTotal;bucket.actual_events+=eventCount;
  const state=atCutoff();bucket.reported=state.reported;bucket.actual_known=state.reported?state.total:null;bucket.actual_from=state.dates[0]||null;bucket.actual_to=state.dates.at(-1)||null;
  bucket.forecast=date>=cutoff&&cutoffActual!==null?cutoffActual+rTotal:null;
  periods.set(period,bucket);
 }
 // Obtain the current cutoff value even if a user views an earlier display window.
 const cutoffLatest=new Map<string,any>();for(const v of events)if(v.as_of_date<=cutoff)cutoffLatest.set(v.allocation_id,v);
 const values=[...cutoffLatest.values()].filter(v=>v.units!=null&&v.unit===resource.unit);cutoffReported=values.length;cutoffKnown=values.reduce((sum:bigint,v:any)=>sum+resourceTicks(v.units),0n);
 const remainingTotal=resourceTicks(resource.remaining_total_quantity??resourceText([...remaining.values()].reduce((sum:bigint,p:any)=>sum+resourceTicks(p.quantity),0n)+resourceTicks(resource.remaining_unplaced_quantity||'0')));
 const points=[...periods.values()].map(b=>({date:b.date,from:b.from,to:b.to,planned_units:resourceText(b.plan),remaining_units:resourceText(b.remaining),capacity_units:resourceText(b.capacity),planned_cumulative:resourceText(b.planned_cumulative),remaining_cumulative:resourceText(b.remaining_cumulative),actual_reported_cumulative:b.actual_known===null?null:resourceText(b.actual_known),actual_cumulative:b.reported===allocations.size&&allocations.size>0&&b.actual_events>0?resourceText(b.actual_known):null,actual_events:b.actual_events,reported_count:b.reported,allocation_count:allocations.size,actual_as_of_from:b.actual_from,actual_as_of_to:b.actual_to,forecast_cumulative:b.forecast===null?null:resourceText(b.forecast),planned_overload_days:b.planned_overload_days,remaining_overload_days:b.remaining_overload_days}));
 return {points,interval,from,to,cutoff,unit:resource.unit,allocation_count:allocations.size,actual_reported_count:cutoffReported,actual_reported_total:cutoffReported?resourceText(cutoffKnown):null,actual_complete:allocations.size>0&&cutoffReported===allocations.size,forecast_total_units:allocations.size>0&&cutoffReported===allocations.size?resourceText(cutoffKnown+remainingTotal):null,unit_history_incompatible:incompatible,observation_count:events.length,revision_count:validObservations.length-[...active.values()].flat().length,remaining_unplaced_units:resource.remaining_unplaced_quantity||'0.0000'};
}
