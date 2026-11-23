import {workspaceStorageSelection} from '../shared/storage-target.ts';
import {encrypt as encryptPassword,decrypt as decryptPassword} from './security.ts';
import {startupSelection} from '../shared/startup-selection.ts';
import {applyBusinessTemplate} from './business-template.ts';
import { Router } from "express";
import { version } from "./version.ts";
import { notifyUser } from "./notifications.ts";
import { z } from "zod";
import type pg from "pg";
import {
  pool,
  uid,
  tx,
  audit,
  createProject,
  engineeringStages,
  businessStages,
} from "./db.ts";
import {
  access,
  canManage,
  canWrite, operationAllowed, type CrudAction,
  workspaceOwner, isSystemAdmin, workspaceMember,
  tableAccess,
  tableAllowed,
  rowAllowed,
  requireThat,
  HttpError,
} from "./auth.ts";
import { id, name, password, membership, date } from "./validation.ts";
import { hashPasswordAsync, verifyPasswordAsync } from "./security.ts";
import {securityEvent} from './security-events.ts';
import {rateLimit} from 'express-rate-limit';
import { schedule } from "./schedule.ts";
export const governance = Router();
async function lockGrants(c: pg.PoolClient, project: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1),704)", [project]);
}
async function grantTarget(
  c: pg.PoolClient,
  workspace: string,
  user: string,
  actor: string,
) {
  requireThat(user !== actor, 400, "不能通过此入口修改自己的权限");
  const member = (
    await c.query(
      "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 FOR SHARE",
      [workspace, user],
    )
  ).rows[0];
  requireThat(member, 400, "用户不是工作空间成员");
  requireThat(
    member.role !== "owner",
    403,
    "空间所有者的权限不能通过项目授权修改",
  );
}
const workflowStep = z.object({
  name: name,
  approver_id: id,
  mode: z.enum(["one", "all"]).default("one"),
});
const workflowKind = z.enum(["record", "stage", "baseline", "access", "resource"]);
export async function validateGrant(
  project: string,
  body: z.infer<typeof membership>,
  c: pg.Pool | pg.PoolClient,
) {
  if (body.department_id)
    requireThat(
      (
        await c.query(
          "SELECT 1 FROM departments WHERE id=$1 AND project_id=$2",
          [body.department_id, project],
        )
      ).rowCount,
      400,
      "部门不属于项目",
    );
  if (body.table_ids.length) {
    const rows = await c.query(
      "SELECT id FROM data_tables WHERE project_id=$1 AND id=ANY($2::uuid[])",
      [project, body.table_ids],
    );
    requireThat(
      rows.rowCount === new Set(body.table_ids).size,
      400,
      "数据表不属于项目",
    );
  }
  const scopedTables=Object.keys(body.crud_permissions).filter(k=>id.safeParse(k).success);
  if(scopedTables.length) requireThat((await c.query('SELECT id FROM data_tables WHERE project_id=$1 AND id=ANY($2::uuid[])',[project,scopedTables])).rowCount===scopedTables.length,400,'操作授权数据表不属于项目');
  const scopedDepartments=Object.keys(body.crud_permissions).filter(k=>k.startsWith("department:")).map(k=>k.slice(11));
  if(scopedDepartments.length)requireThat((await c.query("SELECT id FROM departments WHERE project_id=$1 AND id=ANY($2::uuid[])",[project,scopedDepartments])).rowCount===scopedDepartments.length,400,"操作授权部门不属于项目");
  if (body.expires_at)
    requireThat(
      Date.parse(body.expires_at) > Date.now(),
      400,
      "授权到期时间必须晚于当前时间",
    );
}
export async function saveGrant(
  c: pg.PoolClient,
  project: string,
  user: string,
  body: z.infer<typeof membership>,
) {
  await lockGrants(c, project);
  if(body.project_role_id){
    const r=(await c.query('SELECT grant_config FROM project_roles WHERE id=$1 AND project_id=$2 FOR SHARE',[body.project_role_id,project])).rows[0];
    requireThat(r,400,'项目角色不属于当前项目');
    body=membership.parse({...r.grant_config,project_role_id:body.project_role_id,expires_at:body.expires_at});
  }
  await validateGrant(project, body, c);
  await c.query(
    "INSERT INTO memberships(id,project_id,user_id,role,department_id,table_ids,hidden_columns,row_scope,can_export,expires_at,crud_permissions,project_role_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,department_id=excluded.department_id,table_ids=excluded.table_ids,hidden_columns=excluded.hidden_columns,row_scope=excluded.row_scope,can_export=excluded.can_export,expires_at=excluded.expires_at,crud_permissions=excluded.crud_permissions,project_role_id=excluded.project_role_id",
    [
      uid(),
      project,
      user,
      body.role,
      body.department_id,
      JSON.stringify(body.table_ids),
      JSON.stringify(body.hidden_columns),
      body.row_scope,
      body.can_export,
      body.expires_at,
      JSON.stringify(body.crud_permissions),
      body.project_role_id,
    ],
  );
}
governance.get('/system/startup-defaults',async(req,res)=>{requireThat(await isSystemAdmin(req.user.id));res.json((await pool.query('SELECT workspace_id,project_id,version,updated_at FROM app_startup_defaults WHERE singleton')).rows[0]);});
governance.put('/system/startup-defaults',async(req,res)=>{requireThat(await isSystemAdmin(req.user.id));const body=z.object({workspace_id:id.nullable(),project_id:id.nullable(),version:z.number().int().positive()}).strict().parse(req.body);const result=await tx(async c=>{const old=(await c.query('SELECT * FROM app_startup_defaults WHERE singleton FOR UPDATE')).rows[0];requireThat(old.version===body.version,409,'默认入口已被修改，请刷新后重试');if(body.workspace_id){const w=(await c.query("SELECT id FROM workspaces WHERE id=$1 AND lifecycle='active' FOR SHARE",[body.workspace_id])).rows[0];requireThat(w,400,'默认工作空间必须为活动工作空间');}if(body.project_id){requireThat(body.workspace_id,400,'请先选择默认工作空间');const p=(await c.query("SELECT id FROM projects WHERE id=$1 AND workspace_id=$2 AND lifecycle='active' FOR SHARE",[body.project_id,body.workspace_id])).rows[0];requireThat(p,400,'默认项目必须为所选工作空间中的活动项目');}const r=(await c.query('UPDATE app_startup_defaults SET workspace_id=$1,project_id=$2,version=version+1,updated_by=$3,updated_at=now() WHERE singleton RETURNING workspace_id,project_id,version,updated_at',[body.workspace_id,body.project_id,req.user.id])).rows[0];const auditWorkspace=body.workspace_id||old.workspace_id||(await c.query('SELECT id FROM workspaces ORDER BY created_at LIMIT 1')).rows[0]?.id;if(auditWorkspace)await audit(c,auditWorkspace,req.user.id,'设置软件默认入口','app_startup_defaults',{before:{workspace_id:old.workspace_id,project_id:old.project_id},after:body});else await c.query("INSERT INTO security_events(event,actor_id,outcome) VALUES('startup_defaults.update',$1,'success')",[req.user.id]);return r;});res.json(result);});
governance.get("/bootstrap", async (req, res) => {
  const system=await isSystemAdmin(req.user.id);
  const workspaces = (
    await pool.query(
      system?"SELECT w.*,'owner' AS role FROM workspaces w ORDER BY w.created_at":"SELECT w.*,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at",
      system?[]:[req.user.id],
    )
  ).rows;
  const projects = (
    await pool.query(
      system?"SELECT p.* FROM projects p ORDER BY p.created_at":"SELECT DISTINCT p.* FROM projects p JOIN workspace_members wm ON wm.workspace_id=p.workspace_id LEFT JOIN memberships m ON m.project_id=p.id AND m.user_id=$1 AND (m.expires_at IS NULL OR m.expires_at>now()) WHERE wm.user_id=$1 AND (wm.role='owner' OR m.user_id=$1) ORDER BY p.created_at",
      system?[]:[req.user.id],
    )
  ).rows;
  const defaults=(await pool.query('SELECT workspace_id,project_id FROM app_startup_defaults WHERE singleton')).rows[0]||{};
  const startup=startupSelection(workspaces,projects,defaults);
  res.json({
    startup:{workspace_id:startup.workspaceId||null,project_id:startup.projectId||null},
    user: req.user,
    workspaces,
    projects,
    engineeringStages,
    businessStages,
    version,
  });
});
governance.post('/system/users/:user/reveal-password',rateLimit({windowMs:15*60_000,limit:10,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
 requireThat(await isSystemAdmin(req.user.id));const body=z.object({admin_password:z.string().min(1).max(128)}).strict().parse(req.body);
 const own=(await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id])).rows[0];
 if(!await verifyPasswordAsync(body.admin_password,own.password_hash)){await securityEvent('password_reveal',req.user.id,'failure',req.ip);throw new HttpError(403,'管理员密码验证失败');}
 const target=(await pool.query('SELECT password_ciphertext FROM users WHERE id=$1',[id.parse(req.params.user)])).rows[0];requireThat(target,404,'用户不存在');
 await securityEvent('password_reveal',req.user.id,'success',req.ip);
 await tx(async c=>{const w=(await c.query('SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id LIMIT 1',[req.params.user])).rows[0];if(w)await audit(c,w.workspace_id,req.user.id,'查看用户密码',req.params.user as string);});
 res.json({password:target.password_ciphertext?decryptPassword(target.password_ciphertext).password:null});
});
governance.post("/workspaces", async (req, res) => {
  const body = z.object({ name, storage_target_id:workspaceStorageSelection }).strict().parse(req.body);
  const workspace = uid();
  await tx(async (c) => {
    if(body.storage_target_id){requireThat(await isSystemAdmin(req.user.id),403,'Only system administrators can reserve a storage target');requireThat((await c.query('SELECT 1 FROM storage_targets WHERE id=$1 FOR SHARE',[body.storage_target_id])).rowCount,400,'Storage target not found');}
    await c.query("INSERT INTO workspaces(id,name,storage_target_id) VALUES($1,$2,$3)", [workspace,body.name,body.storage_target_id||null]);
    await c.query("INSERT INTO workspace_members VALUES($1,$2,'owner')", [
      workspace,
      req.user.id,
    ]);
    await audit(c, workspace, req.user.id, "创建工作空间", workspace);
  });
  res.status(201).json({ id: workspace,storage_state:body.storage_target_id?'reserved':'active' });
});
governance.post("/workspaces/:workspace/projects", async (req, res) => {
  const workspace = id.parse(req.params.workspace),
    body = z
      .object({
        name,
        start_date: date,
        description: z.string().max(500).default(""),
        use_standard_template: z.boolean().default(true),
        template_profile: z.enum(["generic","hospital","stadium"]).default("generic"),
      })
      .parse(req.body);
  requireThat(await workspaceOwner(req.user.id, workspace));
  const result = await tx(async (c) => {
    const storage=(await c.query('SELECT storage_target_id FROM workspaces WHERE id=$1 FOR SHARE',[workspace])).rows[0];
    requireThat(storage&&!storage.storage_target_id,409,'\u6240\u9009\u6570\u636e\u5e93\u4ec5\u9884\u7559\u914d\u7f6e\u63a5\u53e3\uff0c\u5c1a\u672a\u63a5\u5165\uff1b\u6682\u4e0d\u521b\u5efa\u9879\u76ee\uff0c\u907f\u514d\u5199\u5165\u9519\u8bef\u6570\u636e\u5e93');
    const p = await createProject(
      c,
      workspace,
      body.name,
      body.start_date,
      body.description,
    );
    await c.query('UPDATE projects SET template_profile=$1 WHERE id=$2',[body.template_profile,p.id]);
    if(body.use_standard_template){const project=(await c.query('SELECT * FROM projects WHERE id=$1',[p.id])).rows[0];await applyBusinessTemplate(c,project,req.user.id);}
    await audit(c, workspace, req.user.id, "创建项目", p.id,{standard_template:body.use_standard_template});
    return p;
  });
  res.status(201).json(result);
});
governance.put("/projects/:project/stages", async (req, res) => {
  const project = id.parse(req.params.project);
  const body = z.object({engineering_stage:z.enum(engineeringStages as [string,...string[]]),business_stage:z.enum(businessStages as [string,...string[]]),reason:z.string().trim().max(1000).default("")}).strict().parse(req.body);
  const result = await tx(async c => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const a = await access(req.user.id, project, c);
    requireThat(await workspaceOwner(req.user.id, a.workspace_id, c),403,"仅管理员可直接设置项目阶段");
    requireThat(a.lifecycle==='active' && a.workspace_lifecycle==='active',409,"当前空间或项目非活动状态");
    const updated = (await c.query("UPDATE projects SET engineering_stage=$1,business_stage=$2 WHERE id=$3 RETURNING id,engineering_stage,business_stage", [body.engineering_stage,body.business_stage,project])).rows[0];
    await audit(c,a.workspace_id,req.user.id,"直接设置项目阶段",project,{before:{engineering_stage:a.engineering_stage,business_stage:a.business_stage},after:body});
    return updated;
  });
  res.json(result);
});
governance.get("/projects/:project/context", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  const departments = (
    await pool.query(
      "SELECT * FROM departments WHERE project_id=$1 ORDER BY name",
      [a.id],
    )
  ).rows;
  const users = (
    await pool.query(
      "SELECT DISTINCT u.id,u.name,u.username,CASE WHEN wm.role='owner' THEN 'owner' ELSE m.role END AS role FROM users u JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id=$1 LEFT JOIN memberships m ON m.user_id=u.id AND m.project_id=$2 AND (m.expires_at IS NULL OR m.expires_at>now()) WHERE u.active AND (wm.role='owner' OR m.id IS NOT NULL) UNION SELECT id,name,username,'owner' AS role FROM users WHERE system_admin AND active",
      [a.workspace_id, a.id],
    )
  ).rows;
  res.json({
    permission: {
      role: a.role,project_role_name:a.project_role_name,
      files: Object.fromEntries(["read","create","update","delete"].map(action=>[action,operationAllowed(a,"$files",action as CrudAction)&&(action==="read"||a.lifecycle==="active"&&a.workspace_lifecycle==="active")])),
      manage: canManage(a),
      write: canWrite(a),
      export: canManage(a) || a.can_export,
      expires_at: a.expires_at,
    },
    departments,
    users,
  });
});
governance.get("/workspaces/:workspace/users", async (req, res) => {
  const workspace = id.parse(req.params.workspace);
  requireThat(await workspaceOwner(req.user.id, workspace));
  res.json(
    (
      await pool.query(
        "SELECT u.id,u.username,u.name,u.active,u.created_at,u.revision,u.provisioned_initial_password AS must_change_password,wm.role FROM users u JOIN workspace_members wm ON wm.user_id=u.id WHERE wm.workspace_id=$1 ORDER BY u.created_at",
        [workspace],
      )
    ).rows,
  );
});
governance.post("/workspaces/:workspace/users", async (req, res) => {
  const workspace = id.parse(req.params.workspace),
    body = z
      .object({
        username: z.string().regex(/^[a-zA-Z0-9_.-]{3,40}$/),
        name,
        password:password,
      })
      .parse(req.body);
  requireThat(await workspaceOwner(req.user.id, workspace));
  const user = uid();
  requireThat(body.username.toLowerCase()!=='superadmin',403,'保留的系统账号不能通过普通用户入口创建');
  await tx(async (c) => {
    await c.query(
      "INSERT INTO users(id,username,name,password_hash,password_policy_version,provisioned_initial_password,password_ciphertext) VALUES($1,$2,$3,$4,1,true,$5)",
      [user, body.username, body.name, await hashPasswordAsync(body.password),encryptPassword({password:body.password})],
    );
    await c.query("INSERT INTO workspace_members VALUES($1,$2,'member')", [
      workspace,
      user,
    ]);
    await audit(c, workspace, req.user.id, "创建账号", user);
  });
  res.status(201).json({ id: user });
});
governance.patch("/workspaces/:workspace/users/:user", async (req, res) => {
  const workspace = id.parse(req.params.workspace),
    user = id.parse(req.params.user);
  const body = z
    .object({
      active: z.boolean().optional(),
      password: password.optional(),
      name: name.optional(),
      expected_revision: id.optional(),
    })
    .refine(
      (b) =>
        b.active !== undefined ||
        b.password !== undefined ||
        b.name !== undefined,
    )
    .parse(req.body);
  requireThat(await workspaceOwner(req.user.id, workspace));
  requireThat(
    user !== req.user.id,
    400,
    "请在个人设置中修改自己的密码，不能停用自己",
  );
  await tx(async (c) => {
    const memberships = (
      await c.query(
        "SELECT * FROM workspace_members WHERE user_id=$1 FOR UPDATE",
        [user],
      )
    ).rows;
    requireThat(
      memberships.some(
        (m) => m.workspace_id === workspace && m.role !== "owner",
      ),
      403,
      "不能通过此入口修改空间所有者",
    );
    for (const m of memberships)
      requireThat(
        await workspaceOwner(req.user.id, m.workspace_id, c),
        403,
        "该账号属于多个工作空间，当前管理员不能全局修改",
      );
    const current = (
      await c.query("SELECT revision FROM users WHERE id=$1 FOR UPDATE", [user])
    ).rows[0];
    requireThat(current, 404, "账号不存在");
    requireThat(
      !body.expected_revision || body.expected_revision === current.revision,
      409,
      "账号已被其他操作修改，请重新加载后核对",
    );
    await c.query(
      "UPDATE users SET active=COALESCE($1,active),password_hash=COALESCE($2,password_hash),password_policy_version=CASE WHEN $2::text IS NOT NULL THEN 1 ELSE password_policy_version END,provisioned_initial_password=CASE WHEN $2::text IS NOT NULL THEN true ELSE provisioned_initial_password END,password_ciphertext=COALESCE($5,password_ciphertext),name=COALESCE($4,name) WHERE id=$3",
      [
        body.active ?? null,
        body.password ? await hashPasswordAsync(body.password) : null,
        user,
        body.name ?? null,
        body.password ? encryptPassword({password:body.password}) : null,
      ],
    );
    if (body.active !== undefined || body.password !== undefined)
      await c.query("DELETE FROM sessions WHERE user_id=$1", [user]);
    await audit(
      c,
      workspace,
      req.user.id,
      body.password
        ? "重置账号密码"
        : body.active !== undefined
          ? body.active
            ? "启用账号"
            : "停用账号"
          : "修改账号姓名",
      user,
      { name: body.name, active: body.active },
    );
  });
  res.json({ ok: true });
});
governance.post("/me/password",rateLimit({windowMs:15*60_000,limit:5,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'改密尝试过多，请稍后重试'}}), async (req, res) => {
  const body = z.object({ old: z.string().max(128), password }).parse(req.body);
  const user = (
    await pool.query("SELECT password_hash FROM users WHERE id=$1", [
      req.user.id,
    ])
  ).rows[0];
  if(!await verifyPasswordAsync(body.old,user.password_hash)){await securityEvent('password_change',req.user.id,'failure',req.ip);throw new HttpError(400,'原密码不正确');}
  requireThat(!await verifyPasswordAsync(body.password,user.password_hash),400,"新密码不能与原密码相同");
  const replacement=await hashPasswordAsync(body.password);
  await tx(async (c) => {
    const updated=await c.query("UPDATE users SET password_hash=$1,password_policy_version=1,provisioned_initial_password=false,password_ciphertext=$4 WHERE id=$2 AND password_hash=$3 AND active RETURNING id", [replacement,req.user.id,user.password_hash,encryptPassword({password:body.password})]);
    requireThat(updated.rowCount,409,'账号或密码已被其他操作更改，请重新登录后重试');
    await c.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
  });
  await securityEvent('password_change',req.user.id,'success',req.ip);
  res.clearCookie("studio_session", { path: "/" }).json({ ok: true });
});
governance.get("/projects/:project/members", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(canManage(a));
  res.json(
    (
      await pool.query(
        "SELECT m.*,u.name,u.username FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 ORDER BY u.name",
        [a.id],
      )
    ).rows,
  );
});
governance.put("/projects/:project/members/:user", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project)),
    user = id.parse(req.params.user),
    body = membership.parse(req.body);
  requireThat(
    await workspaceOwner(req.user.id, a.workspace_id),
    403,
    "直接配置项目授权仅限工作空间所有者",
  );
  requireThat(user !== req.user.id, 400, "不能通过此入口修改自己的权限");
  requireThat(
    (
      await pool.query(
        "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
        [a.workspace_id, user],
      )
    ).rowCount,
    400,
    "用户不是工作空间成员",
  );
  await tx(async (c) => {
    await lockGrants(c, a.id);
    await grantTarget(c, a.workspace_id, user, req.user.id);
    if (req.body.expected_revision !== undefined) {
      const expected = id.nullable().parse(req.body.expected_revision);
      const current = (
        await c.query(
          "SELECT revision FROM memberships WHERE project_id=$1 AND user_id=$2 FOR UPDATE",
          [a.id, user],
        )
      ).rows[0];
      requireThat(
        expected === (current?.revision ?? null),
        409,
        "授权已发生变化，请刷新后重试",
      );
    }
    await saveGrant(c, a.id, user, body);
    await audit(c, a.workspace_id, req.user.id, "配置项目授权", user, body);
  });
  res.json({ ok: true });
});
governance.delete("/projects/:project/members/:user", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project)),
    user = id.parse(req.params.user);
  requireThat(await workspaceOwner(req.user.id, a.workspace_id));
  requireThat(user !== req.user.id, 400, "不能移除自己");
  await tx(async (c) => {
    await lockGrants(c, a.id);
    await grantTarget(c, a.workspace_id, user, req.user.id);
    await c.query(
      "DELETE FROM memberships WHERE project_id=$1 AND user_id=$2",
      [a.id, user],
    );
    await audit(c, a.workspace_id, req.user.id, "收回项目授权", user);
  });
  res.json({ ok: true });
});

governance.get("/projects/:project/permission-matrix", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(await workspaceOwner(req.user.id, a.workspace_id));
  const rows = (
    await pool.query(
      `SELECT u.id AS user_id,u.name,u.username,u.active,wm.role AS workspace_role,
    CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END AS grant
    FROM workspace_members wm JOIN users u ON u.id=wm.user_id
    LEFT JOIN memberships m ON m.user_id=u.id AND m.project_id=$2
    WHERE wm.workspace_id=$1 ORDER BY u.created_at,u.id`,
      [a.workspace_id, a.id],
    )
  ).rows;
  res.json({ rows });
});

governance.put("/projects/:project/permission-matrix", async (req, res) => {
  const project = id.parse(req.params.project);
  const body = z
    .object({
      changes: z
        .array(
          z.object({
            user_id: id,
            expected_revision: id.nullable(),
            grant: membership.nullable(),
          }),
        )
        .min(1)
        .max(100)
        .refine(
          (rows) => new Set(rows.map((r) => r.user_id)).size === rows.length,
          "成员不可重复",
        ),
    })
    .parse(req.body);
  await tx(async (c) => {
    await lockGrants(c, project);
    const a = await access(req.user.id, project, c);
    requireThat(await workspaceOwner(req.user.id, a.workspace_id, c));
    requireThat(
      a.lifecycle === "active" && a.workspace_lifecycle === "active",
      409,
      "项目或工作空间非活动状态，不能修改权限表",
    );
    for (const change of [...body.changes].sort((a, b) =>
      a.user_id.localeCompare(b.user_id),
    )) {
      await grantTarget(c, a.workspace_id, change.user_id, req.user.id);
      const current = (
        await c.query(
          "SELECT * FROM memberships WHERE project_id=$1 AND user_id=$2 FOR UPDATE",
          [project, change.user_id],
        )
      ).rows[0];
      requireThat(
        (current?.revision ?? null) === change.expected_revision,
        409,
        "至少一名成员的授权已被修改，整批未保存；请刷新并核对后重试",
      );
      if (change.grant)
        await saveGrant(c, project, change.user_id, change.grant);
      else
        await c.query(
          "DELETE FROM memberships WHERE project_id=$1 AND user_id=$2",
          [project, change.user_id],
        );
      await audit(
        c,
        a.workspace_id,
        req.user.id,
        change.grant ? "权限表配置授权" : "权限表收回授权",
        change.user_id,
        {
          project_id: project,
          before: current ?? null,
          after: change.grant,
        },
      );
    }
  });
  res.json({ ok: true, count: body.changes.length });
});
governance.get("/workspaces/:workspace/project-directory", async (req, res) => {
  const workspace = id.parse(req.params.workspace);
  requireThat(
    (
      await pool.query(
        "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
        [workspace, req.user.id],
      )
    ).rowCount,
  );
  res.json(
    (
      await pool.query(
        "SELECT id,name FROM projects WHERE workspace_id=$1 ORDER BY name",
        [workspace],
      )
    ).rows,
  );
});
governance.get("/workspaces/:workspace/audit", async (req, res) => {
  const workspace = id.parse(req.params.workspace);
  requireThat(await workspaceOwner(req.user.id, workspace));
  res.json(
    (
      await pool.query(
        "SELECT a.*,u.name AS actor_name,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=$1 ORDER BY a.id DESC LIMIT 200",
        [workspace],
      )
    ).rows,
  );
});

governance.get('/projects/:project/permission-tree',async(req,res)=>{
 const project=id.parse(req.params.project),a=await access(req.user.id,project);requireThat(await workspaceOwner(req.user.id,a.workspace_id));
 const nodes=(await pool.query("SELECT id,parent_id,kind,name FROM project_files WHERE project_id=$1 AND lifecycle='active' ORDER BY kind,name LIMIT 2001",[project])).rows;
 res.json({files:nodes.slice(0,2000),truncated:nodes.length>2000});
});
