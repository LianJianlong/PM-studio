import {progressQuality} from '../shared/progress-quality.ts';
import {constraintDiagnostics} from '../shared/constraint-diagnostics.ts';
import {relationshipTiming} from '../shared/cpm-report.ts';
import {LoeError,LOE,isLoe} from '../shared/loe.ts';
import {criticalPaths} from '../shared/critical-paths.ts';
import {durationSummary} from '../shared/duration-summary.ts';
import type {ScheduleOptions} from '../shared/p6-planning.ts';
import {calendarDate} from '../shared/project-calendar.ts';
import {naturalCalendar,workMoment,validateCalendar,calendarHours,type ProjectCalendar} from '../shared/project-calendar.ts';
export type Dependency = {
  id: string;
  type: "FS" | "SS" | "FF" | "SF";
  lag: number;
};
export type Activity = {
  id: string;
  code: string;
  name: string;
  duration: number;
  progress: number;
  predecessors: Dependency[];
  start_not_before?:string;start_offset?:number;
  network_status?:'未开始'|'进行中'|'已完成';
  loe_resolved?:boolean;loe_scope?:string[];duration_type?:string;activity_type?:string;actual_start?:string;actual_finish?:string;constraint_type?:string;constraint_date?:string;remaining_duration?:number;percent_complete_type?:string;schedule_options?:ScheduleOptions;
  [key: string]: unknown;
};
export function scheduleCPM(input: Activity[], calendar?:ProjectCalendar|null,startDate?:string,progressMethod:'duration'|'equal'='duration',options?:ScheduleOptions) {
  const policy:ScheduleOptions=options||input[0]?.schedule_options as ScheduleOptions||{};
  const equalWeight=progressMethod==='equal'||!input.some(x=>x.duration>0);
  if (new Set(input.map(a=>a.id)).size !== input.length) throw Error('作业标识重复');
  for (const a of input) {
    if (!Number.isFinite(Number(a.progress)) || Number(a.progress)<0 || Number(a.progress)>100) throw Error('完成率无效');
    for (const d of a.predecessors) if (!['FS','SS','FF','SF'].includes(d.type) || !Number.isFinite(d.lag)) throw Error('逻辑关系或时距无效');
  }
  const map = new Map(
    input.map((a) => [
      a.id,
      {
        ...a,
        original_duration:Number(a.duration),remaining_duration:a.actual_finish?0:Math.max(0,a.remaining_duration!=null?Number(a.remaining_duration):Number(a.duration)*(1-Number(a.progress)/100)),
        status:a.actual_finish||Number(a.progress)===100?'已完成':a.actual_start||Number(a.progress)>0?'进行中':'未开始',
        duration: Number(a.duration),
        progress: Number(a.progress),
        es: Number(a.start_offset||0),
        ef: 0,
        ls: 0,
        lf: 0,
        float: 0,
        critical: false,float_critical:false,on_longest_path:false,near_critical:false,critical_reason:'none',
        free_float:0,work_es:0,work_ef:0,work_ls:0,work_lf:0,
        hard_applied:false,forecast_anchor:false,constraint_messages:[] as string[],float_paths:[] as {path:number;order:number}[],
      },
    ]),
  );
  const dateOffset=(date:string,finish=false)=>{
    if(!calendar||!startDate)return Math.floor((Date.parse(date)-Date.parse(startDate||date))/86400000)+(finish?1:0);
    const target=finish?calendarDate(date,1):date;
    return (target>=startDate?calendarHours(calendar,startDate,target):-calendarHours(calendar,target,startDate))/calendar.hours_per_day;
  };
  if(calendar&&startDate){
    validateCalendar(calendar,false);
    for(const activity of map.values())if(typeof activity.start_not_before==='string'&&activity.start_not_before>startDate){
      activity.es=Math.max(activity.es,calendarHours(calendar,startDate,activity.start_not_before)/calendar.hours_per_day);
    }
  }
  // Iterative DFS preserves predecessor order and reports an actionable cycle chain.
  const ordered:string[]=[],state=new Map<string,number>();
  for(const a of input){
    if(!Number.isFinite(Number(a.duration))||Number(a.duration)<0)throw Error('工期无效');
    if(a.remaining_duration!=null&&(!Number.isFinite(Number(a.remaining_duration))||Number(a.remaining_duration)<0))throw Error('剩余工期无效');
    const edges=new Set<string>();
    for(const d of a.predecessors){
      if(!map.has(d.id))throw Error('前置作业不存在或不属于当前项目');
      const key=d.id+'|'+d.type;if(edges.has(key))throw Error('同一对作业的同类型逻辑关系重复：'+a.code);edges.add(key);
    }
  }
  for(const root of input){
    if(state.get(root.id)===2)continue;
    const stack=[{id:root.id,index:0}];state.set(root.id,1);
    while(stack.length){
      const frame=stack[stack.length-1],row=map.get(frame.id)!;
      if(frame.index===row.predecessors.length){state.set(frame.id,2);ordered.push(frame.id);stack.pop();continue;}
      const id=row.predecessors[frame.index++].id;
      if(state.get(id)===1){const cycle=stack.slice(stack.findIndex(f=>f.id===id)).map(f=>map.get(f.id)!.code);cycle.push(map.get(id)!.code);throw Error('作业依赖存在循环：'+cycle.slice(0,30).join(' → ')+(cycle.length>30?' …':''));}
      if(state.get(id)!==2){state.set(id,1);stack.push({id,index:0});}
    }
  }
  const spans=new Map<string,number>();
  const dataOffset=policy.data_date?dateOffset(policy.data_date):0;
  for (const id of ordered) {
    const a = map.get(id)!;
    const actualStart=typeof a.actual_start==='string'?dateOffset(a.actual_start):null;
    const actualFinish=typeof a.actual_finish==='string'?dateOffset(a.actual_finish,true):null;
    const forecast=!!policy.forecast_remaining&&actualFinish===null&&a.status!=='已完成';
    a.forecast_anchor=forecast;
    let duration=forecast?a.remaining_duration:a.duration;
    if(forecast&&calendar){duration=Math.max(0,Math.ceil(duration*calendar.hours_per_day-1e-7)/calendar.hours_per_day);a.remaining_duration=duration;}
    let earliest=Math.max(a.es,forecast?dataOffset:0);
    if(a.constraint_date&&typeof a.constraint_date==='string'){
      const bound=dateOffset(a.constraint_date,['完成不早于','完成于'].includes(String(a.constraint_type)));
      if(actualStart===null&&['开始不早于','开始于'].includes(String(a.constraint_type)))earliest=Math.max(earliest,bound);
      if(['完成不早于','完成于'].includes(String(a.constraint_type)))earliest=Math.max(earliest,bound-duration);
    }
    for(const d of a.predecessors){
      const p=map.get(d.id)!;
      const from=d.type[0]==='F'?p.ef:p.es;
      const target=from+d.lag-(d.type[1]==='F'?duration:0);
      // Retain predecessor logic for the remaining part of started work.
      earliest=Math.max(earliest,target);
    }
    if(actualStart!==null){
      a.es=actualStart;
      a.ef=actualFinish!==null?actualFinish:Math.max(actualStart,earliest)+duration;
    }else{a.es=earliest;a.ef=earliest+duration;}
    if(actualFinish!==null)a.ef=actualFinish;
    if(a.constraint_date&&['强制开始','强制完成'].includes(String(a.constraint_type))){
      const isFinish=a.constraint_type==='强制完成',bound=dateOffset(a.constraint_date,isFinish);
      const actual=isFinish?actualFinish:actualStart;
      if(actual!==null&&Math.abs(actual-bound)>1e-7)a.constraint_messages.push('强制日期与已填报实际日期冲突，实际日期保持不变');
      else if(isFinish&&actualStart!==null&&bound<actualStart-1e-7)a.constraint_messages.push('强制完成早于实际开始，保留实际日期与原预测');
      else{
        a.hard_applied=true;
        if(isFinish){a.ef=bound;if(actualStart===null)a.es=bound-duration;}
        else{a.es=bound;if(actualStart===null)a.ef=bound+duration;}
        if(a.es< -1e-7)a.constraint_messages.push('强制日期将作业安排在项目起点之前，请核对');
        if(forecast&&a.es<dataOffset-1e-7)a.constraint_messages.push('强制日期位于状态日期之前，请核对未完工作的可行性');
      }
    }
    spans.set(id,Math.max(0,a.ef-a.es));
  }
  const duration = Math.max(0, ...[...map.values()].map((a) => a.ef));
  for (const a of map.values()) {
    const target=policy.must_finish_by?Math.min(duration,dateOffset(policy.must_finish_by,true)):duration;
    a.ls = target - spans.get(a.id)!;
    a.lf = target;
    if(a.constraint_date&&typeof a.constraint_date==='string'){
      const type=String(a.constraint_type),finish=['完成不晚于','完成于'].includes(type),bound=dateOffset(a.constraint_date,finish);
      if(['开始不晚于','开始于'].includes(type))a.ls=Math.min(a.ls,bound);
      if(finish)a.ls=Math.min(a.ls,bound-spans.get(a.id)!);
      a.lf=a.ls+spans.get(a.id)!;
    }
    if(a.hard_applied){a.ls=a.es;a.lf=a.ef;}
  }
  for (const id of [...ordered].reverse()) {
    const a = map.get(id)!;
    for (const d of a.predecessors) {
      const p = map.get(d.id)!;
      const edge=({FS:spans.get(p.id)!,SS:0,FF:spans.get(p.id)!-spans.get(a.id)!,SF:-spans.get(a.id)!})[d.type]+d.lag;
      if(!p.hard_applied){p.ls = Math.min(p.ls, a.ls - edge);p.lf = p.ls + spans.get(p.id)!;}
    }
    a.float = a.ls - a.es;
    a.critical = a.float <= (policy.critical_threshold??0)+1e-8;
  }
  const successors=new Map<string,Array<{activity:typeof map extends Map<string,infer V>?V:never;dependency:Dependency}>>();
  for(const a of map.values()){
    a.work_es=a.es;a.work_ef=a.ef;a.work_ls=a.ls;a.work_lf=a.lf;
    for(const d of a.predecessors){if(!successors.has(d.id))successors.set(d.id,[]);successors.get(d.id)!.push({activity:a,dependency:d});}
  }
  for(const a of map.values()){
    let free=duration-a.ef;
    for(const edge of successors.get(a.id)||[])free=Math.min(free,relationshipTiming(a,edge.activity,edge.dependency).gap_work_days);
    a.free_float=Math.max(0,free);
  }
  {
    const longest=new Set<string>(),pending=[...map.values()].filter(a=>Math.abs(a.ef-duration)<1e-8).map(a=>a.id);
    while(pending.length){const id=pending.pop()!;if(longest.has(id))continue;longest.add(id);const a=map.get(id)!;
      for(const d of a.predecessors){const p=map.get(d.id)!;if(relationshipTiming(p,a,d).driving)pending.push(p.id);}
    }
    for(const a of map.values()){
      a.float_critical=a.float<=(policy.critical_threshold??0)+1e-8;a.on_longest_path=longest.has(a.id);
      a.critical=policy.critical_method==='longest'?a.on_longest_path:a.float_critical;
      a.near_critical=!a.critical&&a.status!=='已完成'&&a.float>1e-8&&a.float*(calendar?.hours_per_day||24)<=(policy.near_critical_hours??16)+1e-7;
      a.critical_reason=a.critical?(policy.critical_method==='longest'?'longest':'float'):'none';
    }
  }
  const violations:Array<{predecessor:string;successor:string;type:string;shortfall_work_days:number}>=[],historicalViolations:typeof violations=[];
  for(const a of map.values())for(const d of a.predecessors){
    const p=map.get(d.id)!,timing=relationshipTiming(p,a,d);
    if(timing.violated)violations.push({predecessor:p.id,successor:a.id,type:d.type,shortfall_work_days:-timing.gap_work_days});
    if(timing.historical_conflict)historicalViolations.push({predecessor:p.id,successor:a.id,type:d.type,shortfall_work_days:-timing.historical_gap_work_days});
  }
  const pathResult=criticalPaths([...map.values()],ordered,policy.path_count||5,policy.path_end_id);
  for(const path of pathResult.paths)for(let i=0;i<path.activity_ids.length;i++)map.get(path.activity_ids[i])!.float_paths.push({path:path.rank,order:i+1});
  let elapsed=duration;
  if(calendar&&startDate){
    validateCalendar(calendar,false);
    const start=new Date(startDate).toISOString().slice(0,10);
    // Milestones tied to a predecessor finish occur at the finish, not the next shift.
    const milestoneEdges = new Map([...map.values()].map(a=>[a.id,a.hard_applied&&a.constraint_type==='强制完成'?'finish':a.hard_applied&&a.constraint_type==='强制开始'?'start':a.activity_type==='开始里程碑'? 'start':a.activity_type==='完成里程碑'?'finish':a.duration===0 && a.es>0 && a.predecessors.some(d=>['FS','FF'].includes(d.type)&&Math.abs((d.type[0]==='F'?map.get(d.id)!.ef:map.get(d.id)!.es)+d.lag-a.es)<1e-8) && !a.predecessors.some(d=>['SS','SF'].includes(d.type)&&Math.abs((d.type[0]==='F'?map.get(d.id)!.ef:map.get(d.id)!.es)+d.lag-a.es)<1e-8)?'finish':'start'] as const));
    const moment=(value:number,edge:'start'|'finish')=>{
      if(value>=0)return workMoment(calendar,start,value,edge);
      let days=7;while(days<60000){const base=calendarDate(start,-days),before=calendarHours(calendar,base,start)/calendar.hours_per_day;if(before+value>=0)return -days+workMoment(calendar,base,before+value,edge);days*=2;}
      throw Error('约束日期超出排程范围');
    };
    for(const a of map.values()){
      const milestoneEdge=milestoneEdges.get(a.id)!;
      a.es=moment(a.es,a.duration===0?milestoneEdge:'start');
      a.ef=moment(a.ef,a.duration===0?milestoneEdge:'finish');
      a.ls=moment(a.ls,a.duration===0?milestoneEdge:'start');
      a.lf=moment(a.lf,a.duration===0?milestoneEdge:'finish');
    }
    elapsed=Math.max(0,...[...map.values()].map(a=>a.ef));
  }
  return {
    duration:elapsed,work_duration:duration,progress_quality:progressQuality(input,calendar||naturalCalendar,startDate,policy.data_date),duration_summary:durationSummary([...map.values()],calendar?.hours_per_day||24),schedule_options:policy,
    constraint_diagnostics:calendar&&startDate?constraintDiagnostics([...map.values()],calendar,startDate,policy,violations):[],
    critical_paths:pathResult.paths,path_warnings:pathResult.warnings,logic_violations:violations,historical_logic_violations:historicalViolations,
    deadline_missed:!!policy.must_finish_by&&Math.max(-Infinity,...[...map.values()].map(a=>a.work_ef))>dateOffset(policy.must_finish_by,true)+1e-7,
    forecast_remaining:!!policy.forecast_remaining,data_date:policy.data_date||null,
    activities: input.map((a) => map.get(a.id)!),
    calendar: calendar?.name||naturalCalendar.name,
    progress_method:progressMethod,
    progress_note:progressMethod==='equal'?'作业等权，包含里程碑':'按工作工期加权，里程碑不计权重；全为里程碑时等权',
    progress: input.length
      ? Math.round(
          input.reduce(
            (s, a) => s + Number(a.progress) * (equalWeight?1:Number(a.duration)),
            0,
          ) / input.reduce((s, a) => s + (equalWeight?1:Number(a.duration)), 0),
        )
      : 0,
  };
}

/** LOE is a calculated support window, not an extra driving CPM activity. */
export function schedule(input:Activity[],calendar?:ProjectCalendar|null,startDate?:string,method:'duration'|'equal'='duration',options?:ScheduleOptions){
 const loes=input.filter(isLoe);if(!loes.length)return scheduleCPM(input,calendar,startDate,method,options);
 const ids=new Set(loes.map(a=>a.id));
 const result=scheduleCPM(input.filter(a=>!ids.has(a.id)).map(a=>({...a,predecessors:a.predecessors.filter(d=>!ids.has(d.id))})),calendar,startDate,method,options);
 const ordinary=new Map(result.activities.map(a=>[a.id,a])),policy=options||input[0]?.schedule_options||{},hpd=calendar?.hours_per_day||24;
 const offset=(date:string,finish=false)=>{if(!calendar||!startDate)return Math.floor((Date.parse(date)-Date.parse(startDate||date))/86400000)+(finish?1:0);const target=finish?calendarDate(date,1):date;return (target>=startDate?calendarHours(calendar,startDate,target):-calendarHours(calendar,target,startDate))/hpd;};
 const moment=(v:number,edge:'start'|'finish')=>{if(!calendar||!startDate)return v;if(v>=0)return workMoment(calendar,startDate,v,edge);let days=7;while(days<60000){const base=calendarDate(startDate,-days),count=calendarHours(calendar,base,startDate)/hpd;if(count+v>=0)return -days+workMoment(calendar,base,count+v,edge);days*=2;}throw new LoeError('LOE日期超出排程范围');};
 const derived=loes.map(a=>{
  if(a.constraint_type&&a.constraint_type!=='尽早开始')throw new LoeError('LOE不使用日期约束');
  const scope=a.loe_scope||[];if(scope.some(id=>ids.has(id)))throw new LoeError('LOE不能关联自身或其他LOE');
  const anchors=scope.map(id=>ordinary.get(id)).filter(Boolean) as typeof result.activities;
  const resolved=scope.length>0&&anchors.length===scope.length,messages:string[]=[];
  if(!resolved)messages.push('LOE关联作业未配置或不在当前可计算范围，不计算工期和费用');
  let es=resolved?Math.min(...anchors.map(x=>x.work_es)):0,ef=resolved?Math.max(...anchors.map(x=>x.work_ef)):0;
  if(a.actual_start)es=offset(a.actual_start);else if(policy.forecast_remaining&&policy.data_date&&resolved)es=Math.max(es,offset(policy.data_date));
  if(a.actual_finish)ef=offset(a.actual_finish,true);
  if(ef<es){messages.push('LOE结束边界早于开始边界，请核对实际日期和关联范围');ef=es;}
  const duration=resolved?Math.ceil(Math.max(0,ef-es)*hpd-1e-7)/hpd:0;
  const remaining=a.actual_finish?0:policy.forecast_remaining&&policy.data_date?Math.max(0,ef-Math.max(es,offset(policy.data_date))):duration*(1-Number(a.progress)/100);
  const start=moment(es,'start'),finish=duration?moment(ef,'finish'):start;
  return {...a,input_duration:Number(a.duration),original_duration:duration,duration,remaining_duration:Math.max(0,Math.ceil(remaining*hpd-1e-7)/hpd),progress:Number(a.progress),status:a.actual_finish||Number(a.progress)===100?'已完成':a.actual_start||Number(a.progress)>0?'进行中':'未开始',es:start,ef:finish,ls:moment(resolved?Math.min(...anchors.map(x=>x.work_ls)):es,'start'),lf:moment(resolved?Math.max(...anchors.map(x=>x.work_lf)):ef,'finish'),work_es:es,work_ef:ef,work_ls:resolved?Math.min(...anchors.map(x=>x.work_ls)):es,work_lf:resolved?Math.max(...anchors.map(x=>x.work_lf)):ef,float:resolved?Math.min(...anchors.map(x=>x.float)):0,free_float:resolved?Math.min(...anchors.map(x=>x.free_float)):0,critical:false,float_critical:false,on_longest_path:false,near_critical:false,critical_reason:'loe',float_paths:[],hard_applied:false,forecast_anchor:!!policy.forecast_remaining,loe_resolved:resolved,non_driving:true,constraint_messages:messages};
 });
 const all=new Map<string,any>([...result.activities,...derived].map(a=>[a.id,a]));
 const activities=input.map(a=>({...all.get(a.id),predecessors:a.predecessors,non_driving_predecessors:a.predecessors.filter(d=>ids.has(d.id)).map(d=>d.id)})) as (ReturnType<typeof scheduleCPM>['activities'][number]&{loe_resolved?:boolean;non_driving?:boolean})[];
 const included=activities.filter(a=>!isLoe(a)||a.loe_resolved);
 return {...result,activities,progress_quality:progressQuality(input,calendar||naturalCalendar,startDate,policy.data_date),duration:Math.max(0,...included.map(a=>a.ef)),work_duration:Math.max(0,...included.map(a=>a.work_ef)),duration_summary:durationSummary(included,hpd),progress_note:'实体进度按普通作业计算，LOE支持性作业不重复计权'};
}
