import {isLoe,completeLoeScope} from '../shared/loe.ts';
import {recordVisibilitySql} from './auth.ts';
import {activityPlanningValues,planningProgress} from '../shared/p6-planning.ts';
import type pg from 'pg';
import {pool} from './db.ts';
import {schedule,type Activity} from './schedule.ts';
import {planDateFields} from '../shared/plan-dates.ts';
import {defaultProjectCalendar,calendarDate} from '../shared/project-calendar.ts';
export async function attachPlanStarts(project:string,activities:Activity[],c:pg.Pool|pg.PoolClient=pool){
 activities=activities.map(a=>({...a,duration:Number(a.duration)}));
 const table=(await c.query('SELECT t.* FROM plan_data_tables b JOIN data_tables t ON t.id=b.table_id WHERE b.project_id=$1',[project])).rows[0];
 const options=(await c.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[project])).rows[0]?.options||{};
 if(!table)return activities.map(a=>({...a,schedule_options:options}));
 const field=planDateFields(table.columns).start;

 const rows=(await c.query("SELECT l.activity_id,l.record_id,r.data FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE r.table_id=$1 AND r.lifecycle='active' AND r.status<>'obsolete'",[table.id])).rows;
 const values=new Map(rows.map(r=>[r.activity_id,r.data])),linkedIds=new Map(rows.map(r=>[r.record_id,r.activity_id]));
 return activities.map(a=>{const data=values.get(a.id)||{};const extras=activityPlanningValues(data);
 const progress=planningProgress({...data,duration:a.duration},a.progress);
 return {...a,...extras,loe_scope:extras.loe_scope.map((id:string)=>linkedIds.get(id)||id),progress,schedule_options:options,start_not_before:field?data[field.id]||undefined:undefined} as Activity;});
}
export async function completePlanScope(project:string,activities:Activity[],c:pg.Pool|pg.PoolClient=pool,preview=false){
 const typed=await attachPlanStarts(project,activities,c);const all=(await c.query("SELECT l.activity_id FROM plan_activity_records l JOIN activities a ON a.id=l.activity_id JOIN records r ON r.id=l.record_id WHERE a.project_id=$1 AND r.data->>'activity_type'='LOE持续性作业'",[project])).rows;
 return completeLoeScope(typed,new Set(all.map(r=>r.activity_id)),preview);
}
export async function planRecordDates(project:string,c:pg.Pool|pg.PoolClient=pool,permission?:any,user?:string){
 const p=(await c.query('SELECT start_date,calendar_config FROM projects WHERE id=$1',[project])).rows[0];
 const rows=(await c.query("SELECT a.*,l.record_id FROM activities a JOIN plan_activity_records l ON l.activity_id=a.id JOIN records r ON r.id=l.record_id WHERE a.project_id=$1 AND r.lifecycle='active' AND r.status<>'obsolete'"+(permission?" AND "+recordVisibilitySql(permission,'$2'):""),permission?[project,user]:[project])).rows;
 const linked=await completePlanScope(project,rows,c,true);
 const planned=schedule(linked,p.calendar_config||defaultProjectCalendar,p.start_date);
 return new Map(planned.activities.map((a:any)=>[a.record_id,{
  loe:isLoe(a),duration:a.duration,remaining_duration:a.remaining_duration,
  start:calendarDate(p.start_date,Math.floor(a.es+1e-8)),
  finish:calendarDate(p.start_date,Math.floor(a.ef+1e-8)),
 }]));
}
