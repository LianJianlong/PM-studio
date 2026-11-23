export function planDateFields(columns:any[]){
 const active=columns.filter(f=>f.lifecycle!=='deleted'&&f.type==='date');
 return {
  start:active.find(f=>f.plan_date==='start')||active.find(f=>['planned_start','start_date'].includes(f.id)||['开始时间','计划开始','计划开始时间','开始日期'].includes(f.name)),
  finish:active.find(f=>f.plan_date==='finish')||active.find(f=>['planned_finish','finish_date','finish'].includes(f.id)||['完成时间','计划完成','计划完成时间','完成日期'].includes(f.name)),
 };
}
