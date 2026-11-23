export type ReportPeriod='day'|'week'|'fortnight'|'month';
export function reportPeriodWindow(period:ReportPeriod,now=new Date(),zone='Europe/Helsinki'){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=(type:string)=>parts.find(p=>p.type===type)!.value;
 const today=`${get('year')}-${get('month')}-${get('day')}`,from=new Date(today+'T00:00:00Z'),to=new Date(from);
 if(period==='week'){const offset=(from.getUTCDay()+6)%7;from.setUTCDate(from.getUTCDate()-offset);to.setUTCDate(from.getUTCDate()+6);}
 if(period==='fortnight')from.setUTCDate(from.getUTCDate()-13);
 if(period==='month'){from.setUTCDate(1);to.setUTCMonth(to.getUTCMonth()+1,0);}
 return {dateFrom:from.toISOString().slice(0,10),dateTo:to.toISOString().slice(0,10)};
}
export function resolveReportPeriod<T extends {datePreset?:ReportPeriod;dateFrom?:string;dateTo?:string}>(input:T,now=new Date(),zone='Europe/Helsinki'):T{
 return input.datePreset&&!input.dateFrom&&!input.dateTo?{...input,...reportPeriodWindow(input.datePreset,now,zone)}:input;
}
