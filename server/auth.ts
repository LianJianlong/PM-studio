import {defaultProjectCalendar} from "../shared/project-calendar.ts";
import type { Request, Response, NextFunction } from "express";
import type pg from "pg";
import { pool } from "./db.ts";
import { tokenHash } from "./security.ts";
import { recordValues, isSystemField, fieldExemptsExisting } from "../shared/fields.ts";
import { assertNoFormulaCycles, tryEvaluateFormula } from "../shared/formulas.ts";
export type User = { id: string; username: string; name: string; system_admin?:boolean; must_change_password?:boolean };
declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  status = 403,
  message = "没有执行此操作的权限",
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.studio_session;
  if (!token) throw new HttpError(401, "请先登录");
  const result = await pool.query(
    "SELECT u.id,u.username,u.name,u.system_admin,u.provisioned_initial_password AS must_change_password FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active",
    [tokenHash(token)],
  );
  if (!result.rowCount) throw new HttpError(401, "登录已失效，请重新登录");
  req.user = result.rows[0];
  requireThat(!req.user.must_change_password || ["/bootstrap","/me/password","/logout"].includes(req.path),403,"首次登录必须修改初始密码");
  next();
}
export async function workspaceOwner(
  user: string,
  workspace: string,
  c: pg.Pool | pg.PoolClient = pool,
) {
  return Boolean(
    (
      await c.query(
        "SELECT 1 WHERE EXISTS(SELECT 1 FROM users WHERE id=$2 AND system_admin AND active) OR EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='owner')",
        [workspace, user],
      )
    ).rowCount,
  );
}
export async function access(
  user: string,
  project: string,
  c: pg.Pool | pg.PoolClient = pool,
) {
  const p = (await c.query("SELECT * FROM projects WHERE id=$1", [project]))
    .rows[0];
  if (!p) throw new HttpError(404, "项目不存在");
  const parent = (
    await c.query("SELECT lifecycle FROM workspaces WHERE id=$1", [
      p.workspace_id,
    ])
  ).rows[0];
  p.workspace_lifecycle = parent?.lifecycle;
  requireThat(
    p.lifecycle !== "deleted" && parent?.lifecycle !== "deleted",
    409,
    "对象已删除，请由管理者在对象管理中恢复",
  );
  // System authority is a protected database role, independent of login name.
  const administrator = (await c.query("SELECT 1 FROM users WHERE id=$1 AND system_admin AND active", [user])).rowCount;
  if (administrator || await workspaceOwner(user, p.workspace_id, c))
    return {
      ...p,
      role: "owner",
      user_id: user,
      table_ids: [],
      hidden_columns: [],
      row_scope: "all",
      can_export: true,
      department_id: null,
      expires_at: null,
    };
  const member = (
    await c.query(
      "SELECT m.*,r.name AS project_role_name FROM memberships m LEFT JOIN project_roles r ON r.id=m.project_role_id WHERE m.project_id=$1 AND m.user_id=$2 AND (m.expires_at IS NULL OR m.expires_at>now())",
      [project, user],
    )
  ).rows[0];
  if (!member) throw new HttpError(403, "没有项目访问权限或授权已到期");
  const confirmation_table_ids=member.role==='reviewer'?(await c.query("SELECT id FROM data_tables WHERE project_id=$1 AND lifecycle<>'deleted' AND (department_id=$2 OR $3::jsonb->('department:'||department_id::text)->>'read'='true')",[project,member.department_id,JSON.stringify(member.crud_permissions||{})])).rows.map(t=>t.id):[];
  return { ...p, ...member, id: p.id, workspace_id: p.workspace_id,confirmation_table_ids };
}
export const canManage = (a: any) => ["owner", "manager"].includes(a.role);
export async function isSystemAdmin(user:string,c:pg.Pool|pg.PoolClient=pool){return Boolean((await c.query("SELECT 1 FROM users WHERE id=$1 AND system_admin AND active",[user])).rowCount);}
export async function workspaceMember(user:string,workspace:string,c:pg.Pool|pg.PoolClient=pool){return await isSystemAdmin(user,c)||Boolean((await c.query('SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2',[workspace,user])).rowCount);}
export const canWrite = (a: any) =>
  ["owner", "manager", "editor"].includes(a.role);
export type CrudAction = 'read'|'create'|'update'|'delete';
export function operationAllowed(a:any,key:string,action:CrudAction){
 if(canManage(a))return true;
 if(action!=='read'&&!canWrite(a))return false;
 const rule=a.crud_permissions?.[key]??(key==='$files'?undefined:a.crud_permissions?.$data);
 return rule?!!rule[action]:true;
}
export const canRecordAction=(a:any,t:any,action:CrudAction)=>t.is_agenda?(action==='read'||canWrite(a)):operationAllowed(a,!a.crud_permissions?.[t.id]&&a.crud_permissions?.[`department:${t.department_id}`]?`department:${t.department_id}`:t.id,action);
export function tableAllowed(a: any, t: any) {
  return (
    t.lifecycle !== "deleted" &&
    (t.is_agenda || canManage(a) ||
      (canRecordAction(a,t,"read") && (!a.department_id || a.department_id === t.department_id) &&
        (!a.table_ids.length || a.table_ids.includes(t.id))))
  );
}
export async function tableAccess(
  user: string,
  id: string,
  c: pg.Pool | pg.PoolClient = pool,
) {
  const table = (
    await c.query(
      "SELECT * FROM data_tables WHERE id=$1" +
        (c === pool ? "" : " FOR SHARE"),
      [id],
    )
  ).rows[0];
  if (!table) throw new HttpError(404, "数据表不存在");
  const permission = await access(user, table.project_id, c);
  requireThat(tableAllowed(permission, table));
  return { table, permission };
}
export function visibleColumns(a: any, t: any) {
  return t.columns.filter(
    (f: any) =>
      f.lifecycle !== "deleted" &&
      (canManage(a) || !a.hidden_columns.includes(f.id)),
  );
}
export function projectRecord(a: any, t: any, r: any) {
  const visible = visibleColumns(a, t);
  const ids = new Set(visible.map((f: any) => f.id));
  const projected = { ...r };
  // Configured hidden provenance columns must not leak through parallel metadata keys.
  for (const f of t.columns)
    if (isSystemField(f) && !ids.has(f.id)) {
      if (f.type === "created_user") {
        delete projected.created_by;
        delete projected.creator;
      }
      if (f.type === "modified_user") delete projected.updated_by;
      if (f.type === "created_time") delete projected.created_at;
      if (f.type === "modified_time") delete projected.updated_at;
    }
  const values = recordValues(t.columns, r);
  const exemptFields=visible.filter((f:any)=>fieldExemptsExisting(f,r.created_at)).map((f:any)=>f.id);
  const exempt=new Set(exemptFields);
  const activeFormulas=visible.filter((f:any)=>f.type==="formula"&&f.formula&&!exempt.has(f.id));
  for(const f of visible)if(f.type==="formula"&&exempt.has(f.id))values[f.id]=r.data[f.id]??null;
  const formulas = Object.fromEntries(
    activeFormulas
      .map((f: any) => [f.id, f.formula]),
  );
  if (Object.keys(formulas).length) {
    try {
      assertNoFormulaCycles(formulas, { fields: Array.from(ids) as string[] });
      const pending = new Set(Object.keys(formulas));
      const calculationValues: Record<string, any> = Object.fromEntries(
        Object.entries(values).filter(([key]) => ids.has(key)),
      );
      while (pending.size) {
        let progressed = false;
        for (const f of visible.filter((x: any) => pending.has(x.id))) {
          const result = tryEvaluateFormula(f.formula, calculationValues, {
            fields: Array.from(ids) as string[],calendar:a.calendar_config||defaultProjectCalendar,
          });
          if (result.ok) {
            calculationValues[f.id] = result.value;
            pending.delete(f.id);
            progressed = true;
          } else if (result.error.code !== "UNKNOWN_FIELD") {
            calculationValues[f.id] = `#ERROR:${result.error.code}`;
            pending.delete(f.id);
            progressed = true;
          }
        }
        if (!progressed) {
          for (const id of pending) calculationValues[id] = "#ERROR:DEPENDENCY";
          break;
        }
      }
      for (const f of activeFormulas) values[f.id] = calculationValues[f.id];
    } catch (error) {
      for (const f of activeFormulas)
        values[f.id] = `#ERROR:${(error as any)?.code ?? "FORMULA"}`;
    }
  }
  return {
    ...projected,
    ...(exemptFields.length?{exempt_fields:exemptFields}:{}),
    data: Object.fromEntries(
      Object.entries(values).filter(([key]) =>
        ids.has(key),
      ),
    ),
  };
}
export function canConfirmRecord(a:any,t:any){if(t.is_agenda)return canManage(a);return tableAllowed(a,t)&&(canManage(a)||(a.role==='reviewer'&&(a.confirmation_table_ids||[]).includes(t.id)))&&visibleColumns(a,t).length===t.columns.filter((f:any)=>f.lifecycle!=='deleted').length;}
export function rowScopeAllowed(a:any,r:any,user:string){return canManage(a)||(r.agenda_owner_id?r.agenda_owner_id===user:a.row_scope!=="own"||r.created_by===user||r.updated_by===user);}
export function rowAllowed(a:any,r:any,user:string){
 if(canManage(a))return true;
 if(r.agenda_owner_id)return r.agenda_owner_id===user;
 const supervisor=(a.confirmation_table_ids||[]).includes(r.table_id);
 const own=r.created_by===user||r.updated_by===user;
 return (r.status==='approved'||own||supervisor)&&(a.row_scope!=='own'||own||supervisor);
}
export function recordVisibilitySql(a:any,userParameter:string,alias='r'){
 if(canManage(a))return `(${userParameter}::uuid IS NOT NULL)`;
 const ids=(a.confirmation_table_ids||[]).filter((id:string)=>/^[a-f0-9-]{36}$/i.test(id));
 const supervisor=ids.length?`${alias}.table_id=ANY(ARRAY[${ids.map((id:string)=>"'"+id+"'").join(',')}]::uuid[])`:'FALSE';
 const own=`(${alias}.created_by=${userParameter}::uuid OR ${alias}.updated_by=${userParameter}::uuid)`;
 return `((${alias}.agenda_owner_id=${userParameter}::uuid) OR (${alias}.agenda_owner_id IS NULL AND (${alias}.status='approved' OR ${own} OR ${supervisor}) AND (${a.row_scope==='own'?`${own} OR ${supervisor}`:'TRUE'})))`;
}
