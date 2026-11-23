import {actionCatalog} from './business-actions.ts';
import type {Request} from 'express';
import {z} from 'zod';
import {ontologyTool} from '../shared/ai-ontology.ts';
import {businessContext} from './ai-ontology.ts';
import {businessObjectCatalog,globalBusinessCatalog} from './ai-business-objects.ts';
import {access,requireThat} from './auth.ts';
import {authorizationStamp} from './ai-permissions.ts';
import {resolveBusinessReadArguments} from './ai-read-arguments.ts';

/** Both entry points use these original business services and their live ACLs. */
export const businessReadTools=[ontologyTool,{name:'business_action_catalog',description:'Read-only action parameters, mandatory conditions and effect descriptions. This tool never executes actions; document writing remains read-only for business data.',parameters:{type:'object',properties:{table_id:{type:'string',description:'Optional authorized current-project table UUID to narrow rules.'}},additionalProperties:false}},{
 name:'business_object_catalog',
 description:'Read-only business-object discovery. Current project includes real table bindings and planning datasets. Global scope lists only authorized metadata; instance queries remain in the current project. Never writes records.',
 parameters:{type:'object',properties:{scope:{type:'string',enum:['project','global']},table_id:{type:'string',description:'Current-project table: return full authorized fields for this table only.'},search:{type:'string'},page:{type:'integer',minimum:1}},additionalProperties:false},
}];
export async function readBusinessTool(req:Request,project:string,name:string,args:unknown){
 const stamp=await authorizationStamp(req.user.id);await access(req.user.id,project);
 let result:any;
 if(name==='business_action_catalog'){const b=z.object({table_id:z.uuid().optional()}).strict().parse(args);const c=await actionCatalog(req.user.id,project);if(b.table_id)requireThat(c.tables.some(t=>t.id===b.table_id),403,'目标表不在当前授权项目');const rules=c.rules.filter(r=>!b.table_id||r.table_id===b.table_id);result={...c,rules:rules.slice(0,40),total:rules.length,truncated:rules.length>40,tables:undefined};}
 else if(name==='business_context')result=await businessContext(req,project,await resolveBusinessReadArguments(req,project,args));
 else if(name==='business_object_catalog'){
  const b=z.object({scope:z.enum(['project','global']).default('project'),table_id:z.uuid().optional(),search:z.string().max(120).optional(),page:z.number().int().min(1).max(100000).optional()}).strict().parse(args);
  requireThat(!b.table_id||b.scope==='project',400,'\u5168\u5c40\u76ee\u5f55\u4ec5\u4f9b\u53d1\u73b0\uff0c\u8bf7\u5207\u6362\u9879\u76ee\u540e\u8bfb\u53d6\u8868\u5b57\u6bb5');
  result=b.scope==='global'?await globalBusinessCatalog(req,b):await businessObjectCatalog(req,project);
  if(b.scope==='project'){const page=b.page||1,entities=result.entities.filter((e:any)=>(!b.table_id||e.id===b.table_id)&&(!b.search||e.name.toLowerCase().includes(b.search.toLowerCase())));if(b.table_id)requireThat(entities.length,403,'\u65e0\u6743\u8bfb\u53d6\u76ee\u6807\u8868\u6216\u8868\u4e0d\u5c5e\u4e8e\u5f53\u524d\u9879\u76ee');result={...result,entities:entities.slice((page-1)*40,page*40).map((e:any)=>b.table_id?e:{id:e.id,name:e.name,type:e.type,business_object:e.business_object?{version:e.business_object.version,name:e.business_object.definition.name,aliases:e.business_object.definition.aliases,partial:e.business_object.definition.partial}:undefined,field_count:e.fields.length,relations:e.relations}),field_help:'Use business_object_catalog with table_id for exact field IDs; use business_context to read records or aggregate.',total:entities.length,page,next_page:page*40<entities.length?page+1:null};}
  // This catalog advertises the read surface; mutations cannot be smuggled into it.
  result={...result,actions:[],read_only:true,business_writes:false};
 }else requireThat(false,403,'\u8be5\u5de5\u5177\u4e0d\u5c5e\u4e8e\u5171\u4eab\u53ea\u8bfb\u4e1a\u52a1\u80fd\u529b');
 requireThat(stamp===await authorizationStamp(req.user.id),403,'\u67e5\u8be2\u671f\u95f4\u6743\u9650\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u91cd\u8bd5');return result;
}
/** Give the model exact authorized identities before asking it to discover more. */
export async function initialBusinessReadContext(req:Request,project:string,prompt:string,tableId?:string){
 const stamp=await authorizationStamp(req.user.id);
 const catalog=await businessObjectCatalog(req,project),matches=tableId?catalog.entities.filter((e:any)=>e.id===tableId):catalog.entities.filter((e:any)=>[e.name,e.business_object?.definition.name,...(e.business_object?.definition.aliases||[])].filter(Boolean).some((name:string)=>prompt.includes(name)&&catalog.entities.filter((other:any)=>[other.name,other.business_object?.definition.name,...(other.business_object?.definition.aliases||[])].includes(name)).length===1)).slice(0,3);
 if(tableId)requireThat(matches.length,403,'\u65e0\u6743\u8bfb\u53d6\u9009\u4e2d\u8868\u6216\u8868\u4e0d\u5c5e\u4e8e\u5f53\u524d\u9879\u76ee');
 const result={project_id:project,total:catalog.entities.length,tables:matches.map((e:any)=>({table_id:e.id,name:e.name,type:e.type,business_object:e.business_object?{...e.business_object,definition:{...e.business_object.definition,properties:e.business_object.definition.properties.slice(0,12),relations:e.business_object.definition.relations.slice(0,8)},metadata_truncated:e.business_object.definition.properties.length>12||e.business_object.definition.relations.length>8}:undefined,fields:e.fields.map((f:any)=>({id:f.id,name:f.name,type:f.type,unit:f.unit,target_table:f.target_table})),relations:e.relations})),catalog:catalog.entities.filter((e:any)=>!matches.some((m:any)=>m.id===e.id)).slice(0,8).map((e:any)=>({table_id:e.id,name:e.name,type:e.type,business_object:e.business_object?{name:e.business_object.definition.name,aliases:e.business_object.definition.aliases,version:e.business_object.version}:undefined})),notice:'Authorized metadata only, not records. Use exact table_id/field IDs from this context; never translate a real table name when searching it. Additional tables can be discovered with business_object_catalog.'};
 requireThat(stamp===await authorizationStamp(req.user.id),403,'\u67e5\u8be2\u671f\u95f4\u6743\u9650\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u91cd\u8bd5');return result;
}
