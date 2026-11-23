import type pg from 'pg';import {pool} from './db.ts';import {requireFullPlanRead} from './planning-read-access.ts';
import {recordVisibilitySql} from './auth.ts';import {effectiveActivities} from './effective-activities.ts';import {completePlanScope} from './plan-dates.ts';
export async function readPlanActivities(user:string,permission:any,preview=false,c:pg.Pool|pg.PoolClient=pool){
 await requireFullPlanRead(permission,c);
 if(!preview)return effectiveActivities(permission.id,c);
 const binding=(await c.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1',[permission.id])).rows[0];
 if(!binding)return effectiveActivities(permission.id,c);
 let rows=(await c.query(`SELECT activity.* FROM activities activity JOIN plan_activity_records l ON l.activity_id=activity.id
 JOIN records r ON r.id=l.record_id WHERE activity.project_id=$1 AND r.table_id=$2 AND r.lifecycle='active' AND r.status<>'obsolete' AND ${recordVisibilitySql(permission,'$3')}`,[permission.id,binding.table_id,user])).rows;
 return completePlanScope(permission.id,rows,c,true);
}
