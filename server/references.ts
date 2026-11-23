import {planRecordDates} from './plan-dates.ts';
import {planDateFields} from '../shared/plan-dates.ts';
import {canReadFullPlan} from './planning-read-access.ts';
import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import { pool, uid, audit } from "./db.ts";
import {
  tableAccess,
  canManage,
  canWrite, canRecordAction,
  visibleColumns,
  rowAllowed,
  recordVisibilitySql,
  projectRecord,
  requireThat,
  HttpError,
} from "./auth.ts";
import { id, validateRecord } from "./validation.ts";
import {
  isReference,
  validateValue,
  displayValue,
  type DataField,
} from "../shared/fields.ts";
type Connection = pg.Pool | pg.PoolClient;
export const references = Router();
export async function synchronizeReferenceColumnState(
  c: pg.PoolClient,
  user: string,
  table: any,
  field: any,
  state: string,
) {
  if (!isReference(field)) return;
  const sourceTable = field.type === "backlink" ? field.target_table : table.id;
  const sourceField = field.type === "backlink" ? field.source_field : field.id;
  if (state === "deleted")
    requireThat(
      !(
        await c.query(
          "SELECT 1 FROM record_references rr JOIN records r ON r.id=rr.source_id WHERE r.table_id=$1 AND rr.field_id=$2 LIMIT 1",
          [sourceTable, sourceField],
        )
      ).rowCount,
      409,
      "仍存在引用关系，不能删除关联列",
    );
  const opposite =
    field.type === "backlink" ? field.source_field : field.inverse_id;
  if (!opposite) return;
  const { table: target, permission } = await tableAccess(
    user,
    field.target_table,
    c,
  );
  requireThat(canManage(permission));
  const counterpart = (
    await c.query("SELECT columns FROM data_tables WHERE id=$1 FOR UPDATE", [
      target.id,
    ])
  ).rows[0].columns;
  requireThat(
    counterpart.some((f: any) => f.id === opposite),
    409,
    "配对引用列不存在",
  );
  if (state === "deleted")
    requireThat(
      counterpart.filter((f: any) => f.lifecycle !== "deleted").length > 1,
      409,
      "配对数据表必须保留至少一个字段",
    );
  if (target.id === table.id)
    table.columns = table.columns.map((f: any) =>
      f.id === opposite ? { ...f, lifecycle: state } : f,
    );
  else
    await c.query("UPDATE data_tables SET columns=$1 WHERE id=$2", [
      JSON.stringify(
        counterpart.map((f: any) =>
          f.id === opposite ? { ...f, lifecycle: state } : f,
        ),
      ),
      target.id,
    ]);
  await audit(c, permission.workspace_id, user, "同步引用列状态", target.id, {
    field: opposite,
    lifecycle: state,
  });
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

// A project-local lock serializes forward/reverse edits before acquiring row locks.
export async function lockReferenceProject(c: pg.PoolClient, project: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,703))", [
    project,
  ]);
}
export async function prepareReferenceColumns(
  c: pg.PoolClient,
  user: string,
  source: any,
  columns: any[],
) {
  for (const f of columns.filter((f) => f.type === "reference")) {
    const { table: target, permission } = await tableAccess(
      user,
      f.target_table,
      c,
    );
    requireThat(
      target.project_id === source.project_id,
      400,
      "引用表必须属于同一项目",
    );
    requireThat(target.lifecycle === "active", 409, "关联表需先激活");
    if (f.display_column)
      requireThat(
        visibleColumns(permission, target).some(
          (x: any) => x.id === f.display_column && !isReference(x),
        ),
        400,
        "显示字段不存在、不可见或本身是引用",
      );
    if (!f.bidirectional) continue;
    requireThat(canManage(permission));
    const locked = (
      await c.query("SELECT * FROM data_tables WHERE id=$1 FOR UPDATE", [
        target.id,
      ])
    ).rows[0];
    requireThat(
      locked.columns.length + (target.id === source.id ? 1 : 0) < 50,
      400,
      "目标表已达到50列上限",
    );
    const inverseId = "ref_" + uid().replaceAll("-", "").slice(0, 24);
    f.inverse_id = inverseId;
    const mirror = {
      id: inverseId,
      name: f.inverse_name || `${source.name} · ${f.name}`,
      type: "backlink",
      required: false,
      target_table: source.id,
      source_field: f.id,
      display_column: source.columns.find(
        (x: any) => !isReference(x) && x.lifecycle !== "deleted",
      )?.id,
    };
    requireThat(mirror.name.length <= 120, 400, "请缩短反向字段名称");
    await c.query(
      "UPDATE data_tables SET columns=columns || $1::jsonb WHERE id=$2",
      [JSON.stringify([mirror]), target.id],
    );
    await audit(
      c,
      permission.workspace_id,
      user,
      "创建双向引用反向列",
      target.id,
      { field: inverseId, source_table: source.id, source_field: f.id },
    );
  }
  return columns;
}

export async function validateForwardReferences(
  c: Connection,
  user: string,
  table: any,
  data: any,
  previous: any = {},
) {
  for (const f of table.columns.filter((x: any) => x.type === "reference")) {
    const next: string[] = data[f.id] ?? [],
      prior: string[] = previous[f.id] ?? [];
    if (same(next, prior)) continue;
    const added = next.filter((v) => !prior.includes(v));
    if (!added.length) continue;
    const { table: target, permission } = await tableAccess(
      user,
      f.target_table,
      c,
    );
    requireThat(
      target.project_id === table.project_id,
      400,
      "引用表不属于当前项目",
    );
    requireThat(
      target.lifecycle === "active" &&
        permission.lifecycle === "active" &&
        permission.workspace_lifecycle === "active",
      409,
      "关联目标非活动状态",
    );
    const rows = (
      await c.query(
        "SELECT * FROM records WHERE id=ANY($1::uuid[]) AND table_id=$2",
        [added, target.id],
      )
    ).rows;
    requireThat(
      rows.length === added.length &&
        rows.every(
          (r) => r.lifecycle === "active" && rowAllowed(permission, r, user),
        ),
      403,
      "关联记录不存在、非活动或无权访问",
    );
  }
}

async function referenceScope(
  user: string,
  table: any,
  field: any,
  c: Connection,
) {
  const scope = await tableAccess(user, field.target_table, c);
  requireThat(
    scope.table.project_id === table.project_id,
    403,
    "引用项目不匹配",
  );
  if (field.type === "backlink")
    requireThat(
      visibleColumns(scope.permission, scope.table).some(
        (f: any) =>
          f.id === field.source_field &&
          f.type === "reference" &&
          f.inverse_id === field.id &&
          f.lifecycle !== "deleted",
      ),
      403,
      "原始引用字段不可见",
    );
  return scope;
}

export async function projectReferenceRows(
  user: string,
  table: any,
  permission: any,
  rows: any[],
  c: Connection = pool,
) {
  const projected = rows.map((r) => ({
    ...projectRecord(permission, table, r),
    references: {} as Record<string, any>,
  }));
  for (const f of visibleColumns(permission, table).filter(isReference)) {
    let lists = new Map<string, string[]>();
    if (f.type === "reference")
      for (const r of rows) lists.set(r.id, r.data[f.id] ?? []);
    else {
      const incoming = (
        await c.query(
          "SELECT rr.target_id,rr.source_id FROM record_references rr JOIN records r ON r.id=rr.source_id WHERE rr.target_id=ANY($1::uuid[]) AND rr.field_id=$2 AND r.table_id=$3 AND r.lifecycle<>'deleted' ORDER BY rr.source_id",
          [rows.map((r) => r.id), f.source_field, f.target_table],
        )
      ).rows;
      for (const edge of incoming)
        lists.set(edge.target_id, [
          ...(lists.get(edge.target_id) ?? []),
          edge.source_id,
        ]);
    }
    try {
      const { table: target, permission: targetPermission } =
        await referenceScope(user, table, f, c);
      const ids = [...new Set([...lists.values()].flat())];
      const linked = (
        await c.query(
          "SELECT * FROM records WHERE id=ANY($1::uuid[]) AND table_id=$2 AND lifecycle<>'deleted'",
          [ids, target.id],
        )
      ).rows.filter((r) => rowAllowed(targetPermission, r, user));
      const byId = new Map(linked.map((r) => [r.id, r]));
      const labelField = visibleColumns(targetPermission, target).find(
        (x: any) => x.id === f.display_column && !isReference(x),
      );
      for (const row of projected) {
        const original = lists.get(row.id) ?? [];
        const items = original
          .filter((id) => byId.has(id))
          .map((id) => {
            const r = byId.get(id)!;
            const safe = projectRecord(targetPermission, target, r);
            return {
              id,
              label: labelField
                ? displayValue(safe.data[labelField.id]).slice(0, 160) || id
                : id,
              status: r.status,
              lifecycle: r.lifecycle,
            };
          });
        row.data[f.id] = items.map((i) => i.id);
        row.references[f.id] = {
          items,
          restricted: items.length !== original.length,
        };
      }
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        ![403, 404, 409].includes(error.status)
      )
        throw error;
      for (const row of projected) {
        row.data[f.id] = [];
        row.references[f.id] = { items: [], restricted: true };
      }
    }
  }
  if(visibleColumns(permission,table).some((f:any)=>f.id==='activity_wbs'&&f.derived_reference)){
    const activity=table.columns.find((f:any)=>f.id==='activity'&&f.type==='reference');
    if(activity)try{
      const plan=await referenceScope(user,table,activity,c);
      const wbsField=visibleColumns(plan.permission,plan.table).find((f:any)=>f.id==='wbs'&&f.type==='reference');
      if(wbsField){
        const wbs=await referenceScope(user,plan.table,wbsField,c);
        const nameVisible=visibleColumns(wbs.permission,wbs.table).some((f:any)=>f.id==='name');
        if(nameVisible){
          const ids=[...new Set(projected.flatMap(r=>r.references.activity?.items.map((v:any)=>v.id)||[]))];
          const tasks=(await c.query("SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[]) AND lifecycle<>'deleted'",[plan.table.id,ids])).rows.filter(r=>rowAllowed(plan.permission,r,user));
          const parents=[...new Set(tasks.flatMap(r=>r.data.wbs||[]))];
          const nodes=(await c.query("SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[]) AND lifecycle<>'deleted'",[wbs.table.id,parents])).rows.filter(r=>rowAllowed(wbs.permission,r,user));
          const labels=new Map(nodes.map(r=>[r.id,projectRecord(wbs.permission,wbs.table,r).data.name]));
          const taskParents=new Map(tasks.map(r=>[r.id,r.data.wbs?.[0]]));
          for(const row of projected)row.data.activity_wbs=(row.references.activity?.items||[]).map((v:any)=>labels.get(taskParents.get(v.id))).filter(Boolean).join('；')||null;
        }
      }
    }catch(e){if(!(e instanceof HttpError)||![403,404,409].includes(e.status))throw e;}
  }
  const planFields=planDateFields(visibleColumns(permission,table));
  if((planFields.start||planFields.finish||table.columns.some((f:any)=>f.id==='loe_scope'))&&(await c.query('SELECT 1 FROM plan_data_tables WHERE table_id=$1',[table.id])).rowCount){
    const allowed=await canReadFullPlan(permission,c);
    const dates=allowed?await planRecordDates(table.project_id,c,permission,user):null;
    const raw=new Map(rows.map(r=>[r.id,r]));
    for(const row of projected){
      const calculated=dates?.get(row.id);
      if(raw.get(row.id)?.data.activity_type==='LOE持续性作业'){
       row.plan_readonly_fields=['duration','remaining_duration',...(planFields.start?[planFields.start.id]:[])];
       row.data.duration=calculated?.duration??null;row.data.remaining_duration=calculated?.remaining_duration??null;
      }
      if(planFields.start){
        row.plan_date_inputs={[planFields.start.id]:raw.get(row.id)?.data[planFields.start.id]??null};
        row.data[planFields.start.id]=calculated?.start??row.data[planFields.start.id]??null;
      }
      if(planFields.finish)row.data[planFields.finish.id]=calculated?.finish??null;
    }
  }
  return projected;
}

export async function applyBacklinks(
  c: pg.PoolClient,
  user: string,
  table: any,
  record: string,
  input: any,
  expected: any = {},
  creating = false,
) {
  for (const f of table.columns.filter(
    (x: any) => x.type === "backlink" && Object.hasOwn(input, x.id),
  )) {
    const wanted = (validateValue(f, input[f.id]) ?? []) as string[];
    const current = (
      await c.query(
        "SELECT rr.source_id FROM record_references rr JOIN records r ON r.id=rr.source_id WHERE rr.target_id=$1 AND rr.field_id=$2 AND r.table_id=$3 AND r.lifecycle<>'deleted' ORDER BY rr.source_id",
        [record, f.source_field, f.target_table],
      )
    ).rows.map((r) => r.source_id);
    if (same(current, wanted)) continue;
    requireThat(
      creating ||
        (Array.isArray(expected[f.id]) &&
          same([...expected[f.id]].sort(), current)),
      409,
      "反向关联已变化或缺少原值，请刷新后重试",
    );
    requireThat(
      !f.lifecycle || f.lifecycle === "active",
      409,
      "反向字段非活动状态",
    );
    const { table: source, permission } = await referenceScope(
      user,
      table,
      f,
      c,
    );
    requireThat(canRecordAction(permission,source,"update"));
    const changed = [...new Set([...current, ...wanted])]
      .filter((key) => current.includes(key) !== wanted.includes(key))
      .sort();
    for (const key of changed) {
      const row = (
        await c.query(
          "SELECT * FROM records WHERE id=$1 AND table_id=$2 FOR UPDATE",
          [key, source.id],
        )
      ).rows[0];
      requireThat(
        row && rowAllowed(permission, row, user),
        403,
        "关联记录不存在或无权修改",
      );
      requireThat(
        ["draft", "rejected"].includes(row.status) &&
          row.lifecycle === "active",
        409,
        "关联源记录已锁定，请先撤回或通过变更草稿修改",
      );
      const prior: string[] = row.data[f.source_field] ?? [];
      const values = wanted.includes(key)
        ? [...new Set([...prior, record])].sort()
        : prior.filter((v) => v !== record);
      const value = validateRecord(source.columns, {
        ...row.data,
        [f.source_field]: values,
      },row.created_at);
      await validateForwardReferences(c, user, source, value, row.data);
      await c.query(
        "UPDATE records SET data=$1,version=version+1,status='draft' WHERE id=$2",
        [JSON.stringify(value), key],
      );
      await audit(c, permission.workspace_id, user, "从反向列修改引用", key, {
        field: f.source_field,
        target: record,
        linked: wanted.includes(key),
      });
    }
  }
}

export async function validateNewBacklinks(
  c: Connection,
  user: string,
  table: any,
  input: any,
) {
  for (const f of table.columns.filter(
    (f: any) => f.type === "backlink" && Object.hasOwn(input, f.id),
  )) {
    const ids = (validateValue(f, input[f.id]) ?? []) as string[];
    if (!ids.length) continue;
    const { table: source, permission } = await referenceScope(
      user,
      table,
      f,
      c,
    );
    requireThat(canRecordAction(permission,source,"update"), 403, "没有修改原始引用记录的权限");
    const original = source.columns.find((x: any) => x.id === f.source_field);
    requireThat(
      source.lifecycle === "active" &&
        (!original.lifecycle || original.lifecycle === "active"),
      409,
      "原始引用表或字段非活动状态",
    );
    const rows = (
      await c.query(
        "SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[])",
        [source.id, ids],
      )
    ).rows;
    requireThat(
      rows.length === ids.length &&
        rows.every((r) => rowAllowed(permission, r, user)),
      403,
      "原始引用记录不存在或无权访问",
    );
    requireThat(
      rows.every(
        (r) =>
          r.lifecycle === "active" && ["draft", "rejected"].includes(r.status),
      ),
      409,
      "原始引用记录已锁定",
    );
    requireThat(
      rows.every((r) => (r.data[f.source_field] ?? []).length < 100),
      400,
      "原始引用单元格已达到100条上限",
    );
  }
}

references.get("/tables/:table/reference-options/:field", async (req, res) => {
  const { table, permission } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  const field = visibleColumns(permission, table).find(
    (f: any) => f.id === req.params.field && isReference(f),
  );
  requireThat(field, 404, "引用字段不存在或无权访问");
  const { table: target, permission: a } = await referenceScope(
    req.user.id,
    table,
    field,
    pool,
  );
  const search = z.string().trim().max(100).default("").parse(req.query.search),
    page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .default(1)
      .parse(req.query.page);
  const labelColumns=visibleColumns(a,target).filter((f:any)=>!isReference(f));
  const requestedColumn=z.string().max(100).optional().parse(req.query.display_column);
  if(requestedColumn)requireThat(labelColumns.some((f:any)=>f.id===requestedColumn),403,'无权使用所选关联列');
  const labelField=labelColumns.find((f:any)=>f.id===(requestedColumn||field.display_column))||labelColumns.find((f:any)=>['name','title','code'].includes(f.id))||labelColumns.find((f:any)=>f.type==='text');
  const canonicalField=labelColumns.find((f:any)=>f.id===field.display_column)||labelColumns.find((f:any)=>['name','title','code'].includes(f.id))||labelColumns.find((f:any)=>f.type==='text');
  const params: any[] = [
    target.id,
    req.user.id,
    canManage(a) || a.row_scope !== "own",
    search,
    labelField?.id ?? "",
  ];
  const loeScope=field.id==='loe_scope'&&target.id===table.id&&(await pool.query('SELECT 1 FROM plan_data_tables WHERE table_id=$1',[table.id])).rowCount;
  const where =
    "FROM records r WHERE "+recordVisibilitySql(a,'$2')+(loeScope?" AND coalesce(r.data->>'activity_type','任务')<>'LOE持续性作业' AND r.status<>'obsolete'":"")+" AND table_id=$1 AND lifecycle='active' AND ($3 OR created_by=$2) AND ($5::text IS NOT NULL) AND ($4='' OR strpos(lower(id::text),lower($4))>0 OR EXISTS (SELECT 1 FROM jsonb_each_text(record_field_values(r,$6::jsonb)) AS sv(key,value) WHERE sv.key=ANY($7::text[]) AND strpos(lower(coalesce(sv.value,'')),lower($4))>0))";
  params.push(JSON.stringify(target.columns),labelColumns.map((f:any)=>f.id));
  const [result, count] = await Promise.all([
    pool.query(
      `SELECT r.* ${where} ORDER BY created_at DESC,id LIMIT 30 OFFSET ${(page - 1) * 30}`,
      params,
    ),
    pool.query(`SELECT count(*)::int AS total ${where}`, params),
  ]);
  res.json({
    table:{id:target.id,name:target.name},
    columns:labelColumns.map((f:any)=>({id:f.id,name:f.name})),
    display_column:labelField?.id,
    items: result.rows.map((r) => ({
      id:r.id,
      label:canonicalField?displayValue(projectRecord(a,target,r).data[canonicalField.id]).slice(0,160)||"未命名记录":"未命名记录",
      display_label:labelField?displayValue(projectRecord(a,target,r).data[labelField.id]).slice(0,160)||"未填写":"未填写",
      status: r.status,
    })),
    total: count.rows[0].total,
    page,
  });
});

export async function findReferenceMatches(
  user: string,
  table: any,
  permission: any,
  search: string,
) {
  const ids = new Set<string>();
  for (const f of visibleColumns(permission, table).filter(isReference)) {
    try {
      const { table: target, permission: a } = await referenceScope(
        user,
        table,
        f,
        pool,
      );
      const label = visibleColumns(a, target).find(
        (x: any) => x.id === f.display_column && !isReference(x),
      );
      const reverse = f.type === "backlink";
      const result = await pool.query(
        `SELECT DISTINCT rr.${reverse ? "target_id" : "source_id"} AS id FROM record_references rr JOIN records linked ON linked.id=rr.${reverse ? "source_id" : "target_id"} JOIN records owner ON owner.id=rr.${reverse ? "target_id" : "source_id"} WHERE owner.table_id=$1 AND rr.field_id=$2 AND linked.table_id=$3 AND linked.lifecycle<>'deleted' AND ${recordVisibilitySql(a,'$4','linked')} AND ($5 OR linked.created_by=$4) AND (strpos(lower(linked.id::text),lower($6))>0 OR ($7<>'' AND strpos(lower(coalesce(record_field_values(linked,$8::jsonb)->>$7,'')),lower($6))>0))`,
        [
          table.id,
          reverse ? f.source_field : f.id,
          target.id,
          user,
          canManage(a) || a.row_scope !== "own",
          search,
          label?.id ?? "",
          JSON.stringify(target.columns),
        ],
      );
      for (const r of result.rows) ids.add(r.id);
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        ![403, 404, 409].includes(error.status)
      )
        throw error;
    }
  }
  return [...ids];
}
