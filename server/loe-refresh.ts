import type pg from 'pg';import {attachPlanStarts,completePlanScope} from './plan-dates.ts';import {schedule} from './schedule.ts';import {defaultProjectCalendar} from '../shared/project-calendar.ts';import {isLoe} from '../shared/loe.ts';
/** Flush derived support durations inside the same business transaction. No read-side writes. */
export async function flushLoe(c:pg.PoolClient){
 const setting=(await c.query("SELECT current_setting('app.loe_dirty',true) value")).rows[0]?.value;
 if(!setting)return;const projects:string[]=JSON.parse(setting);if(!projects.length)return;
 await c.query("SELECT set_config('app.loe_dirty','[]',true),set_config('app.loe_refreshing','on',true)");
 try{for(const project of [...new Set(projects)].sort()){
  if(!(await c.query("SELECT 1 FROM activities a JOIN plan_activity_records l ON l.activity_id=a.id JOIN records r ON r.id=l.record_id WHERE a.project_id=$1 AND r.lifecycle='active' AND r.status<>'obsolete' AND r.data->>'activity_type'='LOE持续性作业' LIMIT 1",[project])).rowCount)continue;
  const p=(await c.query('SELECT start_date,calendar_config,progress_method FROM projects WHERE id=$1',[project])).rows[0];if(!p)continue;
  const raw=(await c.query("SELECT a.* FROM activities a JOIN plan_activity_records l ON l.activity_id=a.id JOIN records r ON r.id=l.record_id WHERE a.project_id=$1 AND r.lifecycle='active' AND r.status<>'obsolete'",[project])).rows;
  const complete=await completePlanScope(project,raw,c,true);const planned=schedule(complete,p.calendar_config||defaultProjectCalendar,p.start_date,p.progress_method);
  const values=new Map(planned.activities.filter(isLoe).map(a=>[a.id,a.duration]));const typed=await attachPlanStarts(project,raw,c);
  for(const a of typed.filter(isLoe)){const duration=Number((values.get(a.id)||0).toFixed(8));await c.query('UPDATE activities SET duration=$2,version=version+1 WHERE id=$1 AND duration IS DISTINCT FROM $2::numeric',[a.id,duration]);}
 }}finally{await c.query("SELECT set_config('app.loe_refreshing','off',true)");}
}
