import {editableRecord} from '../shared/record-policy.ts';
import {BATCH_CREATE_LIMIT,BATCH_UPDATE_LIMIT,BATCH_DELETE_LIMIT} from '../shared/batch-limits.ts';
import {pool} from './db.ts';
import {rowAllowed} from './auth.ts';
import {z} from 'zod';
import {tableAccess,visibleColumns,canRecordAction,requireThat} from './auth.ts';
import {validateRecord} from './validation.ts';
export async function validateAIRecordWrite(user:string,operation:{method:string;path:string;body?:any}){
 const match=/^\/tables\/([a-f0-9-]{36})\/(records|import|records\/batch-update|records\/batch-delete)$/i.exec(operation.path);
 if(operation.method!=='POST'||!match)return;
 const {table,permission}=await tableAccess(user,match[1]);
 if(match[2].startsWith('records/batch-')){
  const update=match[2].endsWith('update');requireThat(canRecordAction(permission,table,update?'update':'delete'));
  const rows=z.array(z.object({id:z.uuid(),version:z.number().int().positive(),...(update?{data:z.record(z.string(),z.unknown())}:{})})).min(1).max(update?BATCH_UPDATE_LIMIT:BATCH_DELETE_LIMIT).parse(operation.body?.records);
  requireThat(new Set(rows.map(r=>r.id)).size===rows.length,400,'批量记录不能重复');
  const records=(await pool.query('SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[])',[table.id,rows.map(r=>r.id)])).rows,byId=new Map(records.map(r=>[r.id,r]));
  const allowed=new Set(visibleColumns(permission,table).map((f:any)=>f.id));
  for(const row of rows){const record=byId.get(row.id);requireThat(record&&rowAllowed(permission,record,user),403,'部分记录不存在或无权操作');requireThat(record.version===row.version&&record.lifecycle==='active'&&(update?editableRecord(table,record.status):['draft','rejected'].includes(record.status)),409,'部分记录版本已变化或不允许直接修改/删除');
   if(update){const values=(row as any).data;requireThat(Object.keys(values).every(k=>allowed.has(k)),403,'包含未定义或无权访问的字段');requireThat(!table.columns.some((f:any)=>f.type==='formula'&&Object.hasOwn(values,f.id)),400,'公式字段只读，不能填写');validateRecord(table.columns,{...record.data,...values},record.created_at);}
  }return;
 }
 requireThat(canRecordAction(permission,table,'create'));
 const b=operation.body||{},batch=match[2]==='import';
 requireThat(batch?Array.isArray(b.rows)&&b.rows.length>=1&&b.rows.length<=BATCH_CREATE_LIMIT:b.data&&typeof b.data==='object'&&!Array.isArray(b.data),400,batch?'批量新增使用 {rows:[{字段ID:值}]}，每批1至5000条':'新增记录须使用 {data:{字段ID:值}}；批量新增使用 /tables/{table}/import {rows:[...]}');
 const fields=new Set(visibleColumns(permission,table).map((f:any)=>f.id));
 for(const [index,row] of (batch?b.rows:[b.data]).entries()){
  requireThat(row&&typeof row==='object'&&!Array.isArray(row),400,`第${index+1}行须为字段值对象`);
  requireThat(Object.keys(row).every(k=>fields.has(k)),403,`第${index+1}行包含未定义或无权访问的字段；请先读取表字段目录`);
  try{validateRecord(table.columns,row)}catch(e){requireThat(false,400,`第${index+1}行：${(e as Error).message}`)}
 }
}
