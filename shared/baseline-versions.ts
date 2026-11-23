import {calendarDate} from './project-calendar.ts';
import {resourceTicks,resourceText} from './resource-values.ts';
const dateAt=(start:string,row:any,key:string)=>Number.isFinite(Number(row?.[key]))&&row?.[key]!=null?calendarDate(start,Number(row[key])):null;
const days=(a:string|null,b:string|null)=>a&&b?Math.round((Date.parse(a)-Date.parse(b))/86400000):null;
/** Compare frozen schedules by internal identity, never by mutable code/name. */
export function compareBaselineVersions(current:any,baselines:any[],budgets:Record<string,string>={},currency=''){
 const now=new Map<string,any>(current.activities.map((a:any)=>[a.id,a]));
 return baselines.map(base=>{
  const snapshot=base.snapshot||{},supported=Array.isArray(snapshot.activities),old=new Map<string,any>((supported?snapshot.activities:[]).map((a:any)=>[a.id,a]));
  const keys=[...new Set([...now.keys(),...old.keys()])].sort((x,y)=>String(now.get(x)?.code||old.get(x)?.code||'').localeCompare(String(now.get(y)?.code||old.get(y)?.code||''),'en',{numeric:true})||x.localeCompare(y));
  const rows=keys.map(id=>{
   const a=now.get(id),b=old.get(id),cs=a?dateAt(current.start_date,a,'es'):null,cf=a?dateAt(current.start_date,a,'ef'):null,bs=b?dateAt(snapshot.start_date||current.start_date,b,'es'):null,bf=b?dateAt(snapshot.start_date||current.start_date,b,'ef'):null;
   const sameCurrency=snapshot.currency===currency;
   const bc=b&&sameCurrency&&Object.hasOwn(snapshot.budget_by_activity||{},id)?String(snapshot.budget_by_activity[id]):null,cc=a&&Object.hasOwn(budgets,id)?budgets[id]:null;
   return {id,code:a?.code||b?.code||'',name:a?.name||b?.name||'',baseline_code:b?.code||null,baseline_name:b?.name||null,status:!supported?'不可比较':!b?'新增作业':!a?'仅基线存在':'对应作业',current_start:cs,current_finish:cf,baseline_start:bs,baseline_finish:bf,start_variance:days(cs,bs),finish_variance:days(cf,bf),current_duration_hours:a?Math.round(Number(a.duration)*(current.calendar_config?.hours_per_day||8)):null,baseline_duration_hours:b?Math.round(Number(b.duration)*(snapshot.calendar_config?.hours_per_day||8)):null,current_budget:cc,baseline_budget:bc,budget_variance:cc!==null&&bc!==null?resourceText(resourceTicks(cc)-resourceTicks(bc)):null};
  });
  const finish=(rs:any[],start:string)=>{const dates=rs.map(x=>dateAt(start,x,'ef')).filter((v):v is string=>!!v);return dates.length?dates.sort().at(-1)!:null;};
  const currentFinish=finish([...now.values()],current.start_date),baselineFinish=supported?finish([...old.values()],snapshot.start_date||current.start_date):null;
  return {id:base.id,name:base.name,created_at:base.created_at,supported,currency:snapshot.currency||null,budget_available:!!snapshot.budget_by_activity&&snapshot.currency===currency,current_finish:currentFinish,baseline_finish:baselineFinish,finish_variance:days(currentFinish,baselineFinish),counts:{matched:rows.filter(x=>x.status==='对应作业').length,added:supported?rows.filter(x=>x.status==='新增作业').length:0,baseline_only:rows.filter(x=>x.status==='仅基线存在').length},rows};
 });
}
