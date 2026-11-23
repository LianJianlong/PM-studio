import {resourceTicks,resourceText,distributeResourceByMinutes} from './resource-values.ts';
import {progressCosts} from './plan-progress.ts';
import {workingDateMinutes,type ProjectCalendar} from './project-calendar.ts';
export function signedMoney(value:bigint){return (value<0n?'-':'')+resourceText(value<0n?-value:value);}
function divided(n:bigint,d:bigint){if(d===0n)return null;const negative=(n<0n)!==(d<0n);const a=n<0n?-n:n,b=d<0n?-d:d;const q=(a+b/2n)/b;return negative?-q:q;}
export function performanceMetrics(bac:string,pv:string|null,ev:string,ac:string,method='cpi'){
 const B=resourceTicks(bac),P=pv===null?null:resourceTicks(pv),E=resourceTicks(ev),A=resourceTicks(ac),valid=B>=0n&&E>=0n&&A>=0n&&E<=B&&(P===null||P>=0n&&P<=B),work=B-E;
 const ratio=(n:bigint,d:bigint)=>{const v=divided(n*1000000n,d);if(v===null)return null;const a=v<0n?-v:v;return `${v<0n?'-':''}${a/1000000n}.${(a%1000000n).toString().padStart(6,'0')}`;};
 const eac=!valid?null:B>0n&&E===B?A:method==='remaining_budget'?A+work:method==='cpi_spi'?(E>0n&&P!==null&&P>0n&&A>0n?A+divided(work*A*P,E*E)!:null):(E>0n&&A>0n?divided(B*A,E):null);
 return {bac,pv,ev,ac,inputs_valid:valid,cv:valid?signedMoney(E-A):null,sv:valid&&P!==null?signedMoney(E-P):null,cpi:valid&&A>0n?ratio(E,A):null,spi:valid&&P!==null&&P>0n?ratio(E,P):null,eac:eac===null?null:signedMoney(eac),etc:eac===null?null:signedMoney(eac-A),vac:eac===null?null:signedMoney(B-eac),tcpi:valid&&work>0n&&B>A?ratio(work,B-A):null,tcpi_eac:valid&&work>0n&&eac!==null&&eac>A?ratio(work,eac-A):null,eac_method:method};
}
export function budgetPerformance(activities:any[],budgets:Record<string,string>,current:any[],calendar:ProjectCalendar,start:string,dataDate:string,pvAvailable=true){
 const byId=new Map(current.map(a=>[a.id,a]));let bac=0n,pv=0n,ev=0n;let missing=0;
 for(const a of activities){if(!Object.hasOwn(budgets,a.id)||budgets[a.id]==null)throw Error('基线缺少此作业预算，不能默认为零');const budget=String(budgets[a.id]),ticks=resourceTicks(budget);bac+=ticks;
  const now=byId.get(a.id);if(!now)missing++;ev+=resourceTicks(progressCosts(budget,Number(now?.progress||0)).earned_cost);
  if(!pvAvailable)continue;
  const days=workingDateMinutes(calendar,start,Number(a.es),Number(a.ef));
  if(days.length){const shares=distributeResourceByMinutes(budget,days.map(d=>d.minutes));for(let i=0;i<days.length;i++)if(days[i].date<=dataDate)pv+=shares[i];}
  else if(Number(a.duration)===0&&Number(a.es)===Number(a.ef)){const event=new Date(start);event.setUTCDate(event.getUTCDate()+Math.floor(Number(a.es)));if(event.toISOString().slice(0,10)<=dataDate)pv+=ticks;}
 }
 return {bac:resourceText(bac),pv:pvAvailable?resourceText(pv):null,ev:resourceText(ev),missing_activities:missing};
}
export function periodDelta(current:any,previous:any){
 const values:Record<string,string|null>={};for(const key of ['pv','ev','ac'])values[key]=current[key]==null||previous?.[key]==null?null:signedMoney(resourceTicks(String(current[key]))-resourceTicks(String(previous[key])));return values;
}
export function selectBaseline(rows:any[],key:string|undefined){if(!key||key==='latest')return rows[0];if(key==='none')return undefined;return /^\d+$/.test(key)?rows[Number(key)]:rows.find(b=>b.id===key);}
