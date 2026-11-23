import {isLoe} from './loe.ts';

/** All comparisons use project working-day coordinates, never elapsed chart days. */
export function relationshipTiming(predecessor:any,successor:any,dependency:any){
 const position=(a:any,event:string)=>Number(event==='F'?(a.work_ef??a.ef):(a.work_es??a.es));
 const source=position(predecessor,dependency.type[0]);
 const originalTarget=position(successor,dependency.type[1]);
 const remainingStart=dependency.type[1]==='S'&&successor.forecast_anchor&&successor.actual_start&&!successor.actual_finish&&Number(successor.progress)<100;
 const target=remainingStart?Math.max(position(successor,'S'),position(successor,'F')-Number(successor.remaining_duration)):originalTarget;
 const gap=target-source-Number(dependency.lag),historicalGap=originalTarget-source-Number(dependency.lag);
 const fixed=!!successor.hard_applied||!!successor.actual_finish||!!successor.actual_start&&!remainingStart&&dependency.type[1]==='S';
 const nonDriving=isLoe(predecessor)||isLoe(successor);
 return {gap_work_days:gap,historical_gap_work_days:historicalGap,remaining_start:!!remainingStart,
  historical_conflict:historicalGap< -1e-7&&(!!successor.actual_start||!!successor.actual_finish),
  violated:gap< -1e-7,driving:Math.abs(gap)<1e-7&&!fixed&&!nonDriving,fixed,non_driving:nonDriving};
}

export function cpmReport(data:any){
 const activities:any[]=data?.activities||[],byId=new Map(activities.map(a=>[a.id,a]));
 const incoming=new Map<string,number>(),outgoing=new Map<string,number>();
 const relationships=activities.flatMap(a=>(a.predecessors||[]).flatMap((d:any)=>{
  const p=byId.get(d.id);if(!p)return [];
  const timing=relationshipTiming(p,a,d);
  if(!timing.non_driving){incoming.set(a.id,(incoming.get(a.id)||0)+1);outgoing.set(p.id,(outgoing.get(p.id)||0)+1);}
  return [{predecessor:p.id,successor:a.id,predecessor_code:p.code,predecessor_name:p.name,successor_code:a.code,successor_name:a.name,type:d.type,lag:d.lag,...timing}];
 }));
 const ordinary=activities.filter(a=>!isLoe(a));
 return {activities,relationships,summary:{activities:ordinary.length,loe:activities.length-ordinary.length,
  relationships:relationships.filter(r=>!r.non_driving).length,driving:relationships.filter(r=>r.driving).length,
  violations:relationships.filter(r=>r.violated&&!r.non_driving).length,
  historical_conflicts:relationships.filter(r=>r.historical_conflict&&!r.non_driving).length,
  starts:ordinary.filter(a=>!incoming.has(a.id)).length,ends:ordinary.filter(a=>!outgoing.has(a.id)).length,
  near_critical:ordinary.filter(a=>a.near_critical).length,float_critical:ordinary.filter(a=>a.float_critical).length,on_longest_path:ordinary.filter(a=>a.on_longest_path).length,
  negative:ordinary.filter(a=>a.float< -1e-7).length,critical:ordinary.filter(a=>a.critical).length}};
}
