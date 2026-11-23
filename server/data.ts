import {planFilterColumns,planFilterValues} from '../shared/plan-filter-values.ts';
import {parseColumnFilters,matchesColumnFilters,statusFilterColumn} from '../shared/column-filters.ts';
import {LOE} from '../shared/loe.ts';
import {writeAgendaRecord} from "./agenda-table.ts";
import {reviewMode,editableRecord} from '../shared/record-policy.ts';
import {BATCH_CREATE_LIMIT,BATCH_UPDATE_LIMIT,BATCH_DELETE_LIMIT} from '../shared/batch-limits.ts';
import {orderWbs} from '../shared/wbs-hierarchy.ts';
import { validatePlanValues, validatePlanSchedule,readPlanRelations } from "./plan-table.ts";
import {
  orderedTableRows,
  tableStatistics,
} from "../shared/table-statistics.ts";
import {
  getPublicView,
  executeView,
  compareViewValues,
} from "./public-views.ts";
import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import ExcelJS from "exceljs";
import { pool, uid, tx, audit, requestTransaction } from "./db.ts";
import {
  access,
  canManage,
  canWrite,
  canConfirmRecord,
  recordVisibilitySql,
  canRecordAction,
  tableAllowed,
  tableAccess,
  visibleColumns,
  projectRecord,
  rowAllowed,
  requireThat,
  HttpError,
} from "./auth.ts";
import { id, name, fields, validateRecord } from "./validation.ts";
import { assertNoFormulaCycles } from "../shared/formulas.ts";
import {
  numericTypes,
  exactSum,
  displayValue,
  isReference,
} from "../shared/fields.ts";
import {
  prepareReferenceColumns,
  validateForwardReferences,
  applyBacklinks,
  projectReferenceRows,
  lockReferenceProject,
  findReferenceMatches,
} from "./references.ts";
function normalizeLoeValues(table:any,data:any){if(data.activity_type!==LOE||!table.columns.some((f:any)=>f.id==='loe_scope'&&f.target_table===table.id))return data;const out={...data,duration:0,remaining_duration:null,...(data.percent_complete_type==='工期'?{percent_complete_type:'实物'}:{})};for(const f of table.columns)if(f.plan_date==='start')out[f.id]=null;return out;}
async function normalizeLoeInput(table:any,data:any,existing?:any){if(existing?.data.activity_type===LOE&&data.activity_type===LOE){requireThat(!data.duration||Number(data.duration)===0,400,'LOE工期自动计算，请勿在写入数据中填写工期');requireThat(data.remaining_duration==null||Number(data.remaining_duration)===0,400,'LOE剩余工期自动计算，请勿手工填写');}return normalizeLoeValues(table,data);}
export const data = Router();
data.put('/tables/:table/review-policy',async(req,res)=>{
 const body=z.object({review_mode:z.enum(['supervisor','approval'])}).strict().parse(req.body);
 await tx(async c=>{const {table,permission}=await tableAccess(req.user.id,id.parse(req.params.table),c);requireThat(canManage(permission));requireThat(table.lifecycle==='active'&&permission.lifecycle==='active'&&permission.workspace_lifecycle==='active',409,'仅活动项目和数据表可修改');requireThat(!(await c.query("SELECT 1 FROM records WHERE table_id=$1 AND status='pending' LIMIT 1",[table.id])).rowCount,409,'该表有在途审批，请先完成或撤回后再修改确认方式');await c.query('UPDATE data_tables SET review_mode=$2 WHERE id=$1',[table.id,body.review_mode]);await audit(c,permission.workspace_id,req.user.id,'修改数据确认方式',table.id,{before:table.review_mode,after:body.review_mode});});res.json({ok:true});
});
data.post('/tables/:table/confirm-status',async(req,res)=>{
 const body=z.object({status:z.enum(['draft','approved','obsolete']),records:z.array(z.object({id,version:z.number().int().positive()})).min(1).max(500)}).strict().parse(req.body);
 requireThat(new Set(body.records.map(r=>r.id)).size===body.records.length,400,'记录不能重复');
 await tx(async c=>{
  const initial=await tableAccess(req.user.id,id.parse(req.params.table),c);await lockReferenceProject(c,initial.table.project_id);
  const {table,permission}=await tableAccess(req.user.id,initial.table.id,c);
  requireThat(reviewMode(table)==='supervisor',409,'重大事项须通过申请与审批确认');
  requireThat(canConfirmRecord(permission,table),403,'仅本部门主管或项目管理员可确认状态');
  requireThat(table.lifecycle==='active'&&permission.lifecycle==='active'&&permission.workspace_lifecycle==='active',409,'仅活动项目和数据表可确认');
  const rows=(await c.query('SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[table.id,body.records.map(r=>r.id)])).rows;
  requireThat(rows.length===body.records.length,404,'部分记录不存在');
  for(const r of rows){requireThat(r.version===body.records.find(v=>v.id===r.id)!.version,409,'记录已被修改，请刷新重试');requireThat(r.lifecycle==='active'&&r.status!=='pending',409,'待审或非活动记录不能直接确认状态');
   if(body.status==='approved'){requireThat(r.data.activity_type!==LOE||r.data.loe_scope?.length,400,'LOE须先关联普通作业，再确认有效');validateRecord(table.columns,r.data,r.created_at);await validatePlanValues(c,table,r.data);if(r.supersedes)await c.query("UPDATE records SET status='obsolete',version=version+1 WHERE id=$1 AND status='approved'",[r.supersedes]);}
   await c.query("UPDATE records SET status=$2,confirmed_by=CASE WHEN $2='approved' THEN $3::uuid ELSE NULL END,confirmed_at=CASE WHEN $2='approved' THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1",[r.id,body.status,req.user.id]);
   await audit(c,permission.workspace_id,req.user.id,'主管确认数据状态',r.id,{table_id:table.id,before:r.status,after:body.status,version:r.version,snapshot:r.data});
  }
  await validatePlanSchedule(c,table);
 });res.json({ok:true,status:body.status,count:body.records.length});
});
data.get("/projects/:project/tables", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  const rows = (
    await pool.query(
      "SELECT t.*,d.name AS department_name,COALESCE(pt.kind,CASE WHEN pd.table_id IS NOT NULL THEN 'activity' END) AS planning_kind FROM data_tables t JOIN departments d ON d.id=t.department_id LEFT JOIN planning_tables pt ON pt.table_id=t.id LEFT JOIN plan_data_tables pd ON pd.table_id=t.id WHERE t.project_id=$1 ORDER BY t.created_at,t.name",
      [a.id],
    )
  ).rows
    .filter((t) => tableAllowed(a, t))
    .map((t) => ({ ...t, columns: visibleColumns(a, t) }));
  res.json(rows);
});
data.post("/projects/:project/tables", async (req, res) => {
  const body = z
    .object({
      name,
      description: z.string().max(500).default(""),
      department_id: id,
      columns: fields,
    })
    .parse(req.body);
  try {
    assertNoFormulaCycles(
      Object.fromEntries(
        body.columns
          .filter((f) => f.type === "formula")
          .map((f) => [f.id, f.formula!]),
      ),
      { fields: body.columns.map((f) => f.id) },
    );
  } catch (error) {
    requireThat(false, 400, (error as Error).message);
  }
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(canManage(a));
  requireThat(
    (
      await pool.query(
        "SELECT 1 FROM departments WHERE id=$1 AND project_id=$2",
        [body.department_id, a.id],
      )
    ).rowCount,
    400,
    "部门不属于当前项目",
  );
  const table = uid();
  await tx(async (c) => {
    await lockReferenceProject(c, a.id);
    await c.query(
      "INSERT INTO data_tables(id,project_id,department_id,name,description,columns) VALUES($1,$2,$3,$4,$5,$6)",
      [
        table,
        a.id,
        body.department_id,
        body.name,
        body.description,
        JSON.stringify(body.columns),
      ],
    );
    const columns = await prepareReferenceColumns(
      c,
      req.user.id,
      { id: table, project_id: a.id, name: body.name, columns: body.columns },
      body.columns,
    );
    if (columns.some((f) => f.inverse_id))
      await c.query("UPDATE data_tables SET columns=$1 WHERE id=$2", [
        JSON.stringify(columns),
        table,
      ]);
    await audit(c, a.workspace_id, req.user.id, "创建数据表", table);
  });
  res.status(201).json({ id: table });
});
data.post("/tables/:table/columns", async (req, res) => {
  const newField = fields.parse([req.body])[0];
  const preserveExisting=z.boolean().optional().parse(req.body.preserve_existing)===true;
  const position=z.object({anchor:z.string().max(50),side:z.enum(['left','right'])}).optional().parse(req.body.position);
  const { table, permission: a } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  requireThat(canManage(a));
  requireThat(
    !table.columns.some((f: any) => f.id === newField.id),
    400,
    "字段标识已存在",
  );
  requireThat(table.columns.length < 50, 400, "每表最多50列");
  await tx(async (c) => {
    await lockReferenceProject(c, a.id);
    const t = (
      await c.query("SELECT columns FROM data_tables WHERE id=$1 FOR UPDATE", [
        table.id,
      ])
    ).rows[0];
    const latest=await tableAccess(req.user.id,table.id,c);
    requireThat(canManage(latest.permission));
    requireThat(
      !t.columns.some((f: any) => f.id === newField.id),
      409,
      "字段已存在",
    );
    requireThat(t.columns.length < 50, 400, "每表最多50列");
    const exempt=preserveExisting&&(newField.required||newField.auto_increment||newField.auto_code||newField.type==='formula');
    if(newField.required&&!exempt&&!newField.auto_increment&&!newField.auto_code)requireThat(!(await c.query("SELECT 1 FROM records WHERE table_id=$1 AND lifecycle<>'deleted' LIMIT 1",[table.id])).rowCount,400,'已有记录时，请勾选“已有记录不影响”或取消必填');
    const prepared = await prepareReferenceColumns(
      c,
      req.user.id,
      { ...table, columns: t.columns },
      [newField],
    );
    if(exempt)Object.assign(prepared[0],{existing_records_before:(await c.query("SELECT clock_timestamp() AS cutoff")).rows[0].cutoff.toISOString()});
    const anchorIndex=position?t.columns.findIndex((f:any)=>f.id===position.anchor&&visibleColumns(latest.permission,latest.table).some((v:any)=>v.id===f.id)):-1;
    if(position)requireThat(anchorIndex>=0,409,'插入位置对应的列已变更，请刷新重试');
    const nextColumns=[...t.columns];
    nextColumns.splice(position?anchorIndex+Number(position.side==='right'):nextColumns.length,0,...prepared);
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
    await c.query(
      "UPDATE data_tables SET columns=$1::jsonb,object_version=object_version+1 WHERE id=$2",
      [JSON.stringify(nextColumns), table.id],
    );
    await audit(c, a.workspace_id, req.user.id, "新增字段", table.id, {
      field: newField.id,
    });
  });
  res.json({ ok: true });
});
data.get("/tables/:table/records", async (req, res) => {
  const requestedTable = id.parse(req.params.table);
  const view = await getPublicView(req.user.id, requestedTable);
  if (view) {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .default(1)
      .parse(req.query.page);
    const search = z
      .string()
      .trim()
      .max(100)
      .default("")
      .parse(req.query.search);
    const result = await executeView(
      req.user.id,
      view.project_id,
      view.definition,
    );
    const filters=parseColumnFilters(req.query.filters,[...view.columns,statusFilterColumn]);
    const rows = result.rows.filter(r=>matchesColumnFilters({...r,status:r.status||'approved'},[...view.columns,statusFilterColumn],filters)).filter(
      (r) =>
        !search ||
        Object.values(r.data).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    );
    const sort = z.string().max(50).optional().parse(req.query.sort),
      direction = z
        .enum(["asc", "desc"])
        .default("asc")
        .parse(req.query.direction);
    if (sort) {
      const c = view.columns.find((c: any) => c.id === sort);
      requireThat(c, 400, "排序列不存在");
      rows.sort((a, b) => {
        const x = a.data[sort],
          y = b.data[sort];
        if (x == null) return y == null ? 0 : 1;
        if (y == null) return -1;
        const sign = direction === "asc" ? 1 : -1;
        return sign * compareViewValues(x, y, c.type);
      });
    }
    const groups = z
      .string()
      .max(160)
      .default("")
      .parse(req.query.group)
      .split(",")
      .filter(Boolean);
    requireThat(
      groups.length <= 3 &&
        groups.every((id) => view.columns.some((c: any) => c.id === id)),
      400,
      "归类字段无效",
    );
    const ordered = orderedTableRows(
        rows,
        view.columns,
        groups,
        sort,
        direction === "asc" ? 1 : -1,
      ),
      pageRows = ordered.slice((page - 1) * 50, page * 50);
    res.json({
      table: view,
      rows: pageRows,
      ...(groups.length
        ? tableStatistics(ordered, view.columns, groups, pageRows)
        : {}),
      total: rows.length,
      page,
      pageSize: 50,
      permissions: {
        create: false,
        write: false,
        delete: false,
        manage: false,
        export: false,
      },
    });
    return;
  }
  const mapping = (
    await pool.query(
      "SELECT m.*,d.name AS department_name,t.name AS table_name FROM project_public_mappings m JOIN data_tables t ON t.id=m.source_table_id JOIN departments d ON d.id=t.department_id WHERE m.id=$1 AND m.project_id=t.project_id",
      [requestedTable],
    )
  ).rows[0];
  const { table, permission: a } = await tableAccess(
    req.user.id,
    mapping?.source_table_id || requestedTable,
  );
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .default(1)
    .parse(req.query.page);
  const search = z.string().trim().max(100).default("").parse(req.query.search);
  const status = z
    .enum(["all", "draft", "pending", "approved", "rejected", "obsolete"])
    .default("all")
    .parse(req.query.status);
  const sortField = z.string().max(50).optional().parse(req.query.sort),
    sortDirection = z
      .enum(["asc", "desc"])
      .default("asc")
      .parse(req.query.direction);
  const groups = z
    .string()
    .max(160)
    .default("")
    .parse(req.query.group)
    .split(",")
    .filter(Boolean);
  const planningHierarchy = z.enum(['wbs', 'activity']).optional().parse(req.query.planning_hierarchy);
  const wbsSort = z.string().max(50).default('code').parse(req.query.wbs_sort);
  const wbsDirection = z.enum(['asc','desc']).default('asc').parse(req.query.wbs_direction);
  if (planningHierarchy) {
    const binding = planningHierarchy === 'wbs'
      ? await pool.query("SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind='wbs'", [table.project_id])
      : await pool.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1', [table.project_id]);
    requireThat(binding.rows[0]?.table_id === table.id, 400, '当前表不是对应的计划管理表');
    requireThat(!groups.length && !sortField, 400, '层级视图不能同时使用自定义排序或归类');
  }
  requireThat(groups.length <= 3, 400, "最多三级归类");
  const columns = visibleColumns(a, table);
  requireThat(
    [...groups, ...(sortField ? [sortField] : [])].every((id) =>
      columns.some((f: any) => f.id === id),
    ),
    403,
    "排序或归类字段不存在或无权访问",
  );
  const planFilterContext=String(req.query.filters||'').includes('__plan_')&&!mapping?await readPlanRelations(req.user.id,table.id,!!req.user.system_admin):null;
  const wbsLevelRequested=String(req.query.filters||'').includes('__wbs_level');
  const wbsLevelAllowed=wbsLevelRequested&&!mapping&&(await pool.query("SELECT 1 FROM planning_tables WHERE table_id=$1 AND kind='wbs'",[table.id])).rowCount;
  const filterableColumns=[...(wbsLevelAllowed?[{id:'__wbs_level',name:'层级',type:'int32'}]:[]),...columns,...(planFilterContext?planFilterColumns:[]),statusFilterColumn];
  const filters=parseColumnFilters(req.query.filters,filterableColumns);
  const limit = 50;
  let query = "FROM records r JOIN users u ON u.id=r.created_by WHERE r.table_id=$1 AND r.lifecycle<>'deleted' AND "+recordVisibilitySql(a,'$2');
  const params:any[]=[table.id,req.user.id];
  if(mapping)query+=" AND r.status='approved'";
  if (status !== "all") {
    params.push(status);
    query += ` AND r.status=$${params.length}`;
  }
  if (search) {
    params.push(JSON.stringify(table.columns));
    params.push(
      visibleColumns(a, table)
        .filter((f: any) => !isReference(f))
        .map((f: any) => f.id),
      search,
    );
    const regular = `EXISTS(SELECT 1 FROM jsonb_each_text(record_field_values(r,$${params.length - 2}::jsonb)) field WHERE field.key=ANY($${params.length - 1}::text[]) AND strpos(lower(field.value),lower($${params.length}))>0)`;
    params.push(await findReferenceMatches(req.user.id, table, a, search));
    query += ` AND (${regular} OR r.id=ANY($${params.length}::uuid[]))`;
  }
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT r.*,u.name AS creator ${query} ORDER BY coalesce(r.row_position,grid_base_position(r.created_at,r.id)),r.id LIMIT ${groups.length || sortField || planningHierarchy || filters.conditions.length ? 10001 : limit} OFFSET ${groups.length || sortField || planningHierarchy || filters.conditions.length ? 0 : (page - 1) * limit}`,
      params,
    ),
    pool.query(`SELECT count(*)::int AS total ${query}`, params),
  ]);
  if(filters.conditions.length)requireThat(count.rows[0].total<=10000,400,'列筛选最多处理10000条，请先用搜索或状态缩小范围');
  let projected = await projectReferenceRows(req.user.id, table, a, rows.rows),
    statistics: any = {};
  const filterLevels=new Map<string,number>();
  if(wbsLevelAllowed){const allWbs=(await pool.query(`SELECT r.* FROM records r WHERE r.table_id=$1 AND r.lifecycle<>'deleted' AND ${recordVisibilitySql(a,'$2')} LIMIT 10001`,[table.id,req.user.id])).rows;requireThat(allWbs.length<=10000,400,'WBS层级最多10000个节点');for(const node of orderWbs(await projectReferenceRows(req.user.id,table,a,allWbs),'code',1))filterLevels.set(node.row.id,node.depth+1);}
  if(filters.conditions.length){projected=projected.filter((r:any)=>matchesColumnFilters({...r,data:{...r.data,...(wbsLevelAllowed?{__wbs_level:filterLevels.get(r.id)}:{}),...(planFilterContext?planFilterValues(r.id,planFilterContext):{})}},filterableColumns,filters));count.rows[0].total=projected.length;}
  let wbsHierarchy: Array<{id:string;code:string;name:string;depth:number;parent_id:string|null;lifecycle:string;status:string}> = [];
  let wbsSortName = '';
  let wbsWithActivities: string[] = [];
  if (planningHierarchy) {
    requireThat(count.rows[0].total <= 10000, 400, '层级视图最多10000条，请缩小筛选范围');
    const canSeeWbs = planningHierarchy === 'wbs' || columns.some((field:any)=>field.id==='wbs');
    const wbsId = !canSeeWbs ? null : planningHierarchy === 'wbs' ? table.id : (await pool.query("SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind='wbs'", [table.project_id])).rows[0]?.table_id;
    if (wbsId) {
      let wbsAccess: {table:any;permission:any}|null = planningHierarchy === 'wbs' ? {table,permission:a} : null;
      if (!wbsAccess) {
        try { wbsAccess = await tableAccess(req.user.id,wbsId); }
        catch (error) { if (!(error instanceof HttpError) || error.status !== 403) throw error; }
      }
      if (wbsAccess) {
      const {table:wbsTable, permission:wbsPermission} = wbsAccess;
      wbsSortName = visibleColumns(wbsPermission,wbsTable).find((field:any)=>field.id===wbsSort)?.name || '';
      const safeWbsSort = visibleColumns(wbsPermission,wbsTable).some((field:any)=>field.id===wbsSort) ? wbsSort : '';
      const wbsRows = planningHierarchy === 'wbs' && !search && status === 'all'
        ? rows.rows
        : (await pool.query(`SELECT r.* FROM records r WHERE r.table_id=$1 AND r.lifecycle<>'deleted' AND r.status<>'obsolete' AND ${recordVisibilitySql(wbsPermission,'$2')} ORDER BY coalesce(r.row_position,grid_base_position(r.created_at,r.id)),r.id LIMIT 10001`, [wbsId,req.user.id])).rows;
      requireThat(wbsRows.length <= 10000, 400, 'WBS层级最多10000个节点');
      const visibleWbs = await projectReferenceRows(req.user.id,wbsTable,wbsPermission,wbsRows);
      wbsHierarchy = orderWbs(visibleWbs,safeWbsSort,wbsDirection==='asc'?1:-1).map(({row,depth})=>({id:row.id,code:String(row.data.code||''),name:String(row.data.name||''),depth,parent_id:row.data.parent?.[0]||null,lifecycle:row.lifecycle,status:row.status}));
      const position = new Map(wbsHierarchy.map((node,index)=>[node.id,index]));
      projected.sort((left:any,right:any)=>{
        const leftId = planningHierarchy === 'wbs' ? left.id : left.data.wbs?.[0];
        const rightId = planningHierarchy === 'wbs' ? right.id : right.data.wbs?.[0];
        return (position.get(leftId) ?? Number.MAX_SAFE_INTEGER)-(position.get(rightId) ?? Number.MAX_SAFE_INTEGER);
      });
      }
    }
    if(planningHierarchy==='activity'){
      const visibleNodes=new Set(wbsHierarchy.map(node=>node.id));
      wbsWithActivities=[...new Set<string>(projected.map(row=>row.data.wbs?.[0]).filter(id=>visibleNodes.has(id)))];
    }
    projected = projected.slice((page - 1) * limit,page * limit);
  } else if (groups.length || sortField) {
    requireThat(
      count.rows[0].total <= 10000,
      400,
      "排序/归类最多10000条，请缩小筛选范围",
    );
    const ordered = orderedTableRows(
      projected,
      columns,
      groups,
      sortField,
      sortDirection === "asc" ? 1 : -1,
    );
    projected = ordered.slice((page - 1) * limit, page * limit);
    if (groups.length)
      statistics = tableStatistics(ordered.filter(r=>r.status==='approved'), columns, groups, projected);
  }
  if(filters.conditions.length&&!planningHierarchy&&!groups.length&&!sortField)projected=projected.slice((page-1)*limit,page*limit);
  res.json({
    rows: projected,
    ...(planningHierarchy ? {wbsHierarchy,wbsSortName,wbsWithActivities} : {}),
    ...statistics,
    total: count.rows[0].total,
    page,
    pageSize: limit,
    table: {
      ...table,
      ...(mapping
        ? {
            id: mapping.id,
            name: `${mapping.department_name} · ${mapping.table_name}`,
            source_table_id: table.id,
            is_mapping: true,
          }
        : {}),
      columns: visibleColumns(a, table),
    },
    permissions: {
      create:
        !mapping &&
        canRecordAction(a, table, "create") &&
        table.lifecycle === "active" &&
        a.lifecycle === "active" &&
        a.workspace_lifecycle === "active",
      delete:
        !mapping &&
        canRecordAction(a, table, "delete") &&
        table.lifecycle === "active" &&
        a.lifecycle === "active" &&
        a.workspace_lifecycle === "active",
      write:
        !mapping &&
        canRecordAction(a, table, "update") &&
        table.lifecycle === "active" &&
        a.lifecycle === "active" &&
        a.workspace_lifecycle === "active",
      confirm: !mapping && reviewMode(table)==='supervisor' && canConfirmRecord(a,table) && table.lifecycle==='active' && a.lifecycle==='active' && a.workspace_lifecycle==='active',
      manage: !mapping && canManage(a),
      export: !mapping && (canManage(a) || a.can_export),
    },
  });
});
data.post("/tables/:table/records", async (req, res) => {
  const input = z.record(z.string(), z.unknown()).parse(req.body.data);
  const before=id.optional().parse(req.body.insert_before),after=id.optional().parse(req.body.insert_after);
  requireThat(!(before&&after),400,"不能同时指定前插与后插位置");
  const { table, permission: a } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  requireThat(canRecordAction(a, table, "create"));
  requireThat(
    visibleColumns(a, table).length === table.columns.length ||
      Object.keys(input).every((k) =>
        visibleColumns(a, table).some((f: any) => f.id === k),
      ),
    403,
  );
  const value = validateRecord(table.columns, await normalizeLoeInput(table,input));
  const record = uid();
  let generated:Record<string,unknown>={};
  await tx(async (c) => {
    await lockReferenceProject(c, a.id);
    const latest = await tableAccess(req.user.id, table.id, c);
    requireThat(canRecordAction(latest.permission, latest.table, "create"));
    requireThat(
      latest.table.object_version === table.object_version,
      409,
      "表结构或归属已变化，请重新打开录入表单",
    );
    requireThat(
      Object.keys(input).every((k) =>
        visibleColumns(latest.permission, latest.table).some(
          (f: any) => f.id === k,
        ),
      ),
    );
    await validatePlanValues(c, table, value);
    await validateForwardReferences(c, req.user.id, table, value);
    let rowPosition:string|null=null;
    if(before){
      const anchor=(await c.query("SELECT r.*,coalesce(row_position,grid_base_position(created_at,id)) pos FROM records r WHERE id=$1 AND table_id=$2 AND lifecycle<>'deleted'",[before,table.id])).rows[0];
      requireThat(anchor&&rowAllowed(latest.permission,anchor,req.user.id),409,'插入位置对应的行已变更或不可见');
      rowPosition=(await c.query(`SELECT coalesce(max(pos)+($2::numeric-max(pos))*0.5,$2::numeric-1) pos FROM
        (SELECT coalesce(row_position,grid_base_position(created_at,id)) pos FROM records WHERE table_id=$1 AND lifecycle<>'deleted') r WHERE pos<$2::numeric`,[table.id,anchor.pos])).rows[0].pos;
    }
    if(after){
      const anchor=(await c.query("SELECT r.*,coalesce(row_position,grid_base_position(created_at,id)) pos FROM records r WHERE id=$1 AND table_id=$2 AND lifecycle<>'deleted'",[after,table.id])).rows[0];
      requireThat(anchor&&rowAllowed(latest.permission,anchor,req.user.id),409,'插入位置对应的行已变更或不可见');
      rowPosition=(await c.query(`SELECT coalesce($2::numeric+(min(pos)-$2::numeric)*0.5,$2::numeric+1) pos FROM
        (SELECT coalesce(row_position,grid_base_position(created_at,id)) pos FROM records WHERE table_id=$1 AND lifecycle<>'deleted') r WHERE pos>$2::numeric`,[table.id,anchor.pos])).rows[0].pos;
    }
    const inserted=await c.query(
      "INSERT INTO records(id,table_id,data,created_by,row_position) VALUES($1,$2,$3,$4,$5) RETURNING data",
      [record, table.id, JSON.stringify(value), req.user.id,rowPosition],
    );
    generated=Object.fromEntries(visibleColumns(latest.permission,latest.table).filter((f:any)=>f.auto_increment||f.auto_code).map((f:any)=>[f.id,inserted.rows[0].data[f.id]]));
    await validatePlanSchedule(c, table);
    await applyBacklinks(c, req.user.id, table, record, input, {}, true);
    await audit(c, a.workspace_id, req.user.id, "新增记录", record, {
      table: table.id,
    });
    if(latest.table.columns.some((f:any)=>f.plan_date==='finish')||value.activity_type===LOE){
      const row=(await c.query('SELECT * FROM records WHERE id=$1',[record])).rows[0];
      const projected=(await projectReferenceRows(req.user.id,latest.table,latest.permission,[row],c))[0];
      for(const f of visibleColumns(latest.permission,latest.table).filter((f:any)=>f.plan_date==='finish'||row.data.activity_type===LOE&&(['duration','remaining_duration'].includes(f.id)||f.plan_date==='start')))generated[f.id]=projected.data[f.id];
    }
  });
  res.status(201).json({ id: record,...(Object.keys(generated).length?{generated}:{}) });
});
export async function updateRecord(user:string,recordId:string,input:unknown) {
  const body = z
    .object({
      version: z.number().int(),
      data: z.record(z.string(), z.unknown()),
      reference_expected: z
        .record(z.string(), z.array(id).max(10000))
        .default({}),
    })
    .parse(input);
  const initial = (
    await pool.query(
      "SELECT t.project_id FROM records r JOIN data_tables t ON t.id=r.table_id WHERE r.id=$1",
      [id.parse(recordId)],
    )
  ).rows[0];
  requireThat(initial, 404, "记录不存在");
  return tx(async (c) => {
    await lockReferenceProject(c, initial.project_id);
    const record = (
      await c.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [
        id.parse(recordId),
      ])
    ).rows[0];
    requireThat(record, 404, "记录不存在");
    requireThat(record.lifecycle === "active",409,"记录非活动状态，不能修改");
    const { table, permission: a } = await tableAccess(
      user,
      record.table_id,
      c,
    );
    requireThat(
      canRecordAction(a, table, "update") && rowAllowed(a, record, user),
    );
    requireThat(
      editableRecord(table,record.status),
      409,
      "待审或已审核记录不能直接修改，请先撤回或发起变更",
    );
    requireThat(
      record.version === body.version,
      409,
      "记录已被其他用户修改，请刷新后重试",
    );
    const cols = visibleColumns(a, table);
    requireThat(
      Object.keys(body.data).every((k) => cols.some((f: any) => f.id === k)),
    );
    requireThat(!cols.some((f:any)=>(f.type==='formula'||f.plan_date==='finish')&&Object.hasOwn(body.data,f.id)),400,'自动计算字段只读，不能填写');
    const value = validateRecord(table.columns, await normalizeLoeInput(table,{
      ...record.data,
      ...body.data,
    },record),record.created_at);
    await validatePlanValues(c, table, value);
    await validateForwardReferences(c, user, table, value, record.data);
    const updated=await writeAgendaRecord(c,user,table,record,value)?null:(await c.query(
      "UPDATE records SET data=$1,version=version+1,status='draft',updated_at=now() WHERE id=$2 RETURNING data",
      [JSON.stringify(value), record.id],
    )).rows[0];
    if(updated&&updated.data.code!==record.data.code&&(await c.query("SELECT 1 FROM planning_tables WHERE table_id=$1 AND kind='wbs'",[table.id])).rowCount){
      const descendants=(await c.query(`WITH RECURSIVE branch(id,depth,path) AS (
        SELECT $1::uuid,0,ARRAY[$1::uuid]
        UNION ALL
        SELECT r.id,b.depth+1,b.path||r.id FROM branch b JOIN records r ON r.table_id=$2
          AND r.data->'parent'->>0=b.id::text AND r.wbs_code_auto AND r.lifecycle='active'
          AND r.status<>'obsolete' AND NOT r.id=ANY(b.path)
      ) SELECT r.* FROM branch b JOIN records r ON r.id=b.id WHERE b.depth>0 ORDER BY b.depth,r.id FOR UPDATE OF r`,[record.id,table.id])).rows;
      requireThat(descendants.every(r=>rowAllowed(a,r,user)&&editableRecord(table,r.status)),409,'部分下级WBS不可编辑，无法同步调整其编码');
      for(const child of descendants)await c.query("UPDATE records SET data=jsonb_set(data,'{code}','null'::jsonb),version=version+1 WHERE id=$1",[child.id]);
    }

    await validatePlanSchedule(c, table);
    await applyBacklinks(
      c,
      user,
      table,
      record.id,
      body.data,
      body.reference_expected,
    );
    await audit(c, a.workspace_id, user, "修改草稿", record.id);
    const generated:Record<string,unknown>={};
    if(table.columns.some((f:any)=>f.plan_date==='finish')||value.activity_type===LOE){
      const current=(await c.query('SELECT * FROM records WHERE id=$1',[record.id])).rows[0];
      const projected=(await projectReferenceRows(user,table,a,[current],c))[0];
      for(const f of cols.filter((f:any)=>f.plan_date==='finish'||current.data.activity_type===LOE&&(['duration','remaining_duration'].includes(f.id)||f.plan_date==='start')))generated[f.id]=projected.data[f.id];
    }
    return {generated};
  });
}
data.put("/records/:record", async (req,res)=>{const result=await updateRecord(req.user.id,id.parse(req.params.record),req.body);res.json({ok:true,...result});});
data.post("/records/:record/change", async (req, res) => {
  const result = await tx(async (c) => {
    const r = (
      await c.query("SELECT * FROM records WHERE id=$1", [
        id.parse(req.params.record),
      ])
    ).rows[0];
    requireThat(r, 404, "记录不存在");
    const { table, permission: a } = await tableAccess(
      req.user.id,
      r.table_id,
      c,
    );
    requireThat(
      canRecordAction(a, table, "create") && rowAllowed(a, r, req.user.id),
    );
    requireThat(r.status === "approved", 409, "只有已审核记录可以发起变更");
    requireThat(r.lifecycle === "active", 409, "记录非活动状态，请先激活");
    const record = uid();
    await c.query(
      "INSERT INTO records(id,table_id,data,created_by,supersedes) VALUES($1,$2,$3,$4,$5)",
      [record, r.table_id, JSON.stringify(Object.fromEntries(Object.entries(r.data).filter(([fieldId])=>!table.columns.some((f:any)=>f.id===fieldId&&f.type==='formula')))), req.user.id, r.id],
    );
    await c.query(
      "INSERT INTO record_file_links(id,record_id,file_version_id,file_name,created_by) SELECT gen_random_uuid(),$1,file_version_id,file_name,$2 FROM record_file_links WHERE record_id=$3",
      [record, req.user.id, r.id],
    );
    await c.query(
      "INSERT INTO record_activity_links(record_id,activity_id,created_by) SELECT $1,activity_id,$2 FROM record_activity_links WHERE record_id=$3",
      [record, req.user.id, r.id],
    );
    await audit(c, a.workspace_id, req.user.id, "创建变更草稿", record, {
      source: r.id,
    });
    return { id: record };
  });
  res.json(result);
});
data.post('/tables/:table/records/batch-update',async(req,res)=>{
 const key=id.parse(req.params.table),body=z.object({records:z.array(z.object({id,version:z.number().int().positive(),data:z.record(z.string(),z.unknown()),reference_expected:z.record(z.string(),z.array(id).max(10000)).optional()}).strict()).min(1).max(BATCH_UPDATE_LIMIT)}).strict().parse(req.body);
 requireThat(new Set(body.records.map(r=>r.id)).size===body.records.length,400,'修改列表不能重复');
 await tx(async c=>requestTransaction.run(c,async()=>{
  const initial=await tableAccess(req.user.id,key,c);await lockReferenceProject(c,initial.table.project_id);
  const records=(await c.query('SELECT id FROM records WHERE table_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[key,body.records.map(r=>r.id)])).rows;
  requireThat(records.length===body.records.length,404,'部分记录不存在或不属于本表');
  for(const r of [...body.records].sort((a,b)=>a.id.localeCompare(b.id)))await updateRecord(req.user.id,r.id,r);
  await audit(c,initial.permission.workspace_id,req.user.id,'批量修改草稿',key,{count:body.records.length});
 }));res.json({ok:true,count:body.records.length});
});
data.post("/tables/:table/records/batch-delete", async (req, res) => {
  const key = id.parse(req.params.table),
    body = z
      .object({
        records: z
          .array(z.object({ id, version: z.number().int().positive() }))
          .min(1)
          .max(BATCH_DELETE_LIMIT),
      })
      .parse(req.body);
  requireThat(
    new Set(body.records.map((r) => r.id)).size === body.records.length,
    400,
    "删除列表不能重复",
  );
  const initial = await tableAccess(req.user.id, key);
  await tx(async (c) => {
    await lockReferenceProject(c, initial.table.project_id);
    const { table, permission: a } = await tableAccess(req.user.id, key, c);
    requireThat(canRecordAction(a, table, "delete"));
    const keys = body.records.map((r) => r.id),
      rows = (
        await c.query(
          "SELECT * FROM records WHERE table_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
          [key, keys],
        )
      ).rows;
    requireThat(
      rows.length === keys.length,
      404,
      "部分记录已不存在或不属于本表，请刷新",
    );
    for (const r of rows) {
      requireThat(rowAllowed(a, r, req.user.id));
      requireThat(
        r.lifecycle === "active" && ["draft", "rejected"].includes(r.status),
        409,
        "只能删除活动的草稿或已退回记录",
      );
      requireThat(
        body.records.find((n) => n.id === r.id)!.version === r.version,
        409,
        "部分记录已更新，请刷新后重新选择",
      );
    }
    requireThat(
      !(
        await c.query(
          "SELECT 1 FROM approvals WHERE record_id=ANY($1::uuid[]) LIMIT 1",
          [keys],
        )
      ).rowCount,
      409,
      "所选记录存在审批历史，整批未删除",
    );
    const mapped = (
      await c.query(
        "SELECT activity_id,record_id FROM plan_activity_records WHERE record_id=ANY($1::uuid[])",
        [keys],
      )
    ).rows;
    let order = keys;
    if (mapped.length) {
      await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        table.project_id,
      ]);
      const activities = (
        await c.query(
          "SELECT id,code,predecessors FROM activities WHERE project_id=$1 ORDER BY id FOR UPDATE",
          [table.project_id],
        )
      ).rows;
      const selectedActivities = new Set(mapped.map((r) => r.activity_id));
      const dependent = activities.find(
        (r) =>
          !selectedActivities.has(r.id) &&
          r.predecessors.some((d: any) => selectedActivities.has(d.id)),
      );
      requireThat(
        !dependent,
        409,
        `未选作业 ${dependent?.code || ""} 仍依赖所选作业，请先解除关系或一并选择；整批未删除`,
      );
      const recordByActivity = new Map(
          mapped.map((r) => [r.activity_id, r.record_id]),
        ),
        ordered: string[] = [],
        seen = new Set<string>();
      function visit(activity: string) {
        if (seen.has(activity)) return;
        seen.add(activity);
        activities
          .filter(
            (r) =>
              selectedActivities.has(r.id) &&
              r.predecessors.some((d: any) => d.id === activity),
          )
          .forEach((r) => visit(r.id));
        ordered.push(recordByActivity.get(activity)!);
      }
      mapped.forEach((r) => visit(r.activity_id));
      order = [...ordered, ...keys.filter((k) => !ordered.includes(k))];
    }
    for (const record of order) {
      await c.query(
        "UPDATE records SET lifecycle='deleted',version=version+1,updated_at=now() WHERE id=$1",
        [record],
      );
      await audit(c, a.workspace_id, req.user.id, "批量删除草稿", record, {
        batch_size: keys.length,
        table_id: key,
      });
    }
  });
  res.json({ ok: true, deleted: body.records.length });
});

data.delete("/records/:record", async (req, res) => {
  await tx(async (c) => {
    const r = (
      await c.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [
        id.parse(req.params.record),
      ])
    ).rows[0];
    requireThat(r, 404, "记录不存在");
    const { table, permission: a } = await tableAccess(
      req.user.id,
      r.table_id,
      c,
    );
    requireThat(
      canRecordAction(a, table, "delete") && rowAllowed(a, r, req.user.id),
    );
    requireThat(
      ["draft", "rejected"].includes(r.status),
      409,
      "仅草稿或已退回记录可以删除",
    );
    const count = (
      await c.query("SELECT 1 FROM approvals WHERE record_id=$1", [r.id])
    ).rowCount;
    requireThat(!count, 409, "存在审批历史的记录应保留");
    await c.query(
      "UPDATE records SET lifecycle='deleted',version=version+1,updated_at=now() WHERE id=$1",
      [r.id],
    );
    await audit(c, a.workspace_id, req.user.id, "删除草稿", r.id);
  });
  res.json({ ok: true });
});
data.post("/tables/:table/import", async (req, res) => {
  const includeIds=z.boolean().optional().default(false).parse(req.body.include_created_ids);
  const createdIds:string[]=[];
  const requestKey = id.optional().parse(req.body.request_key);
  requireThat(!includeIds||!requestKey,400,'需要新建记录关联时不能复用导入请求标识');
  const rows = z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(BATCH_CREATE_LIMIT)
    .parse(req.body.rows);
  const { table, permission: a } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  requireThat(canRecordAction(a, table, "create"));
  const columns = visibleColumns(a, table);
  const values = rows.map((r, index) => {
    requireThat(
      Object.keys(r).every((k) => columns.some((f: any) => f.id === k)),
    );
    try {
      return validateRecord(table.columns, normalizeLoeValues(table,r));
    } catch (e) {
      throw new HttpError(400, `第${index + 1}行：${(e as Error).message}`);
    }
  });
  const replayed = await tx(async (c) => {
    await lockReferenceProject(c, a.id);
    const latest = await tableAccess(req.user.id, table.id, c);
    requireThat(canRecordAction(latest.permission, latest.table, "create"));
    requireThat(
      latest.table.object_version === table.object_version,
      409,
      "表结构或归属已变化，请重新校验导入",
    );
    requireThat(
      rows.every((row) =>
        Object.keys(row).every((k) =>
          visibleColumns(latest.permission, latest.table).some(
            (f: any) => f.id === k,
          ),
        ),
      ),
    );
    if (requestKey) {
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            values,
            backlinks: rows.map((row) =>
              Object.fromEntries(
                table.columns
                  .filter((f: any) => f.type === "backlink")
                  .map((f: any) => [f.id, row[f.id] ?? []]),
              ),
            ),
          }),
        )
        .digest("hex");
      const inserted = await c.query(
        "INSERT INTO import_batches(request_key,table_id,user_id,content_hash,row_count) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,request_key) DO NOTHING RETURNING request_key",
        [requestKey, table.id, req.user.id, digest, values.length],
      );
      if (!inserted.rowCount) {
        const prior = (
          await c.query(
            "SELECT * FROM import_batches WHERE user_id=$1 AND request_key=$2",
            [req.user.id, requestKey],
          )
        ).rows[0];
        requireThat(
          prior.table_id === table.id && prior.content_hash === digest,
          409,
          "导入请求标识已经用于其他内容，请重新校验",
        );
        return true;
      }
    }
    for (const [index, r] of values.entries()) {
      const record = uid();createdIds.push(record);
      await validatePlanValues(c, table, r);
      await validateForwardReferences(c, req.user.id, table, r);
      await c.query(
        "INSERT INTO records(id,table_id,data,created_by) VALUES($1,$2,$3,$4)",
        [record, table.id, JSON.stringify(r), req.user.id],
      );
      await applyBacklinks(
        c,
        req.user.id,
        table,
        record,
        rows[index],
        {},
        true,
      );
    }
    await validatePlanSchedule(c, table);
    await audit(c, a.workspace_id, req.user.id, "批量导入草稿", table.id, {
      count: values.length,
    });
    return false;
  });
  res.json({ count: values.length, replayed,...(includeIds?{ids:createdIds}:{}) });
});
data.get("/tables/:table/export", async (req, res) => {
  const { table, permission: a } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  requireThat(canManage(a) || a.can_export);
  const own = !canManage(a) && a.row_scope === "own";
  const rows = (
    await pool.query(
      "SELECT r.* FROM records r WHERE table_id=$1 AND lifecycle<>'deleted' AND "+recordVisibilitySql(a,'$2')+" ORDER BY created_at ASC,id ASC LIMIT 10001",
      [table.id,req.user.id],
    )
  ).rows;
  requireThat(
    rows.length <= 10000,
    400,
    "当前导出上限为10000行，请缩小数据范围",
  );
  const cols = visibleColumns(a, table);
  const projected = await projectReferenceRows(req.user.id, table, a, rows);
  requireThat(
    rows.every((r) =>
      cols.every((f: any) => displayValue(r.data[f.id]).length <= 32767),
    ),
    400,
    "存在超过Excel单元格32767字符上限的值，请拆分内容；本次未导出，避免数据截断",
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据");
  sheet.columns = [
    ...cols.map((f: any) => ({ header: f.name, key: f.id, width: 22 })),
    { header: "状态", key: "_status", width: 14 },
  ];
  for (const r of projected)
    sheet.addRow({
      ...Object.fromEntries(
        Object.entries(r.data).map(([key, value]) => [
          key,
          typeof value === "object" && value !== null
            ? displayValue(value)
            : value,
        ]),
      ),
      _status: r.status,
    });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  await audit(pool, a.workspace_id, req.user.id, "导出数据", table.id, {
    count: rows.length,
  });
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(table.name)}.xlsx`,
  );
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await workbook.xlsx.write(res);
  res.end();
});
data.get("/tables/:table/views", async (req, res) => {
  const { table } = await tableAccess(req.user.id, id.parse(req.params.table));
  res.json(
    (
      await pool.query(
        "SELECT * FROM saved_views WHERE table_id=$1 AND user_id=$2 ORDER BY name",
        [table.id, req.user.id],
      )
    ).rows,
  );
});
data.post("/tables/:table/views", async (req, res) => {
  const body = z
    .object({
      name,
      config: z.object({
        search: z.string().max(100),
        status: z.string().max(20),
      }),
    })
    .parse(req.body);
  const { table } = await tableAccess(req.user.id, id.parse(req.params.table));
  await pool.query(
    "INSERT INTO saved_views(id,table_id,user_id,name,config) VALUES($1,$2,$3,$4,$5) ON CONFLICT(table_id,user_id,name) DO UPDATE SET config=excluded.config",
    [uid(), table.id, req.user.id, body.name, JSON.stringify(body.config)],
  );
  res.json({ ok: true });
});
export async function summary(user: string, project: string) {
  const a = await access(user, project);
  const tables = (
    await pool.query(
      "SELECT t.*,d.name AS department_name FROM data_tables t JOIN departments d ON d.id=t.department_id WHERE t.project_id=$1",
      [project],
    )
  ).rows.filter((t) => tableAllowed(a, t));
  const ids = tables.map((t) => t.id);
  const own = !canManage(a) && a.row_scope === "own";
  const rows = (
    await pool.query(
      "SELECT * FROM records WHERE table_id=ANY($1::uuid[]) AND lifecycle<>'deleted'" +
        (own ? " AND created_by=$2" : ""),
      own ? [ids, user] : [ids],
    )
  ).rows.filter(r=>rowAllowed(a,r,user));
  const counts = {
    total: rows.length,
    approved: rows.filter((r) => r.status === "approved").length,
    pending: rows.filter((r) => r.status === "pending").length,
    draft: rows.filter((r) => ["draft", "rejected"].includes(r.status)).length,
  };
  return {
    project: {
      id: a.id,
      name: a.name,
      engineering_stage: a.engineering_stage,
      business_stage: a.business_stage,
      start_date: a.start_date,
      description: a.description,
    },
    counts,
    tables: tables.map((t) => {
      const rr = rows.filter((r) => r.table_id === t.id);
      return {
        id: t.id,
        name: t.name,
        department: t.department_name,
        total: rr.length,
        approved: rr.filter((r) => r.status === "approved").length,
        pending: rr.filter((r) => r.status === "pending").length,
        metrics: visibleColumns(a, t)
          .filter((f: any) => numericTypes.includes(f.type))
          .map((f: any) => ({
            id: f.id,
            name: f.name,
            unit: f.unit || "",
            type: f.type,
            sum: (() => {
              const sum = exactSum(
                rr
                  .filter((r) => r.status === "approved")
                  .map((r) => r.data[f.id]),
                f.type === "decimal" ? (f.scale ?? 2) : undefined,
              );
              return ["int64", "uint64", "decimal"].includes(f.type) ||
                !Number.isFinite(Number(sum)) ||
                (Number.isInteger(Number(sum)) &&
                  !Number.isSafeInteger(Number(sum)))
                ? sum
                : Number(sum);
            })(),
          })),
      };
    }),
  };
}
data.get("/projects/:project/summary", async (req, res) =>
  res.json(await summary(req.user.id, id.parse(req.params.project))),
);
