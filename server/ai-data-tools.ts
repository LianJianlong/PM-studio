import type {Request} from 'express';
import {z} from 'zod';
import {pool} from './db.ts';
import {access,workspaceOwner,requireThat} from './auth.ts';
export async function readAIEndpoint(req:Request,path:string,method='GET',body?:unknown) {
  const response=await fetch(`http://127.0.0.1:${process.env.PORT||9090}/api${path}`,{
    method,headers:{cookie:`studio_session=${req.cookies.studio_session}`,'Content-Type':'application/json'},
    body:method==='GET'?undefined:JSON.stringify(body||{}),redirect:'error',signal:AbortSignal.timeout(20000),
  });
  requireThat(response.headers.get('content-type')?.includes('application/json'),400,'工具仅接收JSON业务数据');
  const text=await response.text();requireThat(Buffer.byteLength(text)<=2_000_000,400,'目录内容过大，请缩小范围');
  const result=JSON.parse(text);requireThat(response.ok,response.status,result.error||'权限或查询失败');return result;
}
export async function dataCatalog(req:Request,currentProject:string,args:unknown) {
  const b=z.object({scope:z.enum(['workspaces','project']).default('project'),project_id:z.uuid().optional(),table_id:z.uuid().optional(),search:z.string().trim().max(120).default(''),page:z.number().int().min(1).max(100000).default(1)}).strict().parse(args);
  if(b.scope==='workspaces') {
    const boot=await readAIEndpoint(req,'/bootstrap');
    return {workspaces:boot.workspaces.filter((w:any)=>w.lifecycle==='active').map((w:any)=>({id:w.id,name:w.name,role:w.role})),
      projects:boot.projects.filter((p:any)=>p.lifecycle==='active').map((p:any)=>({id:p.id,name:p.name,workspace_id:p.workspace_id}))};
  }
  let project=b.project_id||currentProject;
  if(b.table_id){const row=(await pool.query('SELECT project_id FROM data_tables WHERE id=$1 UNION ALL SELECT project_id FROM project_public_views WHERE id=$1 AND deleted_at IS NULL UNION ALL SELECT project_id FROM project_public_mappings WHERE id=$1 LIMIT 1',[b.table_id])).rows[0];requireThat(row,404,'数据表或视图不存在');project=row.project_id;}
  const a=await access(req.user.id,project);
  const [ordinary,context,publicTables]=await Promise.all([readAIEndpoint(req,`/projects/${project}/tables`),readAIEndpoint(req,`/projects/${project}/context`),readAIEndpoint(req,`/projects/${project}/public`)]);
  const tables=Array.from(new Map([...publicTables.tables,...ordinary].map((t:any)=>[t.id,t])).values()) as any[];tables.sort((a:any,b:any)=>Number(!!b.planning_kind)-Number(!!a.planning_kind));
  const visible=b.table_id?tables.filter((t:any)=>t.id===b.table_id):tables.filter((t:any)=>!b.search||t.name.toLowerCase().includes(b.search.toLowerCase()));
  if(b.table_id)requireThat(visible.length,403,'无权读取目标表');
  return {project:{id:project,name:a.name,workspace_id:a.workspace_id},role:a.role,planning_tables:tables.filter((t:any)=>t.planning_kind).map((t:any)=>({kind:t.planning_kind,table_id:t.id,name:t.name,records_path:`/tables/${t.id}/records`})),
    departments:context.departments.map((d:any)=>({id:d.id,name:d.name})),total:visible.length,page:b.page,
    tables:visible.slice((b.page-1)*20,b.page*20).map((t:any)=>b.table_id?t:{id:t.id,name:t.name,project_id:project,department_id:t.department_id,planning_kind:t.planning_kind||null,module_path:t.planning_kind?`计划管理 / ${t.planning_kind==='wbs'?'WBS':'组织架构'}`:'数据录入（普通表）',object_version:t.object_version,column_count:t.columns.length,read_only:!!t.is_mapping,source_table_id:t.source_table_id}),
    routes:{table_list:`/projects/${project}/tables`,records:'/tables/{table}/records'},
    field_help:'使用data_catalog {table_id:UUID}读取该表完整的可见字段。',next_page:b.page*20<visible.length?b.page+1:null};
}
export async function externalDatabaseTool(req:Request,workspace:string,name:string,args:unknown) {
  if(name==='database_connections') {
    const b=z.object({workspace_id:z.uuid().optional()}).strict().parse(args);const target=b.workspace_id||workspace;
    requireThat(await workspaceOwner(req.user.id,target));
    return {connections:await readAIEndpoint(req,`/workspaces/${target}/connections`),read_only:true};
  }
  const b=z.object({connection_id:z.uuid(),sql:z.string().trim().min(1).max(20000).optional()}).strict().parse(args);
  const connection=(await pool.query('SELECT workspace_id FROM connections WHERE id=$1',[b.connection_id])).rows[0];
  requireThat(connection&&await workspaceOwner(req.user.id,connection.workspace_id),403,'无权使用目标连接');
  const result=await readAIEndpoint(req,`/connections/${b.connection_id}/query`,'POST',b.sql?{sql:b.sql}:{});
  return {ok:true,status:200,read_only:true,data:result};
}
