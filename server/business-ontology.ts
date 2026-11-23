import {Router} from 'express';import {z} from 'zod';
import {pool,tx,requestTransaction,audit,uid} from './db.ts';
import {access,canManage,tableAccess,tableAllowed,visibleColumns,requireThat,HttpError} from './auth.ts';
import {ontologyDefinition,validateOntologyDefinition,projectOntologyDefinition} from '../shared/business-ontology.ts';
export const businessOntology=Router();
export async function visibleBusinessObjects(user:string,project:string){
 const a=await access(user,project),tables=(await pool.query("SELECT * FROM data_tables WHERE project_id=$1 AND lifecycle='active' ORDER BY name,id",[project])).rows.filter(t=>tableAllowed(a,t)),ids=new Set<string>(tables.map(t=>t.id));
 const definitions=(await pool.query('SELECT table_id,definition,enabled,version,updated_at FROM project_business_objects WHERE project_id=$1 ORDER BY table_id',[project])).rows;
 const objects:any[]=[];for(const t of tables){const row=definitions.find(d=>d.table_id===t.id);if(!row||!canManage(a)&&!row.enabled)continue;try{objects.push({...row,definition:projectOntologyDefinition(row.definition,visibleColumns(a,t),ids)})}catch{objects.push({table_id:t.id,enabled:false,version:row.version,unavailable:true})}}
 return {a,tables,objects};
}
businessOntology.get('/projects/:project/business-ontology',async(req,res)=>{const p=z.uuid().parse(req.params.project),s=await visibleBusinessObjects(req.user.id,p);res.json({can_manage:canManage(s.a),objects:s.objects,tables:s.tables.map(t=>({id:t.id,name:t.name,columns:visibleColumns(s.a,t).map((f:any)=>({id:f.id,name:f.name,type:f.type,unit:f.unit||'',...(f.type==='reference'&&s.tables.some(x=>x.id===f.target_table)?{target_table:f.target_table}:{})}))})),notice:'业务定义只描述真实表与字段，不复制记录、不合并同名对象、不改变原有权限或字段单位。'});});
businessOntology.put('/projects/:project/business-ontology/:table',async(req,res)=>{
 const p=z.uuid().parse(req.params.project),table=z.uuid().parse(req.params.table),b=z.object({version:z.number().int().min(0),enabled:z.boolean(),definition:ontologyDefinition}).strict().parse(req.body);
 const result=await tx(c=>requestTransaction.run(c,async()=>{
 let s=await tableAccess(req.user.id,table);requireThat(s.table.project_id===p,403,'仅管理当前项目的业务定义');requireThat(canManage(s.permission),403,'只有项目管理员可设置业务定义');requireThat(s.permission.lifecycle==='active'&&s.permission.workspace_lifecycle==='active'&&s.table.lifecycle==='active',409,'空间、项目及数据表须为活动状态');
 requireThat(visibleColumns(s.permission,s.table).length===s.table.columns.filter((f:any)=>f.lifecycle!=='deleted').length,403,'需具备数据表全部字段的读取权限才能设置业务定义');
 await c.query('SELECT id FROM data_tables WHERE id=$1 FOR UPDATE',[table]);s=await tableAccess(req.user.id,table);requireThat(canManage(s.permission),403,'只有项目管理员可设置业务定义');const current=(await c.query('SELECT * FROM project_business_objects WHERE table_id=$1 FOR UPDATE',[table])).rows[0];requireThat((current?.version||0)===b.version,409,'业务定义已变化，请重新载入后编辑');
 let definition;try{definition=validateOntologyDefinition(b.definition,visibleColumns(s.permission,s.table))}catch(e){throw new HttpError(400,(e as Error).message)}
 for(const r of definition.relations){const target=await tableAccess(req.user.id,r.target_table);requireThat(target.table.project_id===p&&target.table.lifecycle==='active',400,'关系目标须为当前项目的活动数据表');}
 const version=b.version+1,id=current?.id||uid();await c.query('INSERT INTO project_business_objects(id,project_id,table_id,definition,enabled,version,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(table_id) DO UPDATE SET definition=EXCLUDED.definition,enabled=EXCLUDED.enabled,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now()',[id,p,table,JSON.stringify(definition),b.enabled,version,req.user.id]);await audit(c,s.permission.workspace_id,req.user.id,'业务对象定义',table,{version,enabled:b.enabled,before:current?.definition||null,after:definition});return {version,enabled:b.enabled};
 }));res.json(result);
});
