import {ontologyCatalog} from './ai-ontology.ts';
import {ontologyRules} from '../shared/ai-ontology.ts';
import type {Request} from 'express';
import {canReadFullPlan} from './planning-read-access.ts';
import {planningDatasets} from '../shared/ai-planning-datasets.ts';
import {pool} from './db.ts';
import {dispatchAgent} from './ai-agent-runtime.ts';
import {tableAccess,access,requireThat} from './auth.ts';
import {businessActionHelp,type BusinessScope} from '../shared/ai-business-objects.ts';
/** Derive identity from bindings, never from a user-created table's name. */
export async function businessBindings(user:string,project:string){
 await access(user,project);
 const rows=(await pool.query("SELECT 'activity' kind,table_id FROM plan_data_tables WHERE project_id=$1 UNION ALL SELECT kind,table_id FROM planning_tables WHERE project_id=$1 AND kind='wbs'",[project])).rows;
 const visible=[];for(const row of rows){try{const t=await tableAccess(user,row.table_id);visible.push({type:row.kind,table_id:row.table_id,name:t.table.name,project_id:project})}catch{}}
 return visible;
}
export async function loadBusinessScope(req:Request,project:string,tables:any[],withResources:boolean,resourceIds:string[]=[]):Promise<BusinessScope>{
 const bindings=await businessBindings(req.user.id,project),activity=bindings.find(b=>b.type==='activity'),wbs=bindings.find(b=>b.type==='wbs');
 const rows=activity?tables.find(t=>t.id===activity.table_id)?.rows||[]:[];
 const native=rows.length?(await pool.query('SELECT l.activity_id id,l.record_id,a.version FROM plan_activity_records l JOIN activities a ON a.id=l.activity_id WHERE a.project_id=$1 AND l.record_id=ANY($2::uuid[])',[project,rows.map((r:any)=>r.id)])).rows:[];
 const byRecord=new Map(rows.map((r:any)=>[r.id,r]));
 let resources:any[]=[],resourceAccess:BusinessScope['resources_access']='not_requested';if(withResources){try{const r=await dispatchAgent(req,{method:'GET',path:`/projects/${project}/resources`});resources=r.data.filter((x:any)=>x.active!==false);resourceAccess='allowed'}catch(e){if(![403,404].includes((e as any).status))throw e;resourceAccess='denied'}}
 if(resourceIds.length){resources=resources.filter(r=>resourceIds.includes(r.id));requireThat(resources.length===new Set(resourceIds).size,403,'所选资源不属于当前项目可见范围或已停用');}
 return {activity_table:activity?.table_id,wbs_table:wbs?.table_id,activities:native.map(n=>({id:n.id,record_id:n.record_id,code:(byRecord.get(n.record_id) as any).data.code,name:(byRecord.get(n.record_id) as any).data.name,status:(byRecord.get(n.record_id) as any).status,version:n.version,record_version:(byRecord.get(n.record_id) as any).version})),resources:resources.slice(0,1000),resources_access:resourceAccess,resources_loaded:Math.min(resources.length,1000),resources_total:resources.length};
}
export async function businessObjectCatalog(req:Request,project:string){const permission=await access(req.user.id,project);return {semantics:ontologyRules,entities:(await ontologyCatalog(req.user.id,project)).entities,project_id:project,bindings:await businessBindings(req.user.id,project),datasets:await canReadFullPlan(permission)?planningDatasets.map(d=>({type:'dataset',id:d.id,name:d.name,read_only:!d.editable})):[],actions:businessActionHelp,confirmation:'writes_require_preview_and_final_confirmation',identity:'binding_and_project_scoped',instances:'Read bound records with original table permissions; resource reads require full plan read. Names must resolve uniquely; unknown objects are rejected.'}}

/** Global discovery is metadata-only. It never widens the instance/write scope of chat. */
export async function globalBusinessCatalog(req:Request,args:{workspace_id?:string;project_id?:string;search?:string;page?:number}={}){
 const {readAIEndpoint}=await import('./ai-data-tools.ts');
 const boot=await readAIEndpoint(req,'/bootstrap');
 const spaces=boot.workspaces.filter((w:any)=>w.lifecycle==='active');
 const projects=boot.projects.filter((p:any)=>p.lifecycle==='active'&&(!args.workspace_id||p.workspace_id===args.workspace_id)&&(!args.project_id||p.id===args.project_id));
 const page=args.page||1,selected=projects.slice((page-1)*8,page*8),tables:any[]=[],unavailable:any[]=[];
 for(let start=0;start<selected.length;start+=4){const chunk=selected.slice(start,start+4);const results=await Promise.allSettled(chunk.map(async(p:any)=>{
   const [ordinaryResult,publicResult,bindings]=await Promise.all([dispatchAgent(req,{method:'GET',path:`/projects/${p.id}/tables`}),dispatchAgent(req,{method:'GET',path:`/projects/${p.id}/public`}),businessBindings(req.user.id,p.id)]);
   const ordinary=ordinaryResult.data,publicTables=publicResult.data;
   const native=await canReadFullPlan(await access(req.user.id,p.id))?planningDatasets.map(d=>({id:'dataset:'+d.id,name:d.name,is_view:!d.editable,native:true,columns:[]})):[];
   return [...new Map([...ordinary,...publicTables.tables,...native].map((t:any)=>[t.id,t])).values()].filter((t:any)=>!args.search||t.name.toLowerCase().includes(args.search.toLowerCase())).map((t:any)=>({table_id:t.id,table_name:t.name,project_id:p.id,project_name:p.name,workspace_id:p.workspace_id,workspace_name:spaces.find((w:any)=>w.id===p.workspace_id)?.name||'',object_type:t.native?'dataset':bindings.find((b:any)=>b.table_id===t.id)?.type||'table',read_only:!!(t.is_mapping||t.is_view),column_count:t.columns?.length||0}));
 }));results.forEach((r,i)=>{if(r.status==='fulfilled')tables.push(...r.value);else unavailable.push({project_id:chunk[i].id,project_name:chunk[i].name,reason:'目录不可用或权限已变化'})})}
 return {scope:'authorized_global_metadata',tables,projects_total:projects.length,project_page:page,projects_on_page:selected.length,next_project_page:page*8<projects.length?page+1:null,unavailable,read_only:true,write_scope:'current_project_only',notice:'目录跨授权项目展示；记录及动作仍按目标项目重新鉴权。当前聊天增删改仅针对当前项目，操作其他项目请先切换项目。此分页按项目每页8个，不代表全局表数量。'};
}
