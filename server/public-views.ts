import { Router } from "express";
import { z } from "zod";
import { requestTransaction, pool, audit } from "./db.ts";
import {
  access,
  canManage,
  tableAccess,
  visibleColumns,
  projectRecord,
  rowAllowed,
  requireThat,
} from "./auth.ts";
import { numericTypes, decimalParts } from "../shared/fields.ts";
import { aggregateReportValues } from "../shared/report-aggregate.ts";
const uuid = z.string().uuid();
const ref = z.object({
  source: z.number().int().min(0).max(2),
  field: z.string().min(1).max(50),
});
export const viewDefinition = z.object({
  allow_duplicate_aggregation:z.boolean().default(false),
  sources: z.array(uuid).min(1).max(3),
  joins: z
    .array(z.object({ left: ref, right: ref, kind: z.enum(["inner", "left"]) }))
    .max(2)
    .default([]),
  filters: z
    .array(
      z.object({
        field: ref,
        operator: z.enum([
          "equals",
          "notEquals",
          "contains",
          "gt",
          "gte",
          "lt",
          "lte",
          "empty",
          "notEmpty",
        ]),
        value: z.string().max(200).default(""),
      }),
    )
    .max(20)
    .default([]),
  columns: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/),
        name: z.string().trim().min(1).max(100),
        field: ref.optional(),
        aggregation: z
          .enum(["none", "count", "sum", "average", "min", "max"])
          .default("none"),
      }),
    )
    .min(1)
    .max(50),
  status: z.enum(["all", "approved", "pending", "draft"]).default("all"),
});
export type ViewDefinition = z.infer<typeof viewDefinition>;
export const publicViews = Router();
async function manage(user: string, project: string) {
  const a = await access(user, project);
  requireThat(canManage(a));
  requireThat(
    (
      await pool.query(
        "SELECT 1 FROM users WHERE id=$1 AND (username='admin' OR system_admin) AND active",
        [user],
      )
    ).rowCount,
    403,
    "只有admin和superadmin可以设计public视图",
  );
  return a;
}
export async function prepareView(
  user: string,
  project: string,
  input: unknown,
  published = false,
) {
  const definition = viewDefinition.parse(input);
  requireThat(
    new Set(definition.sources).size === definition.sources.length,
    400,
    "同一源表只能选择一次",
  );
  requireThat(
    new Set(definition.columns.map((c) => c.id)).size ===
      definition.columns.length,
    400,
    "输出列标识不能重复",
  );
  const sources = await Promise.all(
    definition.sources.map(async (id) => {
      const s = published
        ? { table: (await pool.query("SELECT * FROM data_tables WHERE id=$1 AND project_id=$2", [id, project])).rows[0],
            permission: { role: "owner", row_scope: "all", hidden_columns: [] } }
        : await tableAccess(user, id);
      requireThat(s.table, 400, "源表不存在或不属于当前项目");
      requireThat(s.table.project_id === project, 400, "源表必须属于当前项目");
      requireThat(s.table.lifecycle === "active", 400, "源表已停用");
      return s;
    }),
  );
  const field = (r: z.infer<typeof ref>) => {
    const source = sources[r.source];
    requireThat(source, 400, "源表序号无效");
    const f = visibleColumns(source.permission, source.table).find(
      (f: any) => f.id === r.field,
    );
    requireThat(f, 403, "视图使用的列已移除或没有读取权限");
    return f;
  };
  requireThat(
    definition.joins.length === sources.length - 1,
    400,
    "每个新增源表必须配置关联条件",
  );
  definition.joins.forEach((j, i) => {
    requireThat(
      j.right.source === i + 1 && j.left.source <= i,
      400,
      "请按源表顺序配置关联",
    );
    const l = field(j.left),
      r = field(j.right);
    requireThat(
      l.type === r.type ||
        (numericTypes.includes(l.type) && numericTypes.includes(r.type)),
      400,
      "关联列类型不兼容",
    );
  });
  definition.filters.forEach((f) => {
    const c = field(f.field);
    if (["gt", "gte", "lt", "lte"].includes(f.operator))
      requireThat(
        numericTypes.includes(c.type) ||
          c.type === "formula" ||
          ["date", "time", "timestamp", "timestamptz"].includes(c.type),
        400,
        "范围筛选仅支持数字和日期",
      );
  });
  const columns = definition.columns.map((c) => {
    const f = c.field ? field(c.field) : undefined;
    requireThat(f || c.aggregation === "count", 400, "请选择输出列的源字段");
    if (["sum", "average", "min", "max"].includes(c.aggregation))
      requireThat(
        f && (numericTypes.includes(f.type) || f.type === "formula"),
        400,
        "汇总列必须为数值字段",
      );
    return {
      id: c.id,
      name: c.name,
      type:
        c.aggregation === "none"
          ? f.type
          : c.aggregation === "count"
            ? "int64"
            : "decimal",
      required: false,
    };
  });
  return { definition, sources, columns };
}
function compare(a: unknown, b: unknown, numeric: boolean) {
  if (numeric) {
    const l = decimalParts(String(a)),
      r = decimalParts(String(b)),
      scale = Math.max(l.scale, r.scale),
      x = l.coefficient * 10n ** BigInt(scale - l.scale),
      y = r.coefficient * 10n ** BigInt(scale - r.scale);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return String(a).localeCompare(String(b));
}
export function compareViewValues(a: unknown, b: unknown, type: string) {
  return compare(a, b, numericTypes.includes(type) || type === "formula");
}
function joinKey(v: unknown, numeric: boolean) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (numeric && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    const p = decimalParts(s);
    let n = p.coefficient,
      k = p.scale;
    while (k > 0 && n % 10n === 0n) {
      n /= 10n;
      k--;
    }
    return `n:${n}:${k}`;
  }
  return `s:${s}`;
}
export async function executeView(
  user: string,
  project: string,
  input: unknown,
) {
  await access(user, project);
  const p = await prepareView(user, project, input, true),
    { definition: d, sources } = p;
  // Published views expose only their explicitly selected output columns to project members.
  // Source rows are restricted to confirmed active records and a consistent snapshot.
  const shared = requestTransaction.getStore();
  const client = shared || await pool.connect();
  let records: any[][] = [];
  try {
    if(!shared)await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const s of sources) {
      const own = !canManage(s.permission) && s.permission.row_scope === "own";
      const rows = (
        await client.query(
          "SELECT * FROM records WHERE table_id=$1 AND lifecycle='active' AND status='approved'" +
            (own ? " AND created_by=$2" : "") +
            " ORDER BY created_at,id LIMIT 10001",
          own ? [s.table.id, user] : [s.table.id],
        )
      ).rows;
      requireThat(
        rows.length <= 10000,
        400,
        "视图单个源表最多10000条，请筛选源记录状态或拆分源表",
      );
      records.push(
        rows
          .filter((r) => rowAllowed(s.permission, r, user))
          .map((r) => projectRecord(s.permission, s.table, r).data),
      );
    }
    if(!shared)await client.query("COMMIT");
  } catch (e) {
    if(!shared)await client.query("ROLLBACK");
    throw e;
  } finally {
    if(!shared)client.release();
  }
  let joined = records[0].map((r) => [r]);
  for (const j of d.joins) {
    const numeric = numericTypes.includes(
      sources[j.left.source].table.columns.find(
        (c: any) => c.id === j.left.field,
      ).type,
    );
    const index = new Map<string, any[]>();
    for (const r of records[j.right.source]) {
      const k = joinKey(r[j.right.field], numeric);
      if (k === null) continue;
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(r);
    }
    const next: any[][] = [];
    for (const row of joined) {
      const k = joinKey(row[j.left.source]?.[j.left.field], numeric);
      const matches = k === null ? [] : index.get(k) || [];
      for (const r of matches.length
        ? matches
        : j.kind === "left"
          ? [{}]
          : []) {
        next.push([...row, r]);
        requireThat(
          next.length <= 10000,
          400,
          "关联结果超过10000条，请调整关联条件",
        );
      }
    }
    joined = next;
  }
  joined = joined.filter((row) =>
    d.filters.every((f) => {
      const v = row[f.field.source]?.[f.field.field],
        empty = v === null || v === undefined || v === "";
      if (f.operator === "empty") return empty;
      if (f.operator === "notEmpty") return !empty;
      if (empty) return false;
      if (f.operator === "contains")
        return String(v).toLowerCase().includes(f.value.toLowerCase());
      const source = sources[f.field.source],
        c = source.table.columns.find((c: any) => c.id === f.field.field);
      let n: number;
      try {
        n = compare(
          v,
          f.value,
          numericTypes.includes(c.type) || c.type === "formula",
        );
      } catch {
        requireThat(false, 400, "数值筛选请输入有效数字");
      }
      return f.operator === "equals"
        ? n === 0
        : f.operator === "notEquals"
          ? n !== 0
          : f.operator === "gt"
            ? n > 0
            : f.operator === "gte"
              ? n >= 0
              : f.operator === "lt"
                ? n < 0
                : n <= 0;
    }),
  );
  const repeated=sources.map((_,i)=>{const objects=joined.map(row=>row[i]).filter(obj=>obj&&Object.keys(obj).length);return objects.length>new Set(objects).size;});
  const duplicated=d.columns.filter(c=>c.field&&repeated[c.field.source]&&['sum','average','count'].includes(c.aggregation));
  requireThat(!duplicated.length||d.allow_duplicate_aggregation,400,`一对多关联会重复汇总源列（${duplicated.map(c=>c.name).join('、')}）。请使用唯一关联键、预汇总明细，或明确确认按展开后的关联行汇总`);
  const value = (r: any[], c: ViewDefinition["columns"][number]) =>
    c.field ? (r[c.field.source]?.[c.field.field] ?? null) : 1;
  const aggregated = d.columns.some((c) => c.aggregation !== "none");
  let output: Record<string, unknown>[];
  if (!aggregated)
    output = joined.map((r) =>
      Object.fromEntries(d.columns.map((c) => [c.id, value(r, c)])),
    );
  else {
    const dimensions = d.columns.filter((c) => c.aggregation === "none"),
      groups = new Map<string, any[][]>();
    for (const r of joined) {
      const key = JSON.stringify(dimensions.map((c) => value(r, c)));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    if (!dimensions.length && !joined.length) groups.set("[]", []);
    output = [...groups.values()].map((rows) =>
      Object.fromEntries(
        d.columns.map((c) => [
          c.id,
          c.aggregation === "none"
            ? value(rows[0], c)
            : c.aggregation === "count"
              ? String(
                  c.field
                    ? rows.filter((r) => value(r, c) !== null).length
                    : rows.length,
                )
              : aggregateReportValues(
                  rows.map((r) => value(r, c)),
                  c.aggregation,
                ),
        ]),
      ),
    );
  }
  return {
    ...p,
    rows: output.map((data, i) => ({
      id: `view-row-${i}`,
      data,
      status: "approved",
      version: 1,
      lifecycle: "active",
      created_at: new Date().toISOString(),
      creator: "实时视图",
    })),
    matched: joined.length,
  };
}
export async function getPublicView(user: string, id: string) {
  const v = (
    await pool.query(
      "SELECT * FROM project_public_views WHERE id=$1 AND deleted_at IS NULL",
      [id],
    )
  ).rows[0];
  if (!v) return null;
  await access(user, v.project_id);
  const p = await prepareView(user, v.project_id, v.definition, true);
  return {
    ...v,
    source_revisions: p.sources.map(s=>[s.table.id,s.table.object_version]),
    columns: p.columns,
    is_view: true,
    is_mapping: true,
    lifecycle: "active",
    object_version: v.version,
  };
}
export async function publicViewCatalog(user: string, project: string) {
  await access(user, project);
  const rows = (
    await pool.query(
      "SELECT id FROM project_public_views WHERE project_id=$1 AND deleted_at IS NULL ORDER BY name",
      [project],
    )
  ).rows;
  const result = [];
  for (const r of rows) {
    try {
      result.push(await getPublicView(user, r.id));
    } catch (e) {
      if (
        (e as any).status !== 403 &&
        (e as any).status !== 404 &&
        (e as any).status !== 400
      )
        throw e;
    }
  }
  return result;
}
publicViews.post(
  "/projects/:project/public/views/preview",
  async (req, res) => {
    const project = uuid.parse(req.params.project);
    await manage(req.user.id, project);
    const p = await executeView(req.user.id, project, req.body.definition);
    res.json({
      columns: p.columns,
      rows: p.rows.slice(0, 50),
      total: p.rows.length,
      matched: p.matched,
    });
  },
);
publicViews.post("/projects/:project/public/views", async (req, res) => {
  const project = uuid.parse(req.params.project),
    a = await manage(req.user.id, project),
    b = z
      .object({
        name: z.string().trim().min(1).max(120),
        definition: viewDefinition,
      })
      .parse(req.body);
  await executeView(req.user.id, project, b.definition);
  const r = (
    await pool.query(
      "INSERT INTO project_public_views(project_id,name,definition,created_by) VALUES($1,$2,$3,$4) RETURNING *",
      [project, b.name, JSON.stringify(b.definition), req.user.id],
    )
  ).rows[0];
  await audit(pool, a.workspace_id, req.user.id, "创建public视图", r.id, {
    name: b.name,
  });
  res.status(201).json(r);
});
publicViews.put("/public/views/:id", async (req, res) => {
  const v = await getPublicView(req.user.id, uuid.parse(req.params.id));
  requireThat(v, 404, "视图不存在");
  const a = await manage(req.user.id, v.project_id),
    b = z
      .object({
        name: z.string().trim().min(1).max(120),
        definition: viewDefinition,
        version: z.number().int().positive(),
      })
      .parse(req.body);
  await executeView(req.user.id, v.project_id, b.definition);
  const r = (
    await pool.query(
      "UPDATE project_public_views SET name=$1,definition=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 AND deleted_at IS NULL RETURNING *",
      [b.name, JSON.stringify(b.definition), v.id, b.version],
    )
  ).rows[0];
  requireThat(r, 409, "视图已修改，请刷新后重试");
  await audit(pool, a.workspace_id, req.user.id, "修改public视图", v.id);
  res.json(r);
});
publicViews.delete("/public/views/:id", async (req, res) => {
  const v = await getPublicView(req.user.id, uuid.parse(req.params.id));
  requireThat(v, 404, "视图不存在");
  const a = await manage(req.user.id, v.project_id);
  await pool.query(
    "UPDATE project_public_views SET deleted_at=now(),version=version+1 WHERE id=$1",
    [v.id],
  );
  await audit(pool, a.workspace_id, req.user.id, "删除public视图", v.id);
  res.json({ ok: true });
});
