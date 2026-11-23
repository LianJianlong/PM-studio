import type {Period} from './project-calendar.ts';
export function hourPeriodText(periods:Period[]){return periods.map(p=>p.map(t=>String(Number(t.slice(0,2)))).join('-')).join('; ');}
export function parseHourPeriods(text:string):Period[]{
 if(!text.trim())return [];
 return text.split(/[;；]/).filter(s=>s.trim()).map(part=>{
  const items=part.trim().split('-').map(s=>s.trim());
  if(items.length!==2||items.some(s=>!/^\d{1,2}(?::00)?$/.test(s)))throw Error('工作时段只支持整小时，例如8-12; 13-17');
  const hours=items.map(s=>Number(s.split(':')[0]));
  if(hours[0]<0||hours[0]>=24||hours[1]>24||hours[1]<=hours[0])throw Error('工作时段须在0至24小时之间且开始早于结束');
  return hours.map(h=>String(h).padStart(2,'0')+':00') as Period;
 });
}
