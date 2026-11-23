import {calendarDate,calendarHours,type ProjectCalendar} from './project-calendar.ts';import {remainingDays} from './remaining-resources.ts';import {resourceTicks,resourceText} from './resource-values.ts';
export function actualRemainingDuration(a:any,calendar:ProjectCalendar,dataDate:string){
 const valid=!!a.actual_start&&a.actual_start<=dataDate&&(!a.actual_finish||a.actual_finish>=a.actual_start&&a.actual_finish<=dataDate);
 const end=a.actual_finish?calendarDate(a.actual_finish,1):dataDate;
 const elapsed=valid?(Number(a.duration)===0&&a.activity_type!=='LOE持续性作业'?0:Math.max(0,Math.round(calendarHours(calendar,a.actual_start,end)))):null;
 return {original_work_hours:Math.round(Number(a.original_duration??a.duration)*calendar.hours_per_day),actual_elapsed_hours:elapsed,remaining_work_hours:Math.round(remainingDays(a,calendar.hours_per_day)*calendar.hours_per_day),actual_duration_basis:a.actual_finish?'actual_dates_inclusive':'data_date_start',actual_duration_valid:valid};
}
export function actualRemainingUnits(actual:string|null|undefined,remaining:string){
 return {actual_units:actual??null,actual_units_reported:actual!=null,forecast_total_units:actual==null?null:resourceText(resourceTicks(actual)+resourceTicks(remaining))};
}
