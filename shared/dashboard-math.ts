import {isLoe} from './loe.ts';
import {evaluateFormula} from './formulas.ts';
import {naturalCalendar,workingDateMinutes,calendarDate,type ProjectCalendar} from './project-calendar.ts';
export function earnedMetrics(pv:unknown,ev:unknown,ac:unknown){const v={pv:String(pv),ev:String(ev),ac:String(ac)};return {...v,cv:evaluateFormula('[ev]-[ac]',v),sv:evaluateFormula('[ev]-[pv]',v),cpi:evaluateFormula('IF([ac]=0,null,[ev]/[ac])',v),spi:evaluateFormula('IF([pv]=0,null,[ev]/[pv])',v)};}
export function planProgressPoints(activities:any[],start:string,calendar:ProjectCalendar|null,method='duration'){
 activities=activities.filter(a=>!isLoe(a));
 const c=calendar||naturalCalendar,equal=method==='equal'||!activities.some(a=>Number(a.duration)>0),total=activities.reduce((s,a)=>s+(equal?1:Number(a.duration)),0);if(!total)return [];
 const changes=new Map<string,number>();const first=calendarDate(start,-1);changes.set(first,0);
 for(const a of activities){const weight=equal?1:Number(a.duration);if(!weight)continue;if(!Number(a.duration)){const date=calendarDate(start,Math.max(0,Math.ceil(a.ef)-1));changes.set(date,(changes.get(date)||0)+weight);continue;}const days=workingDateMinutes(c,start,Number(a.es),Number(a.ef)),minutes=days.reduce((s,d)=>s+d.minutes,0);for(const d of days)changes.set(d.date,(changes.get(d.date)||0)+weight*d.minutes/minutes);}
 const dates=[...changes.keys()].sort();let cumulative=0;const end=dates.at(-1)!;const points=[];for(let date=dates[0],n=0;date<=end;date=calendarDate(date,1),n++){if(n>40000)throw Error('S曲线跨度超过100年');cumulative+=changes.get(date)||0;points.push({date,planned:Math.min(100,Number((cumulative/total*100).toFixed(6)))});}return points;
}
export function latestSnapshots(rows:{id:string;data:any}[],dateField:string,fields:string[],today:string){const byDate=new Map<string,any>();for(const r of rows){const date=String(r.data[dateField]||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today)continue;if(byDate.has(date))throw Error('同一统计日期存在多条已审核项目级快照，请保留一条有效版本');for(const field of fields)if(r.data[field]===null||r.data[field]===undefined||r.data[field]==='')throw Error('快照缺少必要数值，不能按零计算');byDate.set(date,{date,...Object.fromEntries(fields.map(f=>[f,r.data[f]]))});}return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));}
