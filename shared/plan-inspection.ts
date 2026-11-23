import {cpmReport} from './cpm-report.ts';
import {isLoe} from './loe.ts';
import {calendarDate} from './project-calendar.ts';
export function inspectSchedule(data:any){
 const activities=data?.activities||[],successors=new Set<string>();
 const lookup=new Map<string,any>(activities.map((a:any)=>[a.id,a]));
 for(const a of activities)if(!isLoe(a))for(const d of a.predecessors||[])if(lookup.has(d.id)&&!isLoe(lookup.get(d.id)))successors.add(d.id);
 const items:Array<{code:string;name:string;severity:string;message:string}>=[];
 const push=(a:any,severity:string,message:string)=>items.push({code:a.code,name:a.name,severity,message});
 for(const a of activities){
  for(const message of a.constraint_messages||[])push(a,'警告',message);
  if(!isLoe(a)&&!a.predecessors?.some((d:any)=>lookup.has(d.id)&&!isLoe(lookup.get(d.id))))push(a,'提示','无前置关系，请核对是否为计划起点');
  if(!isLoe(a)&&!successors.has(a.id))push(a,'提示','无后置关系，请核对是否为计划终点');
  if(a.near_critical)push(a,'提示','近关键作业：总浮时接近预警上限，请关注剩余缓冲');
  if(a.float< -1e-7)push(a,'警告','存在负浮时，日期约束或要求完工日期无法满足');
  if(a.progress>0&&a.progress<100&&!a.actual_start)push(a,'警告','已报告进度但未填写实际开始');
  if(a.progress===100&&!a.actual_finish)push(a,'警告','完成率为100%但未填写实际完成');
  if(a.actual_start&&data.data_date&&a.actual_start>data.data_date)push(a,'警告','实际开始晚于状态日期');
  if(a.actual_finish&&data.data_date&&a.actual_finish>data.data_date)push(a,'警告','实际完成晚于状态日期');
  if(a.remaining_duration===0&&a.progress<100&&a.duration>0)push(a,'警告','未完成作业的剩余工期为0');
  if(a.float>20)push(a,'提示','总浮时超过20工作日，请核对逻辑完整性');
  for(const d of a.predecessors||[]){
   if(d.lag<0)push(a,'提示','使用提前关系，请核对实际施工可行性');
  }
 }
 const report=cpmReport(data),byId=new Map<string,any>(activities.map((a:any)=>[a.id,a]));
 for(const edge of report.relationships){
  if(edge.non_driving)continue;
  const a=byId.get(edge.successor);
  if(edge.historical_conflict)push(a,'警告',`${edge.predecessor_code} → ${edge.successor_code} ${edge.type}：实际日期与逻辑关系存在历史顺序冲突`);
  if(edge.violated&&(!edge.historical_conflict||edge.remaining_start))push(a,'警告',`${edge.predecessor_code} → ${edge.successor_code} ${edge.type}：当前排程关系不满足，请核对实际日期或强制约束`);
 }
 for(const diagnostic of data.constraint_diagnostics||[]){const a=lookup.get(diagnostic.id);if(a)for(const message of diagnostic.messages)push(a,'警告',message);}
 for(const message of data.path_warnings||[])items.push({code:'—',name:'路径计算',severity:'提示',message});
 if(data.deadline_missed)items.push({code:'—',name:'项目要求完工',severity:'警告',message:'网络完成晚于要求日期，强制约束可能固定了自身浮时，请单独核对'});
 return {items,count:activities.length,critical:activities.filter((a:any)=>a.critical).length,negative:activities.filter((a:any)=>a.float< -1e-7).length,milestones:activities.filter((a:any)=>!isLoe(a)&&a.duration===0).length};
}
export function baselineComparison(data:any,index=0){
 const base=data?.baselines?.[index],rows=base?.snapshot?.activities||[];
 if(!base)return [];
 const start=base.snapshot.start_date||data.start_date;
 const origin=(Date.parse(start)-Date.parse(data.start_date))/86400000;
 const byId=new Map(rows.map((a:any)=>[a.id,a]));
 return data.activities.map((a:any)=>{const b:any=byId.get(a.id);return {id:a.id,code:a.code,name:a.name,baseline_start:b?calendarDate(start,b.es):null,baseline_finish:b?calendarDate(start,b.ef):null,current_start:calendarDate(data.start_date,a.es),current_finish:calendarDate(data.start_date,a.ef),start_variance:b?Math.round((a.es-b.es-origin)*100)/100:null,finish_variance:b?Math.round((a.ef-b.ef-origin)*100)/100:null,progress:a.progress};});
}
export function wbsSummaries(nodes:any[],activities:any[],method='duration'){
 const children=new Map<string,string[]>();
 for(const n of nodes){const key=n.parent_id||'';if(!children.has(key))children.set(key,[]);children.get(key)!.push(n.id);}
 const result=new Map<string,any>();
 for(const n of [...nodes].reverse()){
  const own=activities.filter(a=>a.custom_data?.wbs?.[0]===n.id);
  const descendants=(children.get(n.id)||[]).flatMap(id=>result.get(id)?.activities||[]);
  const all=[...own,...descendants],physical=all.filter(a=>!isLoe(a)),weight=method==='equal'?0:physical.reduce((s,a)=>s+a.duration,0);
  result.set(n.id,{activities:all,count:all.length,es:all.length?Math.min(...all.map(a=>a.es)):null,ef:all.length?Math.max(...all.map(a=>a.ef)):null,progress:physical.length?physical.reduce((s,a)=>s+a.progress*(weight?a.duration:1),0)/(weight||physical.length):0});
 }
 return result;
}
