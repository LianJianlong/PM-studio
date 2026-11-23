import type {Request} from 'express';import {pool,audit} from './db.ts';import {tableAccess,visibleColumns,projectRecord,rowAllowed,requireThat} from './auth.ts';
export async function readAIEvidence(req:Request,project:string,table:string,record:string){
 const t=await tableAccess(req.user.id,table);requireThat(t.table.project_id===project,403,'依据不属于当前项目');
 const r=(await pool.query("SELECT * FROM records WHERE id=$1 AND table_id=$2 AND lifecycle='active'",[record,table])).rows[0];requireThat(r&&rowAllowed(t.permission,r,req.user.id),404,'依据已不可读取，请重新分析');
 await audit(pool,t.permission.workspace_id,req.user.id,'AI查看业务依据',record,{table:t.table.name,version:r.version});
 const p=projectRecord(t.permission,t.table,r);return {table_name:t.table.name,status:r.status,version:r.version,columns:visibleColumns(t.permission,t.table).filter((f:any)=>f.type!=='reference').map((f:any)=>({name:f.name,value:p.values?.[f.id]??p.data[f.id]??null})),notice:'此处为当前授权数据，可能与分析时版本不同；关联字段不展开内部标识。'};
}
