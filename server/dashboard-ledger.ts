import {pool} from './db.ts';
import {tableAccess,visibleColumns,projectRecord,canManage,rowAllowed,requireThat} from './auth.ts';
import {reportPeriodWindow} from '../shared/report-period.ts';
import {ledgerSpecs,ledgerPriority} from '../shared/dashboard-ledger.ts';
export async function projectLedger(user:string,project:string,tableId:string,kind:string,status:string,page:number){
 const {table,permission}=await tableAccess(user,tableId);requireThat(table.project_id===project,403);const spec=ledgerSpecs[kind];requireThat(spec,400,'不支持的台账类型');const visible=visibleColumns(permission,table),allowed=new Set(visible.map((f:any)=>f.id)),columns=spec.columns.filter(id=>allowed.has(id)).map(id=>({id,name:visible.find((f:any)=>f.id===id)!.name}));
 const today=reportPeriodWindow('day',new Date(),process.env.REPORT_TIME_ZONE||'Europe/Helsinki').dateFrom,params:any[]=[tableId,status,user];const text=(id:string)=>allowed.has(id)?`data->>'${id}'`:'NULL';const state=text(spec.state),deadline=text(spec.deadline),closed=spec.closed.map(v=>"'"+v+"'").join(',');params.push(today);
 const rank=`CASE WHEN ${state} IN (${closed}) THEN 4 WHEN ${text('priority')}='紧急' OR ${text('risk_level')}='高' OR ${text('result')}='不通过' THEN 0 WHEN ${text('priority')}='高' OR (${deadline} IS NOT NULL AND ${deadline}<>'' AND ${deadline}<$4) THEN 1 WHEN ${text('priority')}='低' THEN 3 ELSE 2 END`;
 const where="table_id=$1 AND $3::text<>'' AND lifecycle='active' AND status='approved' AND ($2='all' OR status=$2)"+(canManage(permission)?'':' AND (agenda_owner_id IS NULL OR agenda_owner_id=$3::uuid)')+(!canManage(permission)&&permission.row_scope==='own'?' AND created_by=$3::uuid':'');
 const result=await pool.query(`SELECT *,${rank} AS priority_rank FROM records WHERE ${where} ORDER BY priority_rank,updated_at DESC,id LIMIT ${page*50}`,params);
 const count=await pool.query(`SELECT count(*)::int AS total FROM records WHERE ${where}`,params.slice(0,3));
 return {columns,rows:result.rows.filter(r=>rowAllowed(permission,r,user)).map(r=>{const projected=projectRecord(permission,table,r);return {id:r.id,data:projected.data,priority:ledgerPriority(kind,projected.data,today),updated_at:r.updated_at};}),total:count.rows[0].total,page,pageSize:50,source:table.name,note:'紧急、高优先级、逾期和未通过事项优先；同级按更新时间倒序，完成事项置后。仅展示当前授权范围的有效记录。'};
}
