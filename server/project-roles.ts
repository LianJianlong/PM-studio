import { Router } from 'express';
import { z } from 'zod';
import { pool, tx, uid, audit } from './db.ts';
import { access, workspaceOwner, requireThat } from './auth.ts';
import { id, membership } from './validation.ts';
export const projectRoles = Router();
const definition = z.object({name:z.string().trim().min(1).max(120), description:z.string().trim().max(1000).default(''), grant:membership.omit({project_role_id:true,expires_at:true})});
async function authorize(user:string,project:string,c:any=pool){
 const a=await access(user,project,c);
 requireThat(await workspaceOwner(user,a.workspace_id,c));
 return a;
}
async function lock(c:any,project:string){await c.query('SELECT pg_advisory_xact_lock(hashtext($1),704)',[project]);}
projectRoles.get('/projects/:project/roles',async(req,res)=>{
 const project=id.parse(req.params.project);await authorize(req.user.id,project);
 res.json((await pool.query(`SELECT r.*,count(m.id)::int AS assigned_count FROM project_roles r LEFT JOIN memberships m ON m.project_role_id=r.id WHERE r.project_id=$1 GROUP BY r.id ORDER BY r.name`,[project])).rows);
});
projectRoles.post('/projects/:project/roles',async(req,res)=>{
 const project=id.parse(req.params.project),body=definition.parse(req.body);
 const result=await tx(async c=>{
  await lock(c,project);const a=await authorize(req.user.id,project,c);
  requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目或工作空间非活动状态');
  // Scope validation uses the same validator as individual grants.
  const {validateGrant}=await import('./governance.ts');await validateGrant(project,{...body.grant,expires_at:null,project_role_id:null},c);
  const r=(await c.query('INSERT INTO project_roles(id,project_id,name,description,grant_config) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),project,body.name,body.description,JSON.stringify(body.grant)])).rows[0];
  await audit(c,a.workspace_id,req.user.id,'创建项目角色',r.id,{project_id:project});return r;
 });res.status(201).json(result);
});
projectRoles.put('/projects/:project/roles/:role',async(req,res)=>{
 const project=id.parse(req.params.project),role=id.parse(req.params.role),body=definition.extend({expected_revision:id}).parse(req.body);
 await tx(async c=>{
  await lock(c,project);const a=await authorize(req.user.id,project,c);
  requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目或工作空间非活动状态');
  const current=(await c.query('SELECT * FROM project_roles WHERE id=$1 AND project_id=$2 FOR UPDATE',[role,project])).rows[0];
  requireThat(current,404,'项目角色不存在');requireThat(current.revision===body.expected_revision,409,'角色已被修改，请刷新后重试');
  const {validateGrant}=await import('./governance.ts');await validateGrant(project,{...body.grant,expires_at:null,project_role_id:null},c);
  requireThat(!(await c.query('SELECT 1 FROM memberships WHERE project_role_id=$1 AND user_id=$2',[role,req.user.id])).rowCount,400,'不能通过角色修改自己的权限');
  await c.query('UPDATE project_roles SET name=$1,description=$2,grant_config=$3,revision=gen_random_uuid() WHERE id=$4',[body.name,body.description,JSON.stringify(body.grant),role]);
  const g=body.grant;
  await c.query('UPDATE memberships SET role=$1,department_id=$2,table_ids=$3,hidden_columns=$4,row_scope=$5,can_export=$6,crud_permissions=$7 WHERE project_role_id=$8',[g.role,g.department_id,JSON.stringify(g.table_ids),JSON.stringify(g.hidden_columns),g.row_scope,g.can_export,JSON.stringify(g.crud_permissions),role]);
  await audit(c,a.workspace_id,req.user.id,'修改项目角色',role,{project_id:project,before:current,after:body});
 });res.json({ok:true});
});
projectRoles.delete('/projects/:project/roles/:role',async(req,res)=>{
 const project=id.parse(req.params.project),role=id.parse(req.params.role),body=z.object({expected_revision:id}).parse(req.body);
 await tx(async c=>{
  await lock(c,project);const a=await authorize(req.user.id,project,c);
  requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目或工作空间非活动状态');
  const r=(await c.query('SELECT revision FROM project_roles WHERE id=$1 AND project_id=$2 FOR UPDATE',[role,project])).rows[0];
  requireThat(r,404,'项目角色不存在');requireThat(r.revision===body.expected_revision,409,'角色已被修改，请刷新后重试');
  requireThat(!(await c.query('SELECT 1 FROM memberships WHERE project_role_id=$1',[role])).rowCount,409,'角色已分配给用户，请先解除分配');
  await c.query('DELETE FROM project_roles WHERE id=$1',[role]);await audit(c,a.workspace_id,req.user.id,'删除项目角色',role,{project_id:project});
 });res.json({ok:true});
});
