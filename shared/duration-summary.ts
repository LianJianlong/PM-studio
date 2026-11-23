export function durationParts(workDays:number,hoursPerDay=8){
 const totalHours=Math.max(0,Math.ceil((Number(workDays)||0)*hoursPerDay-1e-7));
 if(!Number.isInteger(hoursPerDay)||hoursPerDay<1)return {days:0,hours:totalHours,total_hours:totalHours};
 return {days:Math.floor(totalHours/hoursPerDay),hours:totalHours%hoursPerDay,total_hours:totalHours};
}
export function durationText(workDays:number,hoursPerDay=8){const p=durationParts(workDays,hoursPerDay);return p.hours?(p.days?`${p.days}天${p.hours}小时`:`${p.hours}小时`):`${p.days}天`;}
export function durationSummary(activities:any[],hoursPerDay=8){
 if(!activities.length)return {work_span:0,total_hours:0,days:0,hours:0,calendar_days:0,start_offset:0,finish_offset:0};
 const start=Math.min(...activities.map(a=>a.es)),finish=Math.max(...activities.map(a=>a.ef));
 const workStart=Math.min(...activities.map(a=>a.work_es??a.es)),workFinish=Math.max(...activities.map(a=>a.work_ef??a.ef));
 const workSpan=Math.max(0,workFinish-workStart);
 return {work_span:workSpan,...durationParts(workSpan,hoursPerDay),calendar_days:Math.max(1,Math.floor(finish+1e-8)-Math.floor(start+1e-8)+1),start_offset:start,finish_offset:finish};
}
