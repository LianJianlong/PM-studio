import {Temporal} from '@js-temporal/polyfill';
export type RepeatRule={anchor_at:string|Date;time_zone:string;repeat_kind:'once'|'day'|'week'|'month';repeat_interval:number;weekdays:number[];month_days?:number[]};
/** Calendar-based recurrence keeps local clock time and the original day-of-month anchor. */
export function nextReportOccurrence(rule:RepeatRule,after=new Date()):string|null{
 if(!['once','day','week','month'].includes(rule.repeat_kind))throw Error('不支持的重复方式');
 const anchor=Temporal.Instant.from(new Date(rule.anchor_at).toISOString()).toZonedDateTimeISO(rule.time_zone),start=anchor.toPlainDateTime(),date=start.toPlainDate();
 const now=Temporal.Instant.from(after.toISOString()),today=now.toZonedDateTimeISO(rule.time_zone).toPlainDate();
 const step=rule.repeat_interval;if(!Number.isInteger(step)||step<1||step>365)throw Error('重复间隔应为1至365');
 const candidate=(plain:Temporal.PlainDateTime)=>{const instant=plain.toZonedDateTime(rule.time_zone,{disambiguation:'compatible'}).toInstant();return Temporal.Instant.compare(instant,now)>0&&Temporal.Instant.compare(instant,anchor.toInstant())>=0?instant.toString():null};
 if(rule.repeat_kind==='once')return candidate(start);
 if(rule.repeat_kind==='week'){
  if(!rule.weekdays.length||rule.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))throw Error('请选择星期');
  const monday=date.subtract({days:date.dayOfWeek-1});let day=Temporal.PlainDate.compare(today,date)<0?date:today;
  for(let i=0;i<step*7+8;i++,day=day.add({days:1})){
   const week=Math.floor(monday.until(day,{largestUnit:'days'}).days/7);
   if(week%step===0&&rule.weekdays.includes(day.dayOfWeek)){const value=candidate(day.toPlainDateTime(start.toPlainTime()));if(value)return value}
  }
 }else{
  const distance=rule.repeat_kind==='day'?date.until(today,{largestUnit:'days'}).days:(today.year-date.year)*12+today.month-date.month;
  const base=Math.max(0,Math.floor(distance/step));
  for(let i=base;i<=base+3;i++){
   const period=start.add(rule.repeat_kind==='day'?{days:i*step}:{months:i*step},{overflow:'constrain'});
   let dates=[period.toPlainDate()];
   if(rule.repeat_kind==='month'&&rule.month_days?.length){
    if(rule.month_days.some(d=>!Number.isInteger(d)||d<1||d>31))throw Error('请选择有效的每月日期');
    dates=rule.month_days.map(day=>period.toPlainDate().with({day},{overflow:'constrain'}));
   }
   dates.sort(Temporal.PlainDate.compare);
   for(const d of dates){const value=candidate(d.toPlainDateTime(start.toPlainTime()));if(value)return value}
  }
 }
 throw Error('无法计算下次执行时间');
}

/** Build the hidden calendar anchor for an alarm whose user-facing input is only HH:mm. */
export function reportClockAnchor(time:string,zone:string,kind:RepeatRule['repeat_kind'],previous?:{anchor_at:string|Date;time_zone:string;repeat_kind?:string},now=new Date()):string{
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('请输入有效时间');
 const instant=Temporal.Instant.from(now.toISOString()),today=instant.toZonedDateTimeISO(zone).toPlainDate();
 if(kind==='once'&&previous?.repeat_kind==='once'&&previous.time_zone===zone){const old=Temporal.Instant.from(new Date(previous.anchor_at).toISOString());if(Temporal.Instant.compare(old,instant)>0&&old.toZonedDateTimeISO(zone).toPlainTime().toString({smallestUnit:'minute'})===time)return old.toString()}
 let date=previous&&kind!=='once'?Temporal.Instant.from(new Date(previous.anchor_at).toISOString()).toZonedDateTimeISO(previous.time_zone).toPlainDate():today;
 let value=date.toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime(zone,{disambiguation:'compatible'}).toInstant();
 if(kind==='once'&&Temporal.Instant.compare(value,instant)<=0)value=date.add({days:1}).toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime(zone,{disambiguation:'compatible'}).toInstant();
 return value.toString();
}
