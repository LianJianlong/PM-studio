import {reportAssessment} from '../shared/report-assessment.ts';
import {reportCategories} from '../shared/report-template-catalog.ts';
import {installReportTemplates} from './report-template-suite.ts';
import {requireFullPlanRead} from './planning-read-access.ts';
import {parseReportFormula,formulaSeries} from "../shared/report-formula.ts";
import {resolveReportPeriod} from "../shared/report-period.ts";
import {reportSourceIds} from "../shared/report-access.ts";
import { Router } from "express";
import { z } from "zod";
import { access, canManage, operationAllowed, requireThat, HttpError, tableAccess, tableAllowed, visibleColumns, projectRecord, rowAllowed } from "./auth.ts";
import { pool, uid, audit, tx } from "./db.ts";
import { summary } from "./data.ts";
import { numericTypes } from "../shared/fields.ts";
import { aggregateReportValues, type ReportAggregation } from "../shared/report-aggregate.ts";
import { matchesReportFilters } from "../shared/report-filter.ts";
import { aggregateReportPivot, type ReportPivot } from "../shared/report-pivot.ts";
import {getPublicView,executeView,publicViewCatalog} from './public-views.ts';

export const reportDocuments = Router();
const id = z.string().uuid();
const chartTypes = ["bar", "horizontalBar", "line", "area", "pie", "donut", "scatter", "radar", "funnel", "gauge"] as const;
const block = z.object({
  id: z.string().min(1).max(100),
  periodRequired:z.boolean().optional(),
  reportId:id.optional(),formula:z.string().max(1000).optional(),pageBreakBefore:z.boolean().optional(),keepTogether:z.boolean().optional(),
  type: z.enum(["title", "text", "kpi", "table", "chart", "divider", "subreport", "pagebreak", "assessment"]),
  title: z.string().max(200).optional(),
  text: z.string().max(4000).optional(),
  source: z.enum(["record_summary", "activity_progress", "resource_cost", "business_table"]).optional(),
  tableId: id.optional(),
  dimension: z.string().max(50).optional(),
  dimension2: z.string().max(50).optional(),
  metric: z.string().max(50).optional(),
  aggregation: z.enum(["count", "sum", "average", "min", "max"]).optional(),
  status: z.enum(["approved", "pending", "draft", "all"]).optional(),
  filterField: z.string().max(50).optional(),
  filterOperator: z.enum(["equals", "contains"]).optional(),
  filterValue: z.string().max(160).optional(),
  detailFields:z.array(z.string().max(40)).max(12).optional(),
  datePreset:z.enum(["day","week","fortnight","month"]).optional(),
  dateField: z.string().max(50).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  departmentId: id.optional(),
  chartType: z.enum(chartTypes).optional(),
  gaugeMax:z.number().finite().positive().max(1e15).optional(),
  xMetric:z.string().max(50).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  fontSize: z.number().int().min(10).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const pageSettings=z.object({paper:z.enum(["A4","A3","Letter"]).default("A4"),orientation:z.enum(["portrait","landscape"]).default("portrait"),margin:z.number().min(5).max(40).default(12),pageNumbers:z.boolean().default(true),header:z.string().max(120).optional(),footer:z.string().max(120).optional()});
const layout = z.object({ category:z.enum(reportCategories).optional(),template:z.object({version:z.number().int(),key:z.string().max(120),cadence:z.enum(['day','week','month','custom','topic']),references:z.array(z.string().url()).max(10)}).optional(),page:pageSettings.optional(),sections: z.object({
  header: z.array(block).max(30), detail: z.array(block).max(30),
  summary: z.array(block).max(30), footer: z.array(block).max(30),
}) });
const sources = {
  record_summary: { label: "数据记录", dimensions: { table: "数据表", department: "部门" }, metrics: { total: "记录总数", approved: "已审核", pending: "待审核" } },
  activity_progress: { label: "计划进度", dimensions: { department: "部门", activity_name: "作业名称", code: "作业编码" }, metrics: { duration: "计划工期", progress: "平均完成率", completed_days: "完成工期" } },
  resource_cost: { label: "资源费用", dimensions: { department: "部门", activity_name: "作业名称", resource_kind: "资源类型", resource_name: "资源名称" }, metrics: { quantity: "资源数量", planned_cost: "计划费用", actual_cost: "实际费用", cost_variance: "费用差额" } },
} as const;
const sqlMetrics: Record<string, Record<string, string>> = {
  activity_progress: { duration: "SUM(duration)", progress: "AVG(progress)", completed_days: "SUM(completed_days)" },
  resource_cost: { quantity: "SUM(quantity)", planned_cost: "SUM(planned_cost)", actual_cost: "SUM(actual_cost)", cost_variance: "SUM(cost_variance)" },
};
const dimensionTypes = new Set(["text", "date", "time", "timestamp", "timestamptz", "enum", "single_select", "boolean", "number", "int8", "int16", "int24", "int32", "int64", "uint64", "decimal", "float32", "float64", "formula"]);
const dateTypes = new Set(["date", "timestamp", "timestamptz", "created_time", "modified_time"]);
function reportFields(a: any, table: any) {
  const columns = table.is_view ? table.columns : visibleColumns(a, table);
  return {
    detailFields:columns.filter((f:any)=>!["reference","backlink","file"].includes(f.type)),
    dimensions: columns.filter((f: any) => dimensionTypes.has(f.type)),
    metrics: columns.filter((f: any) => numericTypes.includes(f.type) || f.type === "formula"),
    dates: columns.filter((f: any) => dateTypes.has(f.type)),
  };
}
async function businessTable(user: string, projectId: string, tableId: string, dimension: string, metric: string) {
  const view = await getPublicView(user,id.parse(tableId));
  const { table, permission } = view ? {table:view,permission:await access(user,view.project_id)} : await tableAccess(user, tableId);
  requireThat(table.project_id === projectId, 400, "数据表不属于当前项目");
  const fields = reportFields(permission, table);
  requireThat(dimension==='__status__' || (!view && dimension==='__created_month__') || fields.dimensions.some((f: any) => f.id === dimension), 403, "分组字段不可用或无权限");
  requireThat(metric === "__count__" || fields.metrics.some((f: any) => f.id === metric), 403, "统计字段不可用或无权限");
  return { table, permission };
}
function defaultLayout(name: string) {
  return { sections: {
    header: [{ id: uid(), type: "title", text: name }, { id: uid(), type: "text", text: "项目全周期管理 · 数据分析报告" }],
    detail: [{ id: uid(), type: "chart", title: "部门计划工期", source: "activity_progress", dimension: "department", metric: "duration", chartType: "bar" }],
    summary: [{ id: uid(), type: "table", title: "记录统计", source: "record_summary", dimension: "table", metric: "total" }],
    footer: [{ id: uid(), type: "text", text: "Project Studio · 授权数据实时统计" }],
  } };
}
async function readableReports(a:any,rows:any[]){
 if(canManage(a))return rows;
 const tables=(await pool.query('SELECT * FROM data_tables WHERE project_id=$1',[a.id])).rows;
 const allowed=new Set(tables.filter(t=>tableAllowed(a,t)).map(t=>t.id));
 const views=(await pool.query('SELECT id,definition FROM project_public_views WHERE project_id=$1 AND deleted_at IS NULL',[a.id])).rows;
 for(const view of views)if(view.definition.sources.every((id:string)=>allowed.has(id)))allowed.add(view.id);
 return rows.filter(r=>reportSourceIds(r.layout).every(id=>allowed.has(id))&&(!Object.values(r.layout?.sections||{}).flat().some((b:any)=>b.source==='resource_cost')||operationAllowed(a,'$data','read')));
}
async function document(user: string, documentId: string) {
  const row = (await pool.query("SELECT * FROM report_documents WHERE id=$1 AND deleted_at IS NULL", [documentId])).rows[0];
  if (!row) throw new HttpError(404, "报表不存在");
  const permission = await access(user, row.project_id);
  requireThat((await readableReports(permission,[row])).length,403,"没有该报表数据源的读取权限");
  row.can_edit=canManage(permission)||permission.can_export&&row.created_by===user;
  return { row, permission };
}
export async function expandReport(user:string,row:any,trail:string[]=[],budget={remaining:150}):Promise<any>{
 requireThat(trail.length<4&&!trail.includes(row.id),400,'子报表引用循环或超过4层');
 const saved=layout.parse(row.layout),versions=[{id:row.id,version:row.version}];const result:any={...saved,sections:{}};let count=0;
 for(const [section,items] of Object.entries(saved.sections)){
  const expanded:any[]=[];
  for(const b of items){requireThat(--budget.remaining>=0,400,'展开后最多150个组件');if(b.type==='subreport'){
   requireThat(b.reportId,400,'请选择子报表');const child=(await document(user,b.reportId!)).row;requireThat(child.project_id===row.project_id,403,'子报表必须属于当前项目');
   const nested=await expandReport(user,child,[...trail,row.id],budget);versions.push(...nested.versions);
   expanded.push({id:b.id,type:'title',text:b.title||child.name,pageBreakBefore:b.pageBreakBefore,keepTogether:b.keepTogether},...Object.values(nested.layout.sections).flat().map((item:any)=>({...item,id:b.id+':'+item.id})));
  }else expanded.push(b)}
  count+=expanded.length;requireThat(count<=150,400,'展开后最多150个组件');result.sections[section]=expanded;
 }
 return {layout:result,versions};
}
reportDocuments.get('/report-documents/:id/expanded',async(req,res)=>{const {row}=await document(req.user.id,id.parse(req.params.id));res.json({...(await expandReport(req.user.id,row)),project_id:row.project_id})});
reportDocuments.get("/report-sources", (_req, res) => res.json({ sources, chartTypes }));
reportDocuments.get("/projects/:project/report-datasets", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  const tables = (await pool.query("SELECT t.*,d.name AS department_name FROM data_tables t JOIN departments d ON d.id=t.department_id WHERE t.project_id=$1 ORDER BY d.name,t.name", [a.id])).rows;
  const views = await publicViewCatalog(req.user.id,a.id);
  res.json([...tables.filter((table) => tableAllowed(a, table)),...views].map((table) => {
    const fields = reportFields(a, table);
    return { id: table.id, name: table.name, department: table.is_view?'public':table.department_name, is_view:!!table.is_view,
      fields:fields.detailFields.map((f:any)=>({id:f.id,name:f.name})),
      dimensions: [{ id: "__status__", name: table.is_view?'视图结果':'审批状态' }, ...(!table.is_view?[{ id: "__created_month__", name: "创建月份" }]:[]), ...fields.dimensions.map((f: any) => ({ id: f.id, name: f.name }))],
      metrics: [{ id: "__count__", name: "记录数" }, ...fields.metrics.map((f: any) => ({ id: f.id, name: f.name, unit: f.unit || "" }))],
      dates: [...(!table.is_view?[{ id: "__created_date__", name: "记录创建日期（UTC）" }]:[]), ...fields.dates.map((f: any) => ({ id: f.id, name: f.name }))],
    };
  }));
});
reportDocuments.get("/projects/:project/report-departments", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  res.json((await pool.query("SELECT id,name FROM departments WHERE project_id=$1" + (!canManage(a) && a.department_id ? " AND id=$2" : "") + " ORDER BY name", !canManage(a) && a.department_id ? [a.id, a.department_id] : [a.id])).rows);
});
reportDocuments.get("/projects/:project/report-documents", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  const rows=(await pool.query('SELECT * FROM report_documents WHERE project_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC',[a.id])).rows;
  res.json((await readableReports(a,rows)).map(({id,name,version,created_at,updated_at,created_by,layout})=>({id,name,version,created_at,updated_at,category:layout?.category||null,cadence:layout?.template?.cadence||null,can_edit:canManage(a)||a.can_export&&created_by===req.user.id})));
});
reportDocuments.post('/projects/:project/report-templates/install',async(req,res)=>{const a=await access(req.user.id,id.parse(req.params.project));requireThat(canManage(a));res.json(await tx(c=>installReportTemplates(c,a,req.user.id)))});
reportDocuments.post("/projects/:project/report-documents", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(canManage(a) || a.can_export);
  const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  const reportId = uid();
  const result = await pool.query("INSERT INTO report_documents(id,project_id,name,layout,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *", [reportId, a.id, name, JSON.stringify(defaultLayout(name)), req.user.id]);
  await audit(pool, a.workspace_id, req.user.id, "report.create", reportId, { name });
  res.status(201).json(result.rows[0]);
});
reportDocuments.get("/report-documents/:id", async (req, res) => {
  res.json((await document(req.user.id, id.parse(req.params.id))).row);
});
reportDocuments.post("/report-documents/:id/duplicate", async (req, res) => {
  const { row, permission } = await document(req.user.id, id.parse(req.params.id));
  requireThat(canManage(permission) || permission.can_export);
  const copyId = uid();
  const name = `${row.name} · 副本`.slice(0, 120);
  const copied = await pool.query("INSERT INTO report_documents(id,project_id,name,layout,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *", [copyId, row.project_id, name, row.layout, req.user.id]);
  await audit(pool, permission.workspace_id, req.user.id, "report.duplicate", copyId, { source: row.id });
  res.status(201).json(copied.rows[0]);
});
reportDocuments.delete("/report-documents/:id", async (req, res) => {
  const { row, permission } = await document(req.user.id, id.parse(req.params.id));
  requireThat(row.can_edit);
  await pool.query("UPDATE report_documents SET deleted_at=now(),updated_at=now() WHERE id=$1", [row.id]);
  await audit(pool, permission.workspace_id, req.user.id, "report.delete", row.id, { name: row.name });
  res.json({ ok: true });
});
reportDocuments.put("/report-documents/:id", async (req, res) => {
  const { row, permission } = await document(req.user.id, id.parse(req.params.id));
  requireThat(row.can_edit);
  const body = z.object({ name: z.string().trim().min(1).max(120), version: z.number().int().positive(), layout }).parse(req.body);
  const blocks = Object.values(body.layout.sections).flat();
  requireThat(new Set(blocks.map((b) => b.id)).size === blocks.length, 400, "报表组件编号重复");
  for(const b of blocks){if(b.formula){try{parseReportFormula(b.formula)}catch(e:any){throw new HttpError(400,e.message)}requireThat(!b.detailFields?.length&&!b.dimension2,400,"公式暂用于聚合结果，请移除明细或交叉统计配置")}if(b.type==='subreport')requireThat(!!b.reportId,400,"请选择子报表")}
  await expandReport(req.user.id,{...row,layout:body.layout});
  for (const b of blocks) if (["chart", "table", "kpi", "assessment"].includes(b.type)) {
    if (b.source === "business_table") {
      requireThat(!!b.tableId && !!b.dimension && !!b.metric, 400, "请选择业务表及字段");
      const { table, permission: tablePermission } = await businessTable(req.user.id, row.project_id, b.tableId!, b.dimension!, b.metric!);
      requireThat(!b.detailFields?.length||(b.type==='table'&&!b.dimension2&&b.detailFields.every(id=>reportFields(tablePermission,table).detailFields.some((f:any)=>f.id===id))),403,'明细字段不可用或无权限');
      const fields = reportFields(tablePermission, table);
      if(b.xMetric)await businessTable(req.user.id,row.project_id,b.tableId!,b.dimension!,b.xMetric);
      if (b.dimension2) {
        requireThat(b.type === "table", 400, "交叉统计仅支持业务表的数据表组件");
        requireThat(b.dimension2 !== b.dimension, 400, "行列维度不能相同");
        await businessTable(req.user.id, row.project_id, b.tableId!, b.dimension2, b.metric!);
      }
      requireThat(!b.filterValue || !!b.filterField, 400, "请选择筛选字段");
      requireThat(!b.filterField || fields.dimensions.some((f: any) => f.id === b.filterField), 403, "筛选字段不可用或无权限");
      requireThat(!b.dateField || (!table.is_view && b.dateField === "__created_date__") || fields.dates.some((f: any) => f.id === b.dateField), 403, "日期字段不可用或无权限");
      requireThat(!b.dateFrom || !b.dateTo || b.dateFrom <= b.dateTo, 400, "结束日期不能早于开始日期");
      requireThat(b.metric !== "__count__" || !b.aggregation || b.aggregation === "count", 400, "记录数只能使用计数汇总");
    } else {
      requireThat(!b.dimension2, 400, "交叉统计请使用业务数据表");
      const source = sources[b.source || "record_summary"];
      requireThat(!!source && !!b.dimension && Object.hasOwn(source.dimensions, b.dimension) && !!b.metric && Object.hasOwn(source.metrics, b.metric), 400, "报表数据字段不受支持");
      if (b.departmentId) {
        requireThat(canManage(permission) || !permission.department_id || permission.department_id === b.departmentId, 403, "没有该部门的数据权限");
        requireThat((await pool.query("SELECT 1 FROM departments WHERE id=$1 AND project_id=$2", [b.departmentId, row.project_id])).rowCount, 400, "部门不属于当前项目");
      }
    }
  }
  const saved = await pool.query("UPDATE report_documents SET name=$1,layout=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 RETURNING *", [body.name, JSON.stringify(body.layout), row.id, body.version]);
  if (!saved.rowCount) throw new HttpError(409, "报表已被其他人修改，请刷新后重试");
  await audit(pool, permission.workspace_id, req.user.id, "report.update", row.id, { name: body.name });
  res.json(saved.rows[0]);
});
const seriesInput = z.object({ detailFields:z.preprocess(v=>typeof v==='string'?v.split(',').filter(Boolean):v,z.array(z.string().max(40)).max(12).optional()), xMetric:z.string().max(50).optional(), source: z.enum(["record_summary", "activity_progress", "resource_cost", "business_table"]), dimension: z.string(), dimension2: z.string().max(50).optional(), metric: z.string(), tableId: id.optional(), aggregation: z.enum(["count", "sum", "average", "min", "max"]).optional(), status: z.enum(["approved", "pending", "draft", "all"]).optional(), filterField: z.string().max(50).optional(), filterOperator: z.enum(["equals", "contains"]).optional(), filterValue: z.string().max(160).optional(), datePreset:z.enum(["day","week","fortnight","month"]).optional(), dateField: z.string().max(50).optional(), dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(), departmentId: id.optional() });
type SeriesInput = z.infer<typeof seriesInput>;
type SeriesResult = { details?:{columns:{id:string;name:string}[];rows:string[][];total:number;limit:number}; rows: { label: string; value: string | number; x?:string }[]; overall: string | number; groupCount: number; matched?: number; missingValues?:number; sampled?: number; limit?: number; pivot?: ReportPivot };
export async function reportSeries(user: string, projectId: string, input: SeriesInput): Promise<SeriesResult> {
  input=resolveReportPeriod(input,new Date(),process.env.REPORT_TIME_ZONE||"Europe/Helsinki");
  const a = await access(user, projectId);
  if(['activity_progress','resource_cost'].includes(input.source))await requireFullPlanRead(a);
  if (input.source === "business_table") {
    requireThat(!!input.tableId, 400, "请选择业务数据表");
    const { table, permission } = await businessTable(user, a.id, input.tableId!, input.dimension, input.metric);
    const fields = reportFields(permission, table);
    const detailFields=(input.detailFields||[]).map(id=>fields.detailFields.find((f:any)=>f.id===id));
    requireThat(detailFields.every(Boolean)&&!(detailFields.length&&input.dimension2),403,'明细字段不可用或无权限');
    if(input.xMetric)await businessTable(user,a.id,input.tableId!,input.dimension,input.xMetric);
    if (input.dimension2) {
      requireThat(input.dimension2 !== input.dimension, 400, "行列维度不能相同");
      await businessTable(user, a.id, input.tableId!, input.dimension2, input.metric);
    }
    requireThat(!input.filterValue || !!input.filterField, 400, "请选择筛选字段");
    requireThat(!input.filterField || fields.dimensions.some((f: any) => f.id === input.filterField), 403, "筛选字段不可用或无权限");
    requireThat(!input.dateField || (!table.is_view && input.dateField === "__created_date__") || fields.dates.some((f: any) => f.id === input.dateField), 403, "日期字段不可用或无权限");
    requireThat(!input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo, 400, "结束日期不能早于开始日期");
    const aggregation: ReportAggregation = input.metric === "__count__" ? "count" : input.aggregation || "sum";
    requireThat(input.metric !== "__count__" || !input.aggregation || input.aggregation === "count", 400, "记录数只能使用计数汇总");
    const status = input.status || "approved";
    const own = !canManage(permission) && permission.row_scope === "own";
    const params: unknown[] = [table.id];
    let where = "table_id=$1 AND lifecycle='active' AND status='approved'";
    const append = (value: unknown) => { params.push(value); return `$${params.length}`; };
    if (status !== "all") where += ` AND status=${append(status)}`;
    if (own) where += ` AND created_by=${append(user)}`;
    const filterColumn = fields.dimensions.find((f: any) => f.id === input.filterField);
    // JSONB and JavaScript use different text representations for floating-point exponents.
    // Numeric filters run against the projected field values instead of SQL text casts.
    if (filterColumn && input.filterValue && filterColumn.type !== "formula" && !dateTypes.has(filterColumn.type) && !numericTypes.includes(filterColumn.type)) {
      const key = append(input.filterField);
      const value = append(input.filterValue.trim());
      where += input.filterOperator === "contains"
        ? ` AND POSITION(LOWER(${value}::text) IN LOWER(BTRIM(COALESCE(data->>${key}::text,''))))>0`
        : ` AND LOWER(BTRIM(COALESCE(data->>${key}::text,'')))=LOWER(${value}::text)`;
    }
    const storedDate = fields.dates.find((f: any) => f.id === input.dateField && ["date", "timestamp", "timestamptz"].includes(f.type));
    if (input.dateFrom || input.dateTo) {
      if (!input.dateField || input.dateField === "__created_date__") {
        if (input.dateFrom) where += ` AND created_at>=${append(input.dateFrom)}::date`;
        if (input.dateTo) where += ` AND created_at<(${append(input.dateTo)}::date+interval '1 day')`;
      } else if (storedDate) {
        const key = append(input.dateField);
        if (input.dateFrom) where += ` AND LEFT(data->>${key}::text,10)>=${append(input.dateFrom)}::text`;
        if (input.dateTo) where += ` AND LEFT(data->>${key}::text,10)<=${append(input.dateTo)}::text`;
      }
    }
    const records = table.is_view ? (await executeView(user,a.id,table.definition)).rows : (await pool.query(`SELECT * FROM records WHERE ${where} ORDER BY created_at DESC LIMIT 10001`, params)).rows;
    requireThat(records.length <= 10000, 400, "报表当前最多统计10000条记录，请缩小筛选范围");
    const groups = new Map<string, unknown[]>();
    const xGroups=new Map<string,unknown[]>();
    const allValues: unknown[] = [];
    const detailRows:string[][]=[];
    const pivotEntries: { row: string; column: string; value: unknown }[] = [];
    const names: Record<string, string> = table.is_view ? {approved:'视图结果'} : { approved: "已审核", pending: "待审核", draft: "草稿", rejected: "已退回" };
    for (const record of records) {
      if (!table.is_view && !rowAllowed(permission, record, user)) continue;
      const projected = table.is_view ? record : projectRecord(permission, table, record);
      if (!matchesReportFilters(projected.data, record.created_at, input)) continue;
      if(detailFields.length)detailRows.push(detailFields.map((f:any)=>{const v=projected.data[f.id];return v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);}));
      const raw = input.dimension === "__status__" ? names[record.status] || record.status : input.dimension === "__created_month__" ? new Date(record.created_at).toISOString().slice(0, 7) : projected.data[input.dimension];
      const label = raw === null || raw === undefined || raw === "" ? "未填写" : typeof raw === "boolean" ? raw ? "是" : "否" : String(raw).slice(0, 160);
      if (!groups.has(label)) groups.set(label, []);
      const value = input.metric === "__count__" ? 1 : projected.data[input.metric];
      groups.get(label)!.push(value);
      if(input.xMetric){if(!xGroups.has(label))xGroups.set(label,[]);xGroups.get(label)!.push(input.xMetric==='__count__'?1:projected.data[input.xMetric]);}
      allValues.push(value);
      if (input.dimension2) {
        const second = input.dimension2 === "__status__" ? names[record.status] || record.status : input.dimension2 === "__created_month__" ? new Date(record.created_at).toISOString().slice(0, 7) : projected.data[input.dimension2];
        pivotEntries.push({ row: label, column: second === null || second === undefined || second === "" ? "未填写" : typeof second === "boolean" ? second ? "是" : "否" : String(second).slice(0, 160), value });
      }
    }
    const applicable = (values: unknown[]) => aggregation === "count" && input.metric !== "__count__" ? values.filter((value) => value !== null && value !== undefined && value !== "") : values;
    const rows = [...groups].map(([label, values]) => ({ label, value: aggregateReportValues(applicable(values), aggregation),...(input.xMetric?{x:aggregateReportValues(xGroups.get(label)||[],input.xMetric==='__count__'?'count':input.aggregation||'sum')}:{}) }))
      .sort((x, y) => Number(y.value) - Number(x.value)).slice(0, 30);
    return { ...(detailFields.length?{details:{columns:detailFields.map((f:any)=>({id:f.id,name:f.name})),rows:detailRows.slice(0,100),total:detailRows.length,limit:100}}:{}),rows, overall: (["quantity_key","stock_key"].includes(input.dimension)&&input.metric!=="__count__"&&groups.size>1)?"分项计量，不汇总总量":aggregateReportValues(applicable(allValues), aggregation), sampled: records.length, matched: allValues.length, missingValues:allValues.filter(v=>v===null||v===undefined||v==='').length, groupCount: groups.size, limit: 10000,
      ...(input.dimension2 ? { pivot: aggregateReportPivot(pivotEntries, aggregation, input.metric !== "__count__") } : {}) };
  }
  requireThat(!input.xMetric,400,"真实X指标请使用业务表或public视图数据源");
  const source = sources[input.source];
  requireThat(!input.dimension2, 400, "交叉统计请使用业务数据表");
  requireThat(Object.hasOwn(source.dimensions, input.dimension) && Object.hasOwn(source.metrics, input.metric), 400, "不支持的数据维度或指标");
  const departmentId = !canManage(a) && a.department_id ? a.department_id : input.departmentId;
  requireThat(!input.departmentId || canManage(a) || !a.department_id || a.department_id === input.departmentId, 403, "没有该部门的数据权限");
  let departmentName: string | undefined;
  if (departmentId) {
    const dept = (await pool.query("SELECT name FROM departments WHERE id=$1 AND project_id=$2", [departmentId, a.id])).rows[0];
    requireThat(!!dept, 400, "部门不属于当前项目");
    departmentName = dept.name;
  }
  if (input.source === "record_summary") {
    const result = await summary(user, a.id);
    const groups = new Map<string, number>();
    for (const t of result.tables) {
      if (departmentName && t.department !== departmentName) continue;
      const label = input.dimension === "department" ? t.department : t.name;
      groups.set(label, (groups.get(label) || 0) + Number(t[input.metric as "total"]));
    }
    const all = [...groups].map(([label, value]) => ({ label, value }));
    return { rows: all.sort((x, y) => y.value - x.value).slice(0, 30), overall: all.reduce((total, row) => total + row.value, 0), groupCount: groups.size };
  }
  const column = input.dimension;
  const metric = sqlMetrics[input.source][input.metric];
  const where = `project_id=$1${departmentId ? " AND department_id=$2" : ""}`;
  const params = departmentId ? [a.id, departmentId] : [a.id];
  const [grouped, total] = await Promise.all([
    pool.query(`SELECT COALESCE(${column}::text,'未设置') AS label, ${metric} AS value, COUNT(*) OVER() AS group_count FROM analytics.${input.source} WHERE ${where} GROUP BY ${column} ORDER BY value DESC NULLS LAST LIMIT 30`, params),
    pool.query(`SELECT ${metric} AS value FROM analytics.${input.source} WHERE ${where}`, params),
  ]);
  const kinds: Record<string, string> = { human: "人力", equipment: "设备", material: "材料", expense: "费用" };
  return { rows: grouped.rows.map((r) => ({ label: input.dimension === "resource_kind" ? kinds[r.label] || r.label : r.label, value: r.value ?? "0" })), overall: total.rows[0]?.value ?? "0", groupCount: Number(grouped.rows[0]?.group_count || 0) };
}
reportDocuments.get("/projects/:project/report-series", async (req, res) => {
  res.json(await reportSeries(req.user.id, id.parse(req.params.project), seriesInput.parse(req.query)));
});

const scopeKey = (a: any) => JSON.stringify([a.role, a.department_id, [...a.table_ids].sort(), [...a.hidden_columns].sort(), a.row_scope, a.can_export, a.expires_at, a.revision]);
const tableKey = (table: any) => JSON.stringify([table.object_version, table.department_id, table.lifecycle, table.columns,table.definition,table.source_revisions]);
export async function generateReportWorkbook(user:string,documentId:string,expected?:number,timeZone?:string) {
  const { row, permission } = await document(user, documentId);
  requireThat(canManage(permission) || permission.can_export);
  requireThat(expected===undefined || row.version === expected, 409, "报表已被修改，请刷新后重新导出");
  const expanded=await expandReport(user,row);
  const saved = expanded.layout as z.infer<typeof layout>;
  const sectionNames = { header: "页眉", detail: "明细", summary: "汇总", footer: "页脚" };
  const blocks = Object.entries(saved.sections).flatMap(([section, items]) => items.map((item) => ({ ...item, section: sectionNames[section as keyof typeof sectionNames] })));
  const dataBlocks = blocks.filter((b) => ["chart", "table", "kpi", "assessment"].includes(b.type));
  requireThat(dataBlocks.length <= 60, 400, "Excel单次最多导出60个统计组件，请拆分报表");
  const { createReportWorkbook } = await import("./report-workbook.ts");
  const generatedAt = new Date();
  const datasets = new Map<string, { table: any; permission: any; key: string }>();
  const seriesCache = new Map<string, SeriesResult>();
  const assessmentNotes:{section:string;text:string}[]=[];
  const exports: import("./report-workbook.ts").ReportExportData[] = [];
  const departments = (await pool.query("SELECT id,name FROM departments WHERE project_id=$1", [row.project_id])).rows;
  const statusNames: Record<string, string> = { approved: "已审核", pending: "待审核", draft: "草稿", all: "全部有效状态" };
  const aggregationNames: Record<string, string> = { count: "计数", sum: "求和", average: "平均值", min: "最小值", max: "最大值" };
  for (const b of dataBlocks) {
    requireThat(!b.periodRequired || !!b.dateFrom&&!!b.dateTo,400,'请先设置报表统计起止日期');
    const input = resolveReportPeriod(seriesInput.parse({ ...b, source: b.source || "record_summary", dimension: b.dimension || "table", metric: b.metric || "total" }),generatedAt,timeZone||process.env.REPORT_TIME_ZONE||"Europe/Helsinki");
    const key = JSON.stringify(input);
    let result = seriesCache.get(key);
    if (!result) { result = await reportSeries(user, row.project_id, input); seriesCache.set(key, result); }
    const filters: string[] = [];
    let sourceName: string, dimensionName: string, metricName: string, aggregation: string;
    let columnDimension: string | undefined;
    if (input.source === "business_table") {
      let dataset = datasets.get(input.tableId!);
      if (!dataset) {
        const current = await businessTable(user, row.project_id, input.tableId!, input.dimension, input.metric);
        dataset = { ...current, key: tableKey(current.table) };
        datasets.set(input.tableId!, dataset);
      }
      const fields = reportFields(dataset.permission, dataset.table);
      sourceName = `${dataset.table.is_view?'public':departments.find((d) => d.id === dataset.table.department_id)?.name || "部门"} · ${dataset.table.name}`;
      dimensionName = input.dimension === "__status__" ? (dataset.table.is_view?'视图结果':"审批状态") : input.dimension === "__created_month__" ? "创建月份" : fields.dimensions.find((f: any) => f.id === input.dimension)?.name || "分组";
      columnDimension = input.dimension2 === "__status__" ? "审批状态" : input.dimension2 === "__created_month__" ? "创建月份" : fields.dimensions.find((f: any) => f.id === input.dimension2)?.name;
      const metric = fields.metrics.find((f: any) => f.id === input.metric);
      metricName = input.metric === "__count__" ? "记录数" : `${metric?.name || "统计值"}${metric?.unit ? `（${metric.unit}）` : ""}`;
      aggregation = aggregationNames[input.metric === "__count__" ? "count" : input.aggregation || "sum"];
      filters.push(dataset.table.is_view?`源记录状态（视图定义）：${statusNames[dataset.table.definition.status]}`:`记录状态：${statusNames[input.status || "approved"]}`);
      if (input.filterField && input.filterValue) filters.push(`${fields.dimensions.find((f: any) => f.id === input.filterField)?.name} ${input.filterOperator === "contains" ? "包含" : "等于"} ${input.filterValue}`);
      if (input.dateFrom || input.dateTo) {
        const dateName = !input.dateField || input.dateField === "__created_date__" ? "记录创建日期（UTC）" : fields.dates.find((f: any) => f.id === input.dateField)?.name;
        filters.push(`${dateName}：${input.dateFrom || "不限"} 至 ${input.dateTo || "不限"}`);
      }
    } else {
      requireThat(!input.xMetric,400,"真实X指标请使用业务表或public视图数据源");
  const source = sources[input.source];
      sourceName = source.label;
      dimensionName = (source.dimensions as Record<string, string>)[input.dimension];
      metricName = (source.metrics as Record<string, string>)[input.metric];
      aggregation = input.metric === "progress" ? "平均值" : "求和";
      const departmentId = !canManage(permission) && permission.department_id ? permission.department_id : input.departmentId;
      if (departmentId) filters.push(`部门：${departments.find((d) => d.id === departmentId)?.name}`);
    }
    if(b.type==='assessment')assessmentNotes.push({section:b.section,text:reportAssessment({...b,...input},result,sourceName)});
    exports.push({xMetric:input.xMetric,title: b.title || metricName, section: b.section, source: sourceName, dimension: dimensionName, columnDimension, metric: metricName, aggregation, filters, ...formulaSeries(result,b.formula) });
  }
  const workbook = createReportWorkbook({ name: row.name, project: permission.name, version: row.version, user: (await pool.query("SELECT name FROM users WHERE id=$1",[user])).rows[0]?.name || "", generatedAt,timeZone:timeZone||process.env.REPORT_TIME_ZONE||"Europe/Helsinki",
    notes: [...assessmentNotes,...blocks.filter((b) => ["title", "text"].includes(b.type) && b.text).map((b) => ({ section: b.section, text: b.text! }))],
  }, exports);
  for(const sheet of workbook.worksheets){const p=saved.page;if(p){sheet.pageSetup={...sheet.pageSetup,paperSize:(p.paper==='A3'?8:p.paper==='Letter'?1:9) as import('exceljs').PaperSize,orientation:p.orientation,margins:{left:p.margin/25.4,right:p.margin/25.4,top:p.margin/25.4,bottom:p.margin/25.4,header:0.2,footer:0.2}};sheet.headerFooter.oddHeader='&C'+(p.header||'').replace(/&/g,'&&');sheet.headerFooter.oddFooter='&L'+(p.footer||'').replace(/&/g,'&&')+(p.pageNumbers?'&R第 &P 页 / 共 &N 页':'')}}
  const buffer = await workbook.xlsx.writeBuffer();
  // Reject the whole file if grants or table structure moved while it was being built.
  const currentPermission = await access(user, row.project_id);
  requireThat(scopeKey(currentPermission) === scopeKey(permission), 409, "权限在导出期间发生变化，请刷新后重试");
  for (const [tableId, dataset] of datasets) {
    const view=await getPublicView(user,tableId);
    const current = view ? {table:view} : await tableAccess(user, tableId);
    requireThat(tableKey(current.table) === dataset.key, 409, "数据表在导出期间发生变化，请刷新后重试");
  }
  for(const ref of expanded.versions){const check=(await pool.query('SELECT version,deleted_at FROM report_documents WHERE id=$1',[ref.id])).rows[0];requireThat(check&&!check.deleted_at&&check.version===ref.version,409,'子报表在导出期间发生变化，请重试')}
  const current = (await pool.query("SELECT version,deleted_at FROM report_documents WHERE id=$1", [row.id])).rows[0];
  requireThat(current && !current.deleted_at && current.version === row.version, 409, "报表在导出期间发生变化，请刷新后重试");
  await audit(pool, permission.workspace_id, user, "report.export", row.id, { version: row.version, components: exports.length });
  return {buffer:Buffer.from(buffer),name:row.name,version:row.version};
}
reportDocuments.get("/report-documents/:id/export.xlsx", async(req,res)=>{
 const result=await generateReportWorkbook(req.user.id,id.parse(req.params.id),z.coerce.number().int().positive().parse(req.query.version));
 res.set("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent(result.name)}.xlsx`).type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(result.buffer);
});

export async function captureTemplateSnapshot(user:string,projectId:string,reportId:string,range?:{dateFrom?:string;dateTo?:string}){
 const {row,permission}=await document(user,reportId);requireThat(row.project_id===projectId,403,'报表不属于当前项目');requireThat(canManage(permission)||permission.can_export);
 const expanded=await expandReport(user,row),generatedAt=new Date(),blocks:any[]=[],checks:any[]=[];const cache=new Map<string,SeriesResult>();
 for(const b of Object.values(expanded.layout.sections).flat() as any[]){
  if(!['chart','table','kpi','assessment'].includes(b.type)){blocks.push({block:b});continue;}
  const configured={...b,...(b.dateField&&range?.dateFrom&&range?.dateTo?{datePreset:undefined,...range}:{})};requireThat(!configured.periodRequired||configured.dateFrom&&configured.dateTo,400,'请先设置报表统计起止日期');
  const input=resolveReportPeriod(seriesInput.parse({...configured,source:configured.source||'record_summary',dimension:configured.dimension||'table',metric:configured.metric||'total'}),generatedAt,process.env.REPORT_TIME_ZONE||'Europe/Helsinki');
  const key=JSON.stringify(input);let result=cache.get(key);if(!result){result=await reportSeries(user,row.project_id,input);cache.set(key,result)}
  let sourceName='项目授权统计';if(input.source==='business_table'){const {table,permission:a}=await businessTable(user,row.project_id,input.tableId!,input.dimension,input.metric);sourceName=table.name;const fields=reportFields(a,table);const needed=[input.dimension,input.dimension2,input.metric,input.xMetric,input.filterField,input.dateField,...(input.detailFields||[])].filter((v:any)=>v&&!v.startsWith('__'));requireThat(needed.every(id=>[...fields.dimensions,...fields.metrics,...fields.dates,...fields.detailFields].some((f:any)=>f.id===id)),403,'快照字段不可用或无权限');checks.push({tableId:table.id,dimension:input.dimension,metric:input.metric,fields:needed});}
  const data=formulaSeries(result,b.formula);blocks.push({block:{...configured,...input},data,sourceName,...(b.type==='assessment'?{assessment:reportAssessment({...configured,...input},data,sourceName)}:{})});
 }
 requireThat(cache.size<=60,400,'快照最多60个统计组件');
 return {kind:'template_report',project:{id:projectId,name:permission.name},reportName:row.name,category:row.layout.category||'未分类',cadence:row.layout.template?.cadence,reportId:row.id,reportVersion:row.version,generatedAt:generatedAt.toISOString(),blocks,checks,permissionKey:scopeKey(permission),access_scope:{row_scope:canManage(permission)?'all':permission.row_scope,user_id:user}};
}
export async function verifyTemplateSnapshot(user:string,projectId:string,snapshot:any){
 const a=await access(user,projectId);requireThat(scopeKey(a)===snapshot.permissionKey,403,'权限范围已变化，请重新生成报表');
 for(const check of snapshot.checks||[]){const {table,permission}=await businessTable(user,projectId,check.tableId,check.dimension,check.metric);const fields=reportFields(permission,table);requireThat(check.fields.every((id:string)=>[...fields.dimensions,...fields.metrics,...fields.dates,...fields.detailFields].some((f:any)=>f.id===id)),403,'快照字段权限已变化，请重新生成报表');}
}
