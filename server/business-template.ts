import {installProcurementFields} from './procurement-fields.ts';
import {installReportTemplates} from './report-template-suite.ts';
import {loeReferenceField} from '../shared/loe.ts';
import {configureOrganizationRoster} from './organization-roster.ts';
import {relaxRequiredColumns} from '../shared/required-field-policy.ts';
import {configureStandardDashboard} from './dashboard-defaults.ts';
import {constructionSpecs,constructionWorkflows,constructionSystems,constructionSharedKeys,constructionProfiles,type ConstructionProfile} from '../shared/construction-catalog.ts';
import type pg from 'pg';
import {uid,audit} from './db.ts';
import {fields,membership} from './validation.ts';
import {assertNoFormulaCycles} from '../shared/formulas.ts';
import {tableSpecs as baseTableSpecs,workflowSpecs as baseWorkflowSpecs,sharedKeys as baseSharedKeys,baseFields,reportSpecs,publicViewSpecs} from '../shared/business-catalog.ts';
import {planCore,syncActivityRecord} from './plan-table.ts';
import {viewDefinition} from './public-views.ts';
import {access,tableAllowed,visibleColumns} from './auth.ts';
const VERSION=2,deptCodes:Record<string,string>={'人资':'hr','经理':'management','设计管理':'design','技术':'technical','工程':'engineering','安全':'safety','质量':'quality','机械与船机':'equipment','商务':'commercial','物资':'procurement','财税':'finance'};
const leaderScopes:Record<string,string[]|null>={project_manager:null,deputy_manager:null,safety_director:['安全'],chief_engineer:['设计管理','技术','质量'],commercial_manager:['商务'],finance_director:['财税']};
const stable=(v:any):string=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
export async function applyBusinessTemplate(c:pg.PoolClient,project:any,actor:string){
  const profile:ConstructionProfile=project.template_profile||'generic';
  const tableSpecs=constructionSpecs(baseTableSpecs,profile),sharedKeys=[...baseSharedKeys,...constructionSharedKeys],workflowSpecs=constructionWorkflows(baseWorkflowSpecs);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['business-templates:'+project.id]);
  await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project.id]);
  await c.query("SELECT set_config('app.actor_id',$1,true)",[actor]);
  const depts=(await c.query("SELECT * FROM departments WHERE project_id=$1",[project.id])).rows,department=new Map(depts.map(d=>[d.name,d.id]));
  const users=new Map((await c.query('SELECT id,username,name,active FROM users WHERE active')).rows.map(u=>[u.username,u]));
  for(const f of workflowSpecs)for(const username of f.approvers)if(!users.has(username))throw Error('Missing approver '+username);
  const registry=new Map<string,string>((await c.query('SELECT kind,template_key,object_id FROM project_business_templates WHERE project_id=$1',[project.id])).rows.map(r=>[r.kind+':'+r.template_key,r.object_id]));
  const counts={tables_created:0,fields_added:0,views_created:0,reports_created:0,workflows_created:0,grants_updated:0,dictionary_records_created:0,reports_updated:0};
  async function register(kind:string,key:string,id:string){await c.query('INSERT INTO project_business_templates(project_id,kind,template_key,object_id,applied_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,kind,template_key) DO NOTHING',[project.id,kind,key,id,VERSION]);registry.set(kind+':'+key,id);}
  const ids:Record<string,string>={};
  async function hierarchy(kind:string){let id=(await c.query('SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind=$2',[project.id,kind])).rows[0]?.table_id;
   if(!id){id=uid();const columns=[{id:'code',name:'编码',type:'text',required:true,...(kind==='wbs'?{auto_code:true}:{})},{id:'name',name:kind==='wbs'?'WBS名称':'组织名称',type:'text',required:true},{id:'parent',name:'上级节点',type:'reference',target_table:id,display_column:'name'},{id:'description',name:kind==='wbs'?'工作范围':'职责说明',type:'text'},{id:'owner',name:'负责人',type:'text'}];await c.query('INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES($1,$2,$3,$4,$5)',[id,project.id,department.get('经理'),kind==='wbs'?'项目WBS':'项目组织架构',JSON.stringify(columns)]);await c.query('INSERT INTO planning_tables(project_id,kind,table_id) VALUES($1,$2,$3)',[project.id,kind,id]);counts.tables_created++;}
   ids[kind]=id;await register('table',kind,id);
  }
  await hierarchy('wbs');await hierarchy('organization');
  let plan=(await c.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1',[project.id])).rows[0]?.table_id;
  if(!plan){plan=uid();await c.query('INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES($1,$2,$3,$4,$5)',[plan,project.id,department.get('经理'),'计划作业数据',JSON.stringify([...planCore,loeReferenceField(plan),{id:'wbs',name:'所属WBS',type:'reference',target_table:ids.wbs,display_column:'name'}])]);await c.query('INSERT INTO plan_data_tables(project_id,table_id) VALUES($1,$2)',[project.id,plan]);for(const a of (await c.query('SELECT id FROM activities WHERE project_id=$1',[project.id])).rows)await syncActivityRecord(c,actor,project.id,a.id);counts.tables_created++;}ids.activities=plan;await register('table','activities',plan);
  const isExisting=new Set<string>();
  for(const spec of tableSpecs){
   let id=registry.get('table:'+spec.key);
   if(id){const old=(await c.query('SELECT id FROM data_tables WHERE id=$1 AND project_id=$2 AND lifecycle=\'active\'',[id,project.id])).rows[0];if(!old)throw Error('A registered business table was removed: '+spec.name);isExisting.add(spec.key);}
   else {const old=(await c.query("SELECT id FROM data_tables WHERE project_id=$1 AND department_id=$2 AND name=$3 AND lifecycle='active' ORDER BY created_at LIMIT 1",[project.id,department.get(spec.dept),spec.name])).rows[0];id=old?.id||uid();if(old)isExisting.add(spec.key);else{await c.query('INSERT INTO data_tables(id,project_id,department_id,name,description,columns) VALUES($1,$2,$3,$4,$5,$6)',[id,project.id,department.get(spec.dept),spec.name,spec.description||'常用业务台账；关联字段限定同一项目，普通记录由部门主管确认有效后共享和计算；重大事项按流程审批。',JSON.stringify(baseFields().map(f=>spec.key.endsWith('_catalog')&&f.id==='date'?{...f,required:false}:f))]);counts.tables_created++;}}
   if(!id)throw Error("Cannot allocate table "+spec.key);ids[spec.key]=id;
  }
  const classification=tableSpecs.find(t=>t.key==='daily')!.fields.filter(f=>['discipline','subsystem','system_ref'].includes(f.id));
  for(const key of ['wbs','activities']){const t=(await c.query('SELECT * FROM data_tables WHERE id=$1 FOR UPDATE',[ids[key]])).rows[0],columns=[...t.columns];for(const {target_key,...f} of classification)if(!columns.some((old:any)=>old.id===f.id)){columns.push({...f,required:false,...(target_key?{target_table:ids[target_key]}:{})});counts.fields_added++;}fields.parse(columns);if(stable(columns)!==stable(t.columns))await c.query('UPDATE data_tables SET columns=$1,object_version=object_version+1 WHERE id=$2',[JSON.stringify(columns),t.id]);}
  const tableDetails:any[]=[];
  for(const spec of tableSpecs){const table=(await c.query('SELECT * FROM data_tables WHERE id=$1 FOR UPDATE',[ids[spec.key]])).rows[0];let columns=table.columns.slice();
   const wanted=[...baseFields().map(f=>spec.key.endsWith('_catalog')&&f.id==='date'?{...f,required:false}:f),...spec.fields].map(({target_key,...f}:any)=>({...f,...(target_key?{target_table:ids[target_key]}:{})}));
   for(const f of wanted)if(!columns.some((old:any)=>old.id===f.id)){columns.push({...f,...(isExisting.has(spec.key)?{required:false}:{})});counts.fields_added++;}
   columns=relaxRequiredColumns(columns,spec.key);
   if(spec.key==='daily')for(const f of columns)if(['planned','actual'].includes(f.id)&&f.unit==='m³')delete f.unit;
   fields.parse(columns);assertNoFormulaCycles(Object.fromEntries(columns.filter((f:any)=>f.type==='formula').map((f:any)=>[f.id,f.formula])),{fields:columns.map((f:any)=>f.id)});
   for(const f of columns.filter((f:any)=>f.type==='reference'))if(!(await c.query('SELECT 1 FROM data_tables WHERE id=$1 AND project_id=$2',[f.target_table,project.id])).rowCount)throw Error('Cross-project reference in '+spec.name);
   if(stable(columns)!==stable(table.columns))await c.query('UPDATE data_tables SET columns=$1,object_version=object_version+1 WHERE id=$2',[JSON.stringify(columns),table.id]);
   await register('table',spec.key,table.id);tableDetails.push({key:spec.key,id:table.id,name:table.name,department:spec.dept,fields:columns.map((f:any)=>({id:f.id,name:f.name,type:f.type,target:f.target_table}))});
  }
  for(const system of constructionSystems(profile)){
   let systemId=registry.get('dictionary:system:'+system.key);
   if(!systemId){systemId=uid();await c.query("INSERT INTO records(id,table_id,data,status,created_by) VALUES($1,$2,$3,'approved',$4)",[systemId,ids.system_catalog,JSON.stringify({code:system.key,name:system.name,discipline:system.discipline,work_scope:system.work,quality_checks:system.checks,applicability:constructionProfiles[profile]}),actor]);await register('dictionary','system:'+system.key,systemId);counts.dictionary_records_created++;}
   for(const [index,[name,unit]]of system.materials.entries()){const key='material:'+system.key+':'+index;if(registry.has('dictionary:'+key))continue;const id=uid();await c.query("INSERT INTO records(id,table_id,data,status,created_by) VALUES($1,$2,$3,'approved',$4)",[id,ids.material_catalog,JSON.stringify({code:system.key+'-M'+(index+1),name,system_ref:[systemId],discipline:system.discipline,subsystem:system.name,unit,specification_prompt:'按批准图纸填写规格、材质、性能、接口、品牌报审及样品要求',inspection_prompt:system.checks+'；核对合格证明、批次、外观、复验要求与存储条件'}),actor]);await register('dictionary',key,id);counts.dictionary_records_created++;}
  }
  const projection=(source:string,names:string[],status='approved')=>({sources:[ids[source]],joins:[],filters:[],columns:names.map(id=>({id,name:id,field:{source:0,field:id},aggregation:'none'})),status});
  const publicSpecs=publicViewSpecs;
  for(const spec of publicSpecs){let view=registry.get('view:'+spec.key);if(!view){const columns=(await c.query('SELECT columns FROM data_tables WHERE id=$1',[ids[spec.source]])).rows[0].columns;const definition=projection(spec.source,spec.columns);definition.columns=definition.columns.map(f=>({...f,name:columns.find((c:any)=>c.id===f.id)?.name||f.name}));viewDefinition.parse(definition);view=uid();let name=spec.name;if((await c.query('SELECT 1 FROM project_public_views WHERE project_id=$1 AND name=$2 AND deleted_at IS NULL',[project.id,name])).rowCount)name+='（标准）';await c.query('INSERT INTO project_public_views(id,project_id,name,definition,created_by) VALUES($1,$2,$3,$4,$5)',[view,project.id,name,JSON.stringify(definition),actor]);await register('view',spec.key,view);counts.views_created++;}ids[spec.key]=view;}
  let inventory=registry.get('view:stock_balance');if(!inventory){const source=(await c.query('SELECT columns FROM data_tables WHERE id=$1',[ids.movements])).rows[0].columns;const columns=['stock_key','material_code','material_name','unit','warehouse','batch'].map(id=>({id,name:source.find((f:any)=>f.id===id)?.name||id,field:{source:0,field:id},aggregation:'none'}));const definition={sources:[ids.movements],joins:[],filters:[],columns:[...columns,{id:'quantity',name:'当前库存数量',field:{source:0,field:'signed_quantity'},aggregation:'sum'}],status:'approved'};viewDefinition.parse(definition);inventory=uid();await c.query('INSERT INTO project_public_views(id,project_id,name,definition,created_by) VALUES($1,$2,$3,$4,$5)',[inventory,project.id,'库存余额（实时）',JSON.stringify(definition),actor]);await register('view','stock_balance',inventory);counts.views_created++;}ids.stock_balance=inventory;
  for(const report of reportSpecs(ids,project.name,project.currency||'CNY',profile)){
   const existingId=registry.get('report:'+report.key);if(existingId){const meta=(await c.query("SELECT applied_version FROM project_business_templates WHERE project_id=$1 AND kind='report' AND template_key=$2",[project.id,report.key])).rows[0];if(meta.applied_version>=VERSION)continue;const old=(await c.query('SELECT * FROM report_documents WHERE id=$1',[existingId])).rows[0];if(old&&!old.deleted_at&&old.version===1){await c.query('UPDATE report_documents SET layout=$1,version=version+1,updated_at=now() WHERE id=$2',[JSON.stringify(report.layout),existingId]);await c.query("UPDATE project_business_templates SET applied_version=$1 WHERE project_id=$2 AND kind='report' AND template_key=$3",[VERSION,project.id,report.key]);counts.reports_updated++;continue;}}
   const id=uid();await c.query('INSERT INTO report_documents(id,project_id,name,layout,created_by) VALUES($1,$2,$3,$4,$5)',[id,project.id,'标准模板｜'+report.name+(existingId?'（工程建设版）':''),JSON.stringify(report.layout),actor]);if(existingId)await c.query("UPDATE project_business_templates SET object_id=$1,applied_version=$2 WHERE project_id=$3 AND kind='report' AND template_key=$4",[id,VERSION,project.id,report.key]);else await register('report',report.key,id);counts.reports_created++;
  }
  const assignments:any[]=[];
  for(const [username,u] of users){let scope=leaderScopes[username],base:string,roleName:string;
   if(username in leaderScopes){base=scope===null?'manager':'reviewer';roleName=u.name;}
   else{const match=username.match(/^dept_(\w+)_(manager|entry)$/);if(!match)continue;const dept=Object.keys(deptCodes).find(d=>deptCodes[d]===match[1]);if(!dept)continue;scope=[dept];base=match[2]==='entry'?'editor':'reviewer';roleName=u.name;}
   await c.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING",[project.workspace_id,u.id]);
   await c.query("INSERT INTO memberships(id,project_id,user_id,role) VALUES($1,$2,$3,'editor') ON CONFLICT(project_id,user_id) DO NOTHING",[uid(),project.id,u.id]);
   const existing=(await c.query('SELECT * FROM memberships WHERE project_id=$1 AND user_id=$2',[project.id,u.id])).rows[0];
   const none={read:false,create:false,update:false,delete:false},read={...none,read:true},write={...read,create:true,update:true};const own=base==='editor'?write:read;
   const crud:Record<string,any>=scope?{$data:(scope.includes('财税')?read:none),$files:read}:{};
   if(scope){for(const d of depts)crud['department:'+d.id]=scope.includes(d.name)?own:none;
    for(const key of sharedKeys)crud[ids[key]]=read;
    for(const spec of tableSpecs)if(scope.includes(spec.dept)){crud[ids[spec.key]]=own;for(const f of spec.fields)if(f.target_key&&!crud[ids[f.target_key]]?.create)crud[ids[f.target_key]]=read;}
    for(const spec of tableSpecs)if(scope.includes(spec.dept))crud[ids[spec.key]]=own;
    if(scope.includes('工程'))crud[ids.activities]=own;
    for(const flow of workflowSpecs)if(flow.approvers.includes(username))for(const key of flow.tables)crud[ids[key]]=crud[ids[key]]?.create?crud[ids[key]]:read;
   }
   const grant=membership.parse({role:base,department_id:null,table_ids:[],hidden_columns:[],row_scope:'all',can_export:base!=='editor',expires_at:existing.expires_at instanceof Date?existing.expires_at.toISOString():existing.expires_at,crud_permissions:crud});
   let roleId=existing.project_role_id;if(!roleId)roleId=(await c.query('SELECT id FROM project_roles WHERE project_id=$1 AND name=$2',[project.id,roleName])).rows[0]?.id;
   if(!roleId){roleId=uid();await c.query('INSERT INTO project_roles(id,project_id,name,description,grant_config) VALUES($1,$2,$3,$4,$5)',[roleId,project.id,roleName,'标准部门业务权限；共享资料只读，本部门录入，跨部门审批仅读取对应申请。',JSON.stringify(grant)]);}
   else{const old=(await c.query('SELECT grant_config FROM project_roles WHERE id=$1',[roleId])).rows[0];if(stable(old.grant_config)!==stable(grant))await c.query('UPDATE project_roles SET grant_config=$1,revision=gen_random_uuid() WHERE id=$2',[JSON.stringify(grant),roleId]);}
   const before={project_role_id:null,role:existing.role,department_id:existing.department_id,table_ids:existing.table_ids,hidden_columns:existing.hidden_columns,row_scope:existing.row_scope,can_export:existing.can_export,expires_at:existing.expires_at instanceof Date?existing.expires_at.toISOString():existing.expires_at,crud_permissions:existing.crud_permissions};
   if(stable(before)!==stable(grant)||existing.project_role_id!==roleId){await c.query('UPDATE memberships SET role=$1,department_id=NULL,table_ids=$2,hidden_columns=$2,row_scope=\'all\',can_export=$3,crud_permissions=$4,project_role_id=$5 WHERE id=$6',[base,'[]',grant.can_export,JSON.stringify(crud),roleId,existing.id]);counts.grants_updated++;}
   assignments.push({username,name:u.name,role:base,scope:scope?.join('、')||'项目全域',export:grant.can_export});
  }
  for(const flow of workflowSpecs){const tableIds=flow.tables.map(key=>ids[key]);if(tableIds.some(id=>!id))throw Error('Missing workflow table '+flow.key);const steps=flow.approvers.map((username,index)=>({name:users.get(username)!.name+(index===flow.approvers.length-1?'终审':'复核'),approver_id:users.get(username)!.id,mode:'one'}));
   for(const step of steps){const permission=await access(step.approver_id,project.id,c);for(const tableId of tableIds){const t=(await c.query('SELECT * FROM data_tables WHERE id=$1',[tableId])).rows[0];if(!tableAllowed(permission,t)||visibleColumns(permission,t).length!==t.columns.length)throw Error('Approver cannot inspect full table: '+step.name+' '+t.name);}}
   if(registry.has('workflow:'+flow.key)){await c.query("UPDATE workflow_definitions SET table_ids=$1 WHERE id=$2 AND active",[JSON.stringify(tableIds),registry.get('workflow:'+flow.key)]);continue;}
   await c.query('UPDATE workflow_definitions SET active=false WHERE project_id=$1 AND kind=\'record\' AND active AND table_ids ?| $2::text[]',[project.id,tableIds]);
   const id=uid();await c.query('INSERT INTO workflow_definitions(id,project_id,kind,name,steps,table_ids,created_by) VALUES($1,$2,\'record\',$3,$4,$5,$6)',[id,project.id,flow.name,JSON.stringify(steps),JSON.stringify(tableIds),actor]);await register('workflow',flow.key,id);counts.workflows_created++;
  }
  counts.fields_added+=await installProcurementFields(c,project.id);
  await configureOrganizationRoster(c,actor,project.id);
  await configureStandardDashboard(c,project.id,ids);
  await installReportTemplates(c,project,actor);
  await audit(c,project.workspace_id,actor,'配置部门业务模板与报表审批',project.id,{version:VERSION,...counts});return {project:project.name,project_id:project.id,profile,ids,counts,tables:tableDetails,assignments};
}
