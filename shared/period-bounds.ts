import {calendarDate} from './project-calendar.ts';
export function periodBounds(date:string,series:string){
 const d=new Date(date+'T00:00:00Z');
 if(series==='weekly'){const offset=(d.getUTCDay()+6)%7;const start=calendarDate(date,-offset);return {start,end:calendarDate(start,6)};}
 if(series==='monthly'){const start=date.slice(0,7)+'-01',next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10);return {start,end:calendarDate(next,-1)};}
 return {start:date,end:date};
}
