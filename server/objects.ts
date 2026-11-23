import {businessActions} from './business-actions.ts';
import {businessOntology} from './business-ontology.ts';
import {fieldExemptsExisting} from "../shared/fields.ts";
import { Router } from "express";
import { z } from "zod";
import { pool, tx, audit } from "./db.ts";
import { workspaceOwner, isSystemAdmin, workspaceMember, requireThat } from "./auth.ts";
import { id, name, date, field as fieldDefinition } from "./validation.ts";
import { changeFieldValue } from "../shared/field-change.ts";
import { assertNoFormulaCycles } from "../shared/formulas.ts";
import { isReference } from "../shared/fields.ts";
import {
  projectReferenceRows,
  synchronizeReferenceColumnState,
  lockReferenceProject,
} from "./references.ts";
export const objects = Router();
objects.use(businessOntology);
objects.use(businessActions);
const states = z.enum(["active", "frozen", "disabled", "deleted"]);
const targets = {
  workspace: "workspaces",
  project: "projects",
  table: "data_tables",
  record: "records",
} as const;
objects.get("/objects/recycle-bin", async (req, res) => {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page);
  const kind = z
    .enum(["all", "workspace", "project", "table", "column", "record"])
    .default("all")
    .parse(req.query.kind);
  const search = z.string().max(100).default("").parse(req.query.search);
  const query = `WITH authorized_projects AS (
    SELECT p.*,w.name AS workspace_name FROM projects p JOIN workspaces w ON w.id=p.workspace_id
    WHERE EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.system_admin AND u.active)
      OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.user_id=$1 AND wm.role='owner')
      OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=p.id AND m.user_id=$1 AND m.role='manager' AND (m.expires_at IS NULL OR m.expires_at>now()))
  ), items AS (
    SELECT 'workspace'::text AS kind,w.id::text AS id,NULL::text AS table_id,w.name,''::text AS path,w.object_version AS version FROM workspaces w WHERE w.lifecycle='deleted' AND (EXISTS(SELECT 1 FROM users u WHERE u.id=$1 AND u.system_admin AND u.active) OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=w.id AND wm.user_id=$1 AND wm.role='owner'))
    UNION ALL SELECT 'project',p.id::text,NULL,p.name,p.workspace_name,p.object_version FROM authorized_projects p WHERE p.lifecycle='deleted'
    UNION ALL SELECT 'table',t.id::text,NULL,t.name,p.workspace_name||' / '||p.name,t.object_version FROM data_tables t JOIN authorized_projects p ON p.id=t.project_id WHERE t.lifecycle='deleted'
    UNION ALL SELECT 'column',f->>'id',t.id::text,f->>'name',p.workspace_name||' / '||p.name||' / '||t.name,t.object_version FROM data_tables t JOIN authorized_projects p ON p.id=t.project_id CROSS JOIN LATERAL jsonb_array_elements(t.columns) f WHERE f->>'lifecycle'='deleted'
    UNION ALL SELECT 'record',r.id::text,t.id::text,coalesce(r.data->>'title',r.data->>'name',r.data->>'code',r.id::text),p.workspace_name||' / '||p.name||' / '||t.name,r.version FROM records r JOIN data_tables t ON t.id=r.table_id JOIN authorized_projects p ON p.id=t.project_id WHERE r.lifecycle='deleted'
  ), matched AS (SELECT * FROM items WHERE ($2='all' OR kind=$2) AND strpos(lower(name||' '||path||' '||id),lower($3))>0) `;
  const params = [req.user.id, kind, search];
  const [rows, count] = await Promise.all([
    pool.query(
      query +
        "SELECT * FROM matched ORDER BY kind,path,name,id LIMIT 50 OFFSET $4",
      [...params, (page - 1) * 50],
    ),
    pool.query(query + "SELECT count(*)::int AS total FROM matched", params),
  ]);
  res.json({ rows: rows.rows, total: count.rows[0].total, page });
});
const edit = z
  .object({
    version: z.number().int().positive(),
    name: name.optional(),
    description: z.string().max(500).optional(),
    start_date: date.optional(),
    lifecycle: states.optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.description !== undefined ||
      b.start_date !== undefined ||
      b.lifecycle !== undefined,
    "请选择修改内容",
  );
async function scope(
  user: string,
  kind: keyof typeof targets,
  key: string,
  c: any = pool,
) {
  const row = (
    await c.query(`SELECT * FROM ${targets[kind]} WHERE id=$1`, [key])
  ).rows[0];
  requireThat(row, 404, "对象不存在");
  let workspace: string;
  const administrator = (
    await c.query(
      "SELECT 1 FROM users WHERE id=$1 AND system_admin AND active",
      [user],
    )
  ).rowCount;
  if (kind === "workspace") {
    workspace = row.id;
    requireThat(administrator || (await workspaceOwner(user, workspace, c)));
  } else {
    const project =
      kind === "project"
        ? row.id
        : kind === "table"
          ? row.project_id
          : (
              await c.query("SELECT project_id FROM data_tables WHERE id=$1", [
                row.table_id,
              ])
            ).rows[0]?.project_id;
    const p = (await c.query("SELECT * FROM projects WHERE id=$1", [project]))
      .rows[0];
    workspace = p.workspace_id;
    if (!administrator && !(await workspaceOwner(user, workspace, c))) {
      const member = (
        await c.query(
          "SELECT role FROM memberships WHERE project_id=$1 AND user_id=$2 AND (expires_at IS NULL OR expires_at>now())",
          [project, user],
        )
      ).rows[0];
      requireThat(member?.role === "manager");
    }
  }
  return { row, workspace };
}
objects.get("/objects/workspaces", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT w.*,coalesce(wm.role,'owner') AS workspace_role FROM workspaces w LEFT JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=$1 WHERE EXISTS(SELECT 1 FROM users WHERE id=$1 AND system_admin AND active) OR (wm.role='owner' OR EXISTS(SELECT 1 FROM projects p JOIN memberships m ON m.project_id=p.id WHERE p.workspace_id=w.id AND m.user_id=$1 AND m.role='manager' AND (m.expires_at IS NULL OR m.expires_at>now()))) ORDER BY w.created_at",
        [req.user.id],
      )
    ).rows,
  ),
);
objects.get("/objects/workspaces/:workspace/projects", async (req, res) => {
  const key = id.parse(req.params.workspace);
  requireThat(await workspaceMember(req.user.id,key));
  const owner = await workspaceOwner(req.user.id, key);
  res.json(
    (
      await pool.query(
        "SELECT p.* FROM projects p WHERE workspace_id=$1 AND ($3 OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=p.id AND m.user_id=$2 AND m.role='manager' AND (m.expires_at IS NULL OR m.expires_at>now()))) ORDER BY created_at",
        [key, req.user.id, owner],
      )
    ).rows,
  );
});
objects.get("/objects/projects/:project/tables", async (req, res) => {
  const { row } = await scope(
    req.user.id,
    "project",
    id.parse(req.params.project),
  );
  res.json(
    (
      await pool.query(
        "SELECT t.*,d.name AS department_name FROM data_tables t JOIN departments d ON d.id=t.department_id WHERE t.project_id=$1 ORDER BY t.created_at",
        [row.id],
      )
    ).rows,
  );
});
objects.get("/objects/tables/:table/records", async (req, res) => {
  const { row } = await scope(req.user.id, "table", id.parse(req.params.table));
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page);
  const q = z.string().max(100).default("").parse(req.query.search);
  const excludeDeleted = req.query.excludeDeleted === "true";
  const column = req.query.column
    ? z.string().max(40).parse(req.query.column)
    : null;
  requireThat(
    !column || row.columns.some((f: any) => f.id === column),
    400,
    "字段不属于此表",
  );
  const [rows, count] = await Promise.all([
    pool.query(
      "SELECT r.* FROM records r WHERE table_id=$1 AND (NOT $6::boolean OR r.lifecycle<>'deleted') AND ($4::int IS NULL OR true) AND strpos(lower(CASE WHEN $5::text IS NULL THEN record_field_values(r,$3::jsonb)::text ELSE coalesce(record_field_values(r,$3::jsonb)->>$5,'') END),lower($2))>0 ORDER BY created_at DESC,id LIMIT 50 OFFSET $4",
      [
        row.id,
        q,
        JSON.stringify(row.columns),
        (page - 1) * 50,
        column,
        excludeDeleted,
      ],
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM records r WHERE table_id=$1 AND (NOT $6::boolean OR r.lifecycle<>'deleted') AND ($4::int IS NULL OR true) AND strpos(lower(CASE WHEN $5::text IS NULL THEN record_field_values(r,$3::jsonb)::text ELSE coalesce(record_field_values(r,$3::jsonb)->>$5,'') END),lower($2))>0",
      [row.id, q, JSON.stringify(row.columns), null, column, excludeDeleted],
    ),
  ]);
  res.json({
    rows: await projectReferenceRows(
      req.user.id,
      row,
      { role: "manager" },
      rows.rows,
    ),
    selected_column: column,
    total: count.rows[0].count,
    page,
    table: row,
  });
});
objects.patch("/objects/:kind/:object", async (req, res) => {
  const kind = z
      .enum(["workspace", "project", "table", "record"])
      .parse(req.params.kind),
    key = id.parse(req.params.object),
    body = edit.parse(req.body);
  await tx(async (c) => {
    await c.query(`SELECT id FROM ${targets[kind]} WHERE id=$1 FOR UPDATE`, [
      key,
    ]);
    const { row, workspace } = await scope(req.user.id, kind, key, c);
    const version = kind === "record" ? "version" : "object_version";
    requireThat(row[version] === body.version, 409, "对象已更新，请刷新后重试");
    if (kind === "record") {
      requireThat(
        body.name === undefined &&
          body.description === undefined &&
          body.start_date === undefined,
        400,
        "记录内容请在数据中心编辑",
      );
      requireThat(
        row.status !== "pending",
        409,
        "待审记录请先撤回，再调整对象状态",
      );
      if (body.lifecycle === "deleted")
        requireThat(
          ["draft", "rejected"].includes(row.status),
          409,
          "正式或被替代记录不能删除，请走变更审批",
        );
    }
    requireThat(
      body.start_date === undefined || kind === "project",
      400,
      "只有项目可修改开始日期",
    );
    requireThat(
      body.description === undefined || ["project", "table"].includes(kind),
      400,
      "此对象不支持描述",
    );
    if (body.start_date !== undefined && kind === "project")
      requireThat(
        !(
          await c.query(
            "SELECT 1 FROM approvals WHERE project_id=$1 AND status='pending' AND kind='baseline' LIMIT 1",
            [key],
          )
        ).rowCount,
        409,
        "存在待审基线，请先处理后修改开始日期",
      );
    if (body.lifecycle === "deleted" && kind !== "record") {
      const condition =
        kind === "workspace"
          ? "ap.project_id IN(SELECT id FROM projects WHERE workspace_id=$1)"
          : kind === "project"
            ? "ap.project_id=$1"
            : "ap.record_id IN(SELECT id FROM records WHERE table_id=$1)";
      requireThat(
        !(
          await c.query(
            `SELECT 1 FROM approvals ap WHERE ${condition} AND status='pending' LIMIT 1`,
            [key],
          )
        ).rowCount,
        409,
        "存在待审申请，请先处理后删除",
      );
    }
    const changes = Object.entries(body).filter(([k]) => k !== "version"),
      values = changes.map(([, v]) => v);
    await c.query(
      `UPDATE ${targets[kind]} SET ${changes.map(([k], i) => `${k}=$${i + 1}`).join(",")},${version}=${version}+1 WHERE id=$${values.length + 1}`,
      [...values, key],
    );
    await audit(c, workspace, req.user.id, "更新对象", key, {
      kind,
      before: Object.fromEntries(changes.map(([k]) => [k, row[k]])),
      after: Object.fromEntries(changes),
    });
  });
  res.json({ ok: true });
});
objects.patch("/objects/tables/:table/columns/:column", async (req, res) => {
  const key = id.parse(req.params.table),
    fieldId = z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
      .parse(req.params.column);
  const body = z
    .object({
      version: z.number().int().positive(),
      name: name.optional(),
      unit: z.string().max(20).optional(),
      lifecycle: states.optional(),
      definition: fieldDefinition.optional(),
      preserve_existing:z.boolean().optional(),
    })
    .parse(req.body);
  await tx(async (c) => {
    const project = (
      await c.query("SELECT project_id FROM data_tables WHERE id=$1", [key])
    ).rows[0];
    requireThat(project, 404, "数据表不存在");
    await lockReferenceProject(c, project.project_id);
    await c.query("SELECT id FROM data_tables WHERE id=$1 FOR UPDATE", [key]);
    const { row, workspace } = await scope(req.user.id, "table", key, c);
    if (body.lifecycle)
      await synchronizeReferenceColumnState(
        c,
        req.user.id,
        row,
        row.columns.find((f: any) => f.id === fieldId) ?? {},
        body.lifecycle,
      );
    requireThat(
      row.object_version === body.version,
      409,
      "表结构已变化，请刷新后重试",
    );
    const field = row.columns.find((f: any) => f.id === fieldId);
    requireThat(field, 404, "字段不存在");
    requireThat(
      (field.lifecycle || "active") === "active" ||
        (body.name === undefined &&
          body.unit === undefined &&
          body.definition === undefined),
      409,
      "字段非活动状态，请先激活再修改",
    );
    if (body.lifecycle === "deleted") {
      requireThat(
        row.columns.filter((f: any) => f.lifecycle !== "deleted").length > 1,
        409,
        "必须保留至少一个字段",
      );
      if (!isReference(field))
        requireThat(
          !(
            await c.query(
              "SELECT 1 FROM records WHERE table_id=$1 AND data->$2 IS NOT NULL AND data->$2<>'null'::jsonb LIMIT 1",
              [key, fieldId],
            )
          ).rowCount,
          409,
          "字段已有数据，不能删除；可冻结或停用并保留数据",
        );
    }
    const { version, definition, preserve_existing, ...changes } = body;
    let replacement = { ...field, ...changes };
    if (definition) {
      requireThat(!body.lifecycle, 400, "类型修改与生命周期操作请分开执行");
      requireThat(definition.id === fieldId, 400, "字段标识不可更改");
      requireThat(
        !isReference(field) && !isReference(definition),
        400,
        "引用结构请通过引用管理维护",
      );
      replacement = { ...definition, lifecycle: field.lifecycle || "active", ...(field.existing_records_before?{existing_records_before:field.existing_records_before}:{}) };
      if(definition.type==='formula'&&field.type!=='formula'&&preserve_existing)
        replacement.existing_records_before=(await c.query("SELECT clock_timestamp() AS cutoff")).rows[0].cutoff.toISOString();
      const nextColumns = row.columns.map((f: any) =>
        f.id === fieldId ? replacement : f,
      );
      try {
        assertNoFormulaCycles(
          Object.fromEntries(
            nextColumns
              .filter(
                (f: any) => f.type === "formula" && f.lifecycle !== "deleted",
              )
              .map((f: any) => [f.id, f.formula]),
          ),
          {
            fields: nextColumns
              .filter((f: any) => f.lifecycle !== "deleted")
              .map((f: any) => f.id),
          },
        );
      } catch (error) {
        requireThat(false, 400, (error as Error).message);
      }
      const core = (
        await c.query("SELECT 1 FROM plan_data_tables WHERE table_id=$1", [key])
      ).rowCount;
      requireThat(
        !core ||
          !["code", "name", "duration", "progress"].includes(fieldId) ||
          (definition.type === field.type &&
            definition.required === field.required),
        409,
        "计划核心列的类型和必填规则不能改变",
      );
      const hierarchy = (
        await c.query("SELECT kind FROM planning_tables WHERE table_id=$1", [key])
      ).rows[0];
      if(hierarchy?.kind==='wbs'&&fieldId==='code')replacement.auto_code=true;
      if(field.plan_date){
        requireThat(definition.type==='date',400,'作业排程日期字段必须保持日期类型');
        replacement.plan_date=field.plan_date;
      }
      requireThat(
        !hierarchy ||
          !["code", "name", "parent"].includes(fieldId) ||
          (definition.type === field.type &&
            definition.required === field.required),
        409,
        "WBS或组织架构核心列的类型和必填规则不能改变",
      );
      const records = (
        await c.query(
          "SELECT id,data,status,created_at FROM records WHERE table_id=$1 ORDER BY id FOR UPDATE",
          [key],
        )
      ).rows;
      for (const record of records) {
        if(replacement.type==='formula'&&fieldExemptsExisting(replacement,record.created_at))continue;
        if(replacement.type==='formula'&&record.data[fieldId]!=null&&record.data[fieldId]!=='')
          requireThat(false,409,'该列已有录入值。请勾选“已有记录不影响”保留原值，再保存公式。');
        let value;
        try {
          value = changeFieldValue(field, fieldExemptsExisting(replacement,record.created_at)?{...replacement,required:false}:replacement, record.data[fieldId]);
        } catch (error) {
          requireThat(
            false,
            409,
            `记录 ${record.id}：${(error as Error).message}`,
          );
        }
        if (JSON.stringify(value) !== JSON.stringify(record.data[fieldId])) {
          // Null padding does not need to rewrite records or their approval history.
          if (record.data[fieldId] === undefined && value === null) continue;
          requireThat(
            ["draft", "rejected"].includes(record.status),
            409,
            `记录 ${record.id} 已进入审批或已审核，不能转换其存储值`,
          );
          const data = { ...record.data };
          if (value === undefined) delete data[fieldId];
          else data[fieldId] = value;
          await c.query(
            "UPDATE records SET data=$1,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3",
            [JSON.stringify(data), req.user.id, record.id],
          );
        }
      }
    }
    await c.query(
      "UPDATE data_tables SET columns=$1,object_version=object_version+1 WHERE id=$2",
      [
        JSON.stringify(
          row.columns.map((f: any) => (f.id === fieldId ? replacement : f)),
        ),
        key,
      ],
    );
    await audit(c, workspace, req.user.id, "更新字段", key, {
      field: fieldId,
      changes,
      before: field,
      after: replacement,
    });
  });
  res.json({ ok: true });
});

objects.get("/objects/projects/:project/departments", async (req, res) => {
  const { row } = await scope(
    req.user.id,
    "project",
    id.parse(req.params.project),
  );
  res.json(
    (
      await pool.query(
        "SELECT id,name FROM departments WHERE project_id=$1 ORDER BY name",
        [row.id],
      )
    ).rows,
  );
});
