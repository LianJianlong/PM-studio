import {resourceTicks,resourceText} from './resource-values.ts';
import {calendarDate,calendarPeriods,minute,type ProjectCalendar} from './project-calendar.ts';
export function progressCosts(planned:string,progress:number){
 if(!Number.isFinite(progress)||progress<0||progress>100)throw Error('完成率必须在0至100之间');
 const budget=resourceTicks(planned),[mantissa,exp='0']=String(progress).toLowerCase().split('e'),parts=mantissa.split('.');
 const scale=(parts[1]?.length||0)-Number(exp);
 const percent=BigInt(parts.join(''))*(scale<0?10n**BigInt(-scale):1n),denominator=100n*(scale>0?10n**BigInt(scale):1n);
 const earned=(budget*percent+denominator/2n)/denominator;
 return {earned_cost:resourceText(earned),remaining_cost:resourceText(budget-earned)};
}
// Locate completion by consumed working minutes, preserving weekends, split shifts and exceptions.
export function progressMoment(calendar:ProjectCalendar,start:string,es:number,ef:number,progress:number){
 const ratio=Math.max(0,Math.min(100,progress))/100;
 if(ratio===0||es===ef)return es;if(ratio===1)return ef;
 const periods:Array<{from:number;to:number}>=[];
 for(let d=Math.floor(es);d<Math.ceil(ef);d++)for(const [s,e] of calendarPeriods(calendar,calendarDate(start,d))){
  const from=Math.max(es*1440,d*1440+minute(s)),to=Math.min(ef*1440,d*1440+minute(e));
  if(to>from)periods.push({from,to});
 }
 let remaining=periods.reduce((n,p)=>n+p.to-p.from,0)*ratio;
 for(const p of periods){if(remaining<=p.to-p.from)return (p.from+remaining)/1440;remaining-=p.to-p.from;}
 return es;
}
