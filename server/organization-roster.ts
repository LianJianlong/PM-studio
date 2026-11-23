import type pg from 'pg';
import {pool,uid,audit} from './db.ts';
import {tableAccess,canManage,requireThat,visibleColumns,rowAllowed,canRecordAction} from './auth.ts';
import {projectReferenceRows} from './references.ts';
import {editableRecord} from '../shared/record-policy.ts';
import {HttpError} from './auth.ts';

const definitions=[
 {key:'employee_no',name:'人员编码',aliases:['employee_no','人员编号','人员编码','员工编号','工号']},
 {key:'name',name:'姓名',aliases:['姓名','人员姓名','员工姓名','name','title']},
 {key:'position',name:'职位',aliases:['职位','岗位','职务','position']},
 {key:'phone',name:'电话',aliases:['电话','联系电话','手机','手机号','phone','mobile']},
 {key:'email',name:'邮箱',aliases:['邮箱','电子邮箱','电子邮件','email']},
 {key:'photo',name:'照片',aliases:['照片','头像','photo','avatar']},
 {key:'department',name:'所属部门',aliases:['所属部门','部门','department']},
];
export function rosterFields(columns:any[]){
 return Object.fromEntries(definitions.map(def=>{
  let f:any;
  for(const alias of def.aliases){f=columns.find(c=>c.lifecycle!=='deleted'&&c.type==='text'&&(c.id===alias||c.name===alias));if(f)break;}
  return [def.key,f?.id||null];
 }));
}
export async function configureOrganizationRoster(c:pg.PoolClient,actor:string,project:string,target?:string){
 const org=(await c.query("SELECT t.* FROM planning_tables b JOIN data_tables t ON t.id=b.table_id WHERE b.project_id=$1 AND b.kind='organization' AND t.lifecycle='active' FOR NO KEY UPDATE OF t",[project])).rows[0];
 if(!org)return null;
 const orgAccess=await tableAccess(actor,org.id,c);
 requireThat(canManage(orgAccess.permission)&&orgAccess.permission.lifecycle==='active'&&orgAccess.permission.workspace_lifecycle==='active');
 const existing=org.columns.find((f:any)=>f.id==='person_ref'&&f.type==='reference'&&f.lifecycle!=='deleted');
 let created=false;
 let roster=target?(await c.query("SELECT * FROM data_tables WHERE id=$1 AND project_id=$2 AND lifecycle='active' FOR NO KEY UPDATE",[target,project])).rows[0]:null;
 if(target)requireThat(roster,400,'请选择当前项目中的活动人员花名册');
 if(!roster&&existing)roster=(await c.query("SELECT * FROM data_tables WHERE id=$1 AND project_id=$2 AND lifecycle='active' FOR NO KEY UPDATE",[existing.target_table,project])).rows[0];
 if(!roster)roster=(await c.query("SELECT * FROM data_tables WHERE project_id=$1 AND lifecycle='active' AND name IN ('花名册','人员花名册','人员主数据') ORDER BY CASE name WHEN '人员花名册' THEN 0 WHEN '花名册' THEN 1 ELSE 2 END,created_at LIMIT 1 FOR NO KEY UPDATE",[project])).rows[0];
 if(!roster){
  const dept=(await c.query("SELECT id FROM departments WHERE project_id=$1 ORDER BY (name='人资') DESC,name LIMIT 1",[project])).rows[0];
  requireThat(dept,409,'项目需要先建立部门');
  const key=uid();created=true;
  roster=(await c.query("INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES($1,$2,$3,'人员花名册','[]') RETURNING *",[key,project,dept.id])).rows[0];
 }
 requireThat(roster.id!==org.id,400,'花名册不能是组织架构表本身');
 const permission=(await tableAccess(actor,roster.id,c)).permission;requireThat(canManage(permission));
 const columns=[...roster.columns],mapped=rosterFields(columns);
 for(const def of definitions)if(!mapped[def.key]){
  requireThat(!columns.some(f=>f.id===def.key),409,'花名册存在同名的非文本字段，请先调整字段类型');
  columns.push({id:def.key,name:def.name,type:'text',required:created&&def.key==='name',...def.key==='employee_no'?{auto_code:true,code_prefix:'EMP-',code_start:'1',code_step:'1',code_width:4}:{}});
 }
 const photo=rosterFields(columns).photo;
 if(photo){const index=columns.findIndex(f=>f.id===photo);columns[index]={...columns[index],image_upload:true};}
 const mapping=rosterFields(columns);
 if(JSON.stringify(columns)!==JSON.stringify(roster.columns))await c.query('UPDATE data_tables SET columns=$2,object_version=object_version+1 WHERE id=$1',[roster.id,JSON.stringify(columns)]);
 if(existing&&existing.target_table!==roster.id)requireThat(!(await c.query("SELECT 1 FROM records WHERE table_id=$1 AND lifecycle<>'deleted' AND jsonb_array_length(CASE WHEN jsonb_typeof(data->'person_ref')='array' THEN data->'person_ref' ELSE '[]'::jsonb END)>0 LIMIT 1",[org.id])).rowCount,409,'已有岗位关联人员，请先解除关联后再更换花名册');
 const ref={id:'person_ref',name:'关联花名册人员',type:'reference',target_table:roster.id,display_column:mapping.name};
 const orgColumns=existing?org.columns.map((f:any)=>f.id==='person_ref'?{...f,...ref}:f):[...org.columns,ref];
 requireThat(existing||!org.columns.some((f:any)=>f.id==='person_ref'),409,'组织表已有同名字段，请先重命名');
 if(JSON.stringify(orgColumns)!==JSON.stringify(org.columns))await c.query('UPDATE data_tables SET columns=$2,object_version=object_version+1 WHERE id=$1',[org.id,JSON.stringify(orgColumns)]);
 await c.query("UPDATE projects SET planning_settings=jsonb_set(coalesce(planning_settings,'{}'),'{organization_roster}',$2::jsonb) WHERE id=$1",[project,JSON.stringify({table_id:roster.id})]);
 await audit(c,orgAccess.permission.workspace_id,actor,'关联组织架构与人员花名册',org.id,{roster_table:roster.id});
 return {table_id:roster.id};
}
export async function organizationPeople(user:string,table:any,permission:any,rows:any[]){
 const field=visibleColumns(permission,table).find((f:any)=>f.id==='person_ref'&&f.type==='reference');
 if(!field)return {rows,roster:null};
 try{
  const {table:roster,permission:p}=await tableAccess(user,field.target_table);
  requireThat(roster.project_id===table.project_id&&roster.lifecycle==='active',403);
  const columns=visibleColumns(p,roster),mapping=rosterFields(columns);
  const ids=[...new Set(rows.flatMap(r=>r.references?.person_ref?.items.map((x:any)=>x.id)||[]))];
  const originals=(await pool.query("SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[]) AND lifecycle='active' AND status<>'obsolete'",[roster.id,ids])).rows.filter(r=>rowAllowed(p,r,user));
  const projected=await projectReferenceRows(user,roster,p,originals);
  const byId=new Map(projected.map(r=>[r.id,r]));
  return {roster:{id:roster.id,name:roster.name,fields:mapping},rows:rows.map(r=>{
   const id=r.references?.person_ref?.items?.[0]?.id,person=byId.get(id);
   if(!person)return {...r,person:null};
   const values=Object.fromEntries(Object.entries(mapping).filter(([,id])=>id).map(([key,id])=>[key,person.data[id as string]??null]));
   return {...r,person:{id,version:person.version,status:person.status,values,fields:mapping,
    can_edit:roster.lifecycle==='active'&&p.lifecycle==='active'&&p.workspace_lifecycle==='active'&&canRecordAction(p,roster,'update')&&editableRecord(roster,person.status)}};
  })};
 }catch(e){
  if(!(e instanceof HttpError)||![403,404,409].includes(e.status))throw e;
  return {rows:rows.map(r=>({...r,person:null})),roster:null};
 }
}

export async function organizationRosterDescriptor(user:string,org:any,permission:any){
 const can_configure=canManage(permission)&&permission.lifecycle==='active'&&permission.workspace_lifecycle==='active';
 const field=visibleColumns(permission,org).find((f:any)=>f.id==='person_ref'&&f.type==='reference');
 let table:any=null;
 if(field)try{
  const access=await tableAccess(user,field.target_table);
  if(access.table.project_id===org.project_id&&access.table.lifecycle==='active')table={...access.table,columns:visibleColumns(access.permission,access.table)};
 }catch(e){if(!(e instanceof HttpError)||![403,404,409].includes(e.status))throw e;}
 const candidates=can_configure?(await pool.query("SELECT id,name FROM data_tables WHERE project_id=$1 AND lifecycle='active' AND (name IN ('花名册','人员花名册','人员主数据') OR id=$2) ORDER BY name,id",[org.project_id,field?.target_table||null])).rows:[];
 return {table,candidates,can_configure};
}
