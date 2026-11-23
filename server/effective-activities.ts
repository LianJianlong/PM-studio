import {completePlanScope} from './plan-dates.ts';
import type pg from 'pg';
import {pool} from './db.ts';
// Published calculations use confirmed records only. A dependent activity also
// waits until all of its predecessors are confirmed, preserving its logic.
export async function effectiveActivities(project:string,c:pg.Pool|pg.PoolClient=pool){
 const rows=(await c.query("SELECT a.*,d.name AS department_name FROM activities a LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN plan_activity_records l ON l.activity_id=a.id LEFT JOIN records r ON r.id=l.record_id WHERE a.project_id=$1 AND (NOT EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.project_id=a.project_id) OR r.status='approved' AND r.lifecycle='active') ORDER BY a.code,a.id",[project])).rows;
 return completePlanScope(project,rows,c);
}
