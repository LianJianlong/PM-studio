import type pg from 'pg';import {pool} from './db.ts';
import {canManage,operationAllowed,tableAllowed,visibleColumns,requireThat} from './auth.ts';
/** Full dependency graphs, snapshots and resource aggregates can infer hidden rows/fields.
 * Keep scoped record grids available, but never return an incomplete graph as a full plan.
 */
export async function canReadFullPlan(a:any,c:pg.Pool|pg.PoolClient=pool){
 if(!operationAllowed(a,'$data','read'))return false;
 if(canManage(a))return true;
 if(a.row_scope==='own')return false;
 const t=(await c.query('SELECT t.* FROM plan_data_tables p JOIN data_tables t ON t.id=p.table_id WHERE p.project_id=$1',[a.id])).rows[0];
 if(!t)return !a.department_id&&!a.table_ids?.length&&!a.hidden_columns?.length;
 return tableAllowed(a,t)&&visibleColumns(a,t).length===t.columns.filter((f:any)=>f.lifecycle!=='deleted').length;
}
export async function requireFullPlanRead(a:any,c:pg.Pool|pg.PoolClient=pool){requireThat(await canReadFullPlan(a,c),403,'完整计划及资源费用汇总需要作业表全部行、列的读取权限；仍可在作业数据表查看已授权内容');}
