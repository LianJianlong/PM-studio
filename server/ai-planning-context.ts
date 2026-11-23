import {access,tableAccess,visibleColumns} from './auth.ts';
import {pool} from './db.ts';
export async function aiPlanningBindings(user:string,project:string){
 await access(user,project);const rows=(await pool.query('SELECT kind,table_id FROM planning_tables WHERE project_id=$1 ORDER BY kind',[project])).rows;
 const bindings:any[]=[];for(const row of rows){try{const t=await tableAccess(user,row.table_id);bindings.push({kind:row.kind,table_id:row.table_id,name:t.table.name,project_id:project,columns:visibleColumns(t.permission,t.table),records_path:`/tables/${row.table_id}/records`,module_path:row.kind==='wbs'?'计划管理 / WBS':'计划管理 / 组织架构'});}catch{}}
 return bindings;
}
