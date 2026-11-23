import {calendarDate} from './project-calendar.ts';
import {relationshipTiming} from './cpm-report.ts';
import {isLoe} from './loe.ts';
const hours=(v:number)=>Math.round(v+Number.EPSILON);
const known=(v:any)=>typeof v==='boolean'?v:null;
const whole=(v:any)=>v!=null&&Number.isFinite(Number(v))?Number(v):null;
const stamp=(start:string,a:any,edge:string)=>a&&a[edge]!=null&&Number.isFinite(Number(a[edge]))?calendarDate(start,Number(a[edge])):null;
const status=(a:any,b:any)=>!b?'新增作业':!a?'仅基线存在':typeof b.critical!=='boolean'?'基线关键性未知':a.critical&&!b.critical?'转为关键':!a.critical&&b.critical?'退出关键':a.critical?'持续关键':'持续非关键';
const relationKey=(d:any)=>`${d.id}:${d.type}`;
export function delayEvidence(current:any,baseline:any,start:string,calendar:any,traceId?:string){
 const snapshot=baseline?.snapshot||{},supported=Array.isArray(snapshot.activities),oldStart=snapshot.start_date||start,hpd=calendar.hours_per_day,oldHpd=snapshot.calendar_config?.hours_per_day;
 const now=new Map<string,any>((current.activities||[]).map((a:any)=>[a.id,a])),old=new Map<string,any>((supported?snapshot.activities:[]).map((a:any)=>[a.id,a]));
 const label=(id:string)=>{const a=now.get(id)||old.get(id);return a?`${a.code} · ${a.name}`:'不在可分析范围';};
 const context:Array<{kind:string;before:any;after:any}>=[];
 if(baseline){
 if(oldStart!==start)context.push({kind:'项目开始日期变化',before:oldStart,after:start});
 if(snapshot.calendar_config){const relevant=(v:any)=>JSON.stringify({week:v.week,exceptions:Object.entries(v.exceptions||{}).sort(([a],[b])=>a.localeCompare(b)),hours_per_day:v.hours_per_day});if(relevant(snapshot.calendar_config)!==relevant(calendar))context.push({kind:'项目工作日历变化',before:snapshot.calendar_config.name,after:calendar.name});}
 else context.push({kind:'基线未冻结工作日历',before:null,after:calendar.name});
 if(snapshot.schedule_options){const defaults:any={critical_method:'float',critical_threshold:0,forecast_remaining:false,data_date:null,must_finish_by:null};for(const k of Object.keys(defaults)){const before=snapshot.schedule_options[k]??defaults[k],after=current.schedule_options?.[k]??defaults[k];if(before!==after)context.push({kind:({critical_method:'关键性判定口径变化',critical_threshold:'关键浮时阈值变化（工作小时）',forecast_remaining:'剩余重排设置变化',data_date:'状态日期变化',must_finish_by:'要求完工日期变化'} as any)[k],before:k==='critical_threshold'?(oldHpd?hours(before*oldHpd):null):before,after:k==='critical_threshold'?hours(after*hpd):after});}}
 else context.push({kind:'基线未冻结排程设置',before:null,after:null});
 }
 const rowIds=[...new Set([...now.keys(),...old.keys()])];
 const rows=rowIds.map(id=>{
  const a=now.get(id),b=old.get(id),evidence:Array<{kind:string;before:any;after:any;candidate:boolean}>=[];
  const add=(kind:string,before:any,after:any,candidate=false)=>evidence.push({kind,before,after,candidate});
  const baseStart=b?stamp(oldStart,b,'es'):null,baseFinish=b?stamp(oldStart,b,'ef'):null,currentStart=a?stamp(start,a,'es'):null,currentFinish=a?stamp(start,a,'ef'):null;
  const baseDuration=b&&oldHpd?hours(Number(b.original_duration??b.duration)*oldHpd):null,currentDuration=a?hours(Number(a.original_duration??a.duration)*hpd):null;
  if(a&&b){
   if(Number(a.start_offset||0)!==Number(b.start_offset||0))add('手动开始偏移变化（工作小时）',oldHpd?hours(Number(b.start_offset||0)*oldHpd):null,hours(Number(a.start_offset||0)*hpd),true);
   if(a.code!==b.code)add('作业编码变化',b.code,a.code);
   if(a.name!==b.name)add('作业名称变化',b.name,a.name);
   if(baseDuration!==null&&currentDuration!==baseDuration)add('原定工期变化（工作小时）',baseDuration,currentDuration,currentDuration!>baseDuration);
   const previous=new Map<string,any>((b.predecessors||[]).map((d:any)=>[relationKey(d),d])),next=new Map<string,any>((a.predecessors||[]).map((d:any)=>[relationKey(d),d]));
   for(const [key,d] of next){const p=previous.get(key);if(!p)add('增加前置关系',null,`${label(d.id)} ${d.type} ${hours(Number(d.lag)*hpd)}h`,true);else if(oldHpd&&hours(Number(p.lag)*oldHpd)!==hours(Number(d.lag)*hpd))add('逻辑时距变化（工作小时）',`${label(d.id)} ${d.type} ${hours(Number(p.lag)*oldHpd)}h`,`${label(d.id)} ${d.type} ${hours(Number(d.lag)*hpd)}h`,true);}
   for(const [key,d] of previous)if(!next.has(key))add('移除前置关系',`${label(d.id)} ${d.type}${oldHpd?' '+hours(Number(d.lag)*oldHpd)+'h':''}`,null,true);
   for(const key of ['constraint_type','constraint_date','start_not_before','actual_start','actual_finish','remaining_duration','progress'])if((a[key]??null)!==(b[key]??null)){
    const kind=({constraint_type:'日期约束类型变化',constraint_date:'日期约束日期变化',start_not_before:'最早开始限制变化',actual_start:'实际开始记录变化',actual_finish:'实际完成记录变化',remaining_duration:'剩余工期字段变化',progress:'完成率变化'} as any)[key];
    const isConstraint=['constraint_type','constraint_date','start_not_before'].includes(key);if(key==='remaining_duration')add('剩余工期变化（工作小时）',b[key]!=null&&oldHpd?hours(Number(b[key])*oldHpd):null,a[key]!=null?hours(Number(a[key])*hpd):null);else add(kind,b[key]??null,a[key]??null,isConstraint);
   }
   if(a.actual_start&&baseStart&&a.actual_start>baseStart)add('实际开工晚于基线',baseStart,a.actual_start,true);
   if(a.actual_finish&&baseFinish&&a.actual_finish>baseFinish)add('实际完工晚于基线',baseFinish,a.actual_finish,true);
  }else if(a&&supported)add('新增作业，无对应基线',null,`${a.code} · ${a.name}`,true);
  else if(b)add('不在当前可分析作业范围',`${b.code} · ${b.name}`,null);
  return {id,code:a?.code||b?.code,name:a?.name||b?.name,baseline_code:b?.code||null,baseline_name:b?.name||null,present:!!a,matched:!!a&&!!b,change:baseline?status(a,b):'无基线',critical_before:known(b?.critical),critical_after:known(a?.critical),longest_before:known(b?.on_longest_path),longest_after:known(a?.on_longest_path),baseline_start:baseStart,current_start:currentStart,baseline_finish:baseFinish,current_finish:currentFinish,start_delay_days:baseStart&&currentStart?Math.round((Date.parse(currentStart)-Date.parse(baseStart))/86400000):null,finish_delay_days:baseFinish&&currentFinish?Math.round((Date.parse(currentFinish)-Date.parse(baseFinish))/86400000):null,baseline_float_hours:b&&oldHpd&&whole(b.float)!==null?hours(Number(b.float)*oldHpd):null,current_float_hours:a&&whole(a.float)!==null?hours(Number(a.float)*hpd):null,baseline_duration_hours:baseDuration,current_duration_hours:currentDuration,evidence,candidate:evidence.some(e=>e.candidate)};
 }).sort((a,b)=>(b.finish_delay_days??-Infinity)-(a.finish_delay_days??-Infinity)||String(a.code).localeCompare(String(b.code),'en',{numeric:true}));
 const ordinary=[...now.values()].filter(a=>!isLoe(a));const finish=ordinary.length?Math.max(...ordinary.map(a=>a.work_ef)):null;
 const targets=traceId?[traceId]:ordinary.filter(a=>Math.abs(a.work_ef-finish!)<1e-7).map(a=>a.id);
 const pending=[...targets],visited=new Set<string>(),edges:any[]=[];let cursor=0,truncated=false;
 while(cursor<pending.length){const id=pending[cursor++];if(visited.has(id))continue;if(visited.size>=200){truncated=true;break;}const a=now.get(id);if(!a)continue;visited.add(id);
  for(const d of a.predecessors||[]){const p=now.get(d.id);if(!p)continue;if(edges.length>=500){truncated=true;break;}const timing=relationshipTiming(p,a,d);
   const oldP=old.get(p.id),oldA=old.get(a.id),oldD=oldA?.predecessors?.find((x:any)=>x.id===p.id&&x.type===d.type);
   const baselineUsable=oldP&&oldA&&oldD&&[oldP.work_es,oldP.work_ef,oldA.work_es,oldA.work_ef].every(Number.isFinite);
   const oldTiming=baselineUsable?relationshipTiming(oldP,oldA,oldD):null;
   edges.push({predecessor:p.id,successor:a.id,predecessor_code:p.code,predecessor_name:p.name,successor_code:a.code,successor_name:a.name,type:d.type,lag_hours:hours(Number(d.lag)*hpd),gap_hours:hours(timing.gap_work_days*hpd),driving:timing.driving,historical_conflict:timing.historical_conflict,remaining_start:timing.remaining_start,historical_gap_hours:hours(timing.historical_gap_work_days*hpd),baseline_driving:oldTiming?oldTiming.driving:null,baseline_gap_hours:oldTiming&&oldHpd?hours(oldTiming.gap_work_days*oldHpd):null,reason:timing.non_driving?'LOE关系不驱动关键路线':timing.violated?'关系存在冲突':timing.fixed?'实际日期或强制约束固定事件':timing.driving?'当前驱动关系':'存在逻辑余量，不继续追踪'});
   if(timing.driving&&!visited.has(p.id))pending.push(p.id);
  }
 }
 const projectFinish=(values:any[],origin:string)=>{const dates=values.map(a=>stamp(origin,a,'ef')).filter((v):v is string=>!!v).sort();return dates.at(-1)||null;};
 const baselineFinish=baseline&&supported?projectFinish([...old.values()],oldStart):null,currentFinish=projectFinish([...now.values()],start);
 const traced=rows.filter(r=>visited.has(r.id)),allKnown=!!baseline&&supported&&[...old.values()].every(a=>typeof a.critical==='boolean');
 return {supported:!!baseline&&supported,context,rows,summary:{baseline_finish:baselineFinish,current_finish:currentFinish,finish_delay_days:baselineFinish&&currentFinish?Math.round((Date.parse(currentFinish)-Date.parse(baselineFinish))/86400000):null,matched:rows.filter(r=>r.matched).length,added:supported?rows.filter(r=>r.present&&!r.matched).length:0,baseline_only:rows.filter(r=>!r.present).length,became_critical:rows.filter(r=>r.change==='转为关键').length,left_critical:rows.filter(r=>r.change==='退出关键').length,criticality_comparable:allKnown},paths:{baseline:(snapshot.critical_paths||[]).slice(0,20),current:(current.critical_paths||[]).slice(0,20)},trace:{targets:targets.filter(id=>now.has(id)).slice(0,200).map(id=>({id,code:now.get(id).code,name:now.get(id).name})),nodes:traced,edges,truncated,candidates:traced.filter(r=>r.candidate),max_nodes:200,max_edges:500},needs_corroboration:true};
}
