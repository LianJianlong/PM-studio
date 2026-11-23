import {projectLedger} from './dashboard-ledger.ts';
import {projectProgress,projectEarned,projectTodos} from './dashboard-native.ts';
import { Router } from "express";
import { z } from "zod";
import { pool, tx, audit } from "./db.ts";
import {
  access,
  canManage,
  tableAllowed,
  tableAccess,
  visibleColumns,
  rowAllowed,
  requireThat,
  projectRecord,
} from "./auth.ts";
import { id } from "./validation.ts";
import { reportSeries } from "./report-documents.ts";
import { exactSum } from "../shared/fields.ts";
import { evaluateFormula } from "../shared/formulas.ts";
import {
  publicViewCatalog,
  getPublicView,
  executeView,
} from "./public-views.ts";
export const projectDashboard = Router();
const titles = {
  progress: "进度S曲线（计划与实际对比）",
  safety: "安全隐患台账",
  quality: "质量统计台账",
  design: "设计进展",
  procurement: "采购进展",
  earned: "净值计算（挣值）",
  todo: "待办事项与逾期分布",
};
const config = z.object({
  sourceMode:z.enum(["project_plan","earned_snapshots","project_todos","priority_ledger"]).optional(),
  templateKey:z.string().max(100).optional(),
  gaugeMax:z.coerce.number().finite().positive().max(1e15).default(100),
  xMetric:z.string().max(50).optional(),
  displayMode: z.enum(['default','table','chart']).default('default'),
  mappingId: id.optional(),
  chartType: z
    .enum([
      "bar",
      "horizontalBar",
      "line",
      "area",
      "pie",
      "donut",
      "scatter",
      "radar",
      "funnel",
      "gauge",
    ])
    .default("bar"),
  dimension: z.string().max(50).default("__status__"),
  metric: z.string().max(50).default("__count__"),
  aggregation: z
    .enum(["count", "sum", "average", "min", "max"])
    .default("count"),
  status: z.enum(["approved", "pending", "draft", "all"]).default("approved"),
  dateField: z.string().max(50).optional(),
  plannedField: z.string().max(50).optional(),
  actualField: z.string().max(50).optional(),
  pvField: z.string().max(50).optional(),
  evField: z.string().max(50).optional(),
  acField: z.string().max(50).optional(),
});
export async function publicMappings(user: string, project: string) {
  const a = await access(user, project);
  const rows = (
    await pool.query(
      "SELECT t.*,m.id AS mapping_id,d.name AS department_name FROM project_public_mappings m JOIN data_tables t ON t.id=m.source_table_id JOIN departments d ON d.id=t.department_id WHERE m.project_id=$1 AND t.project_id=$1 ORDER BY d.name,t.name",
      [project],
    )
  ).rows;
  const mappings = rows
    .filter((t) => tableAllowed(a, t))
    .map((t) => ({
      id: t.mapping_id,
      source_table_id: t.id,
      name: `${t.department_name} · ${t.name}`,
      department_name: t.department_name,
      department_id: t.department_id,
      columns: visibleColumns(a, t),
      lifecycle: t.lifecycle,
      object_version: t.object_version,
      is_mapping: true,
    }));
  return [...mappings, ...(await publicViewCatalog(user, project))];
}
projectDashboard.get("/projects/:project/public", async (req, res) =>
  res.json({
    folder: "public",
    tables: await publicMappings(req.user.id, id.parse(req.params.project)),
  }),
);
async function widgetData(user: string, project: string, w: any) {
  const b = config.parse(w.config);
  if (!b.mappingId)
    return { ...w, data: null, message: "请绑定public映射表及统计字段" };
  const mapping = (
    await pool.query(
      "SELECT source_table_id FROM project_public_mappings WHERE id=$1 AND project_id=$2",
      [b.mappingId, project],
    )
  ).rows[0];
  const view = await getPublicView(user, b.mappingId);
  const source = !mapping && !view ? await tableAccess(user,b.mappingId) : null;
  requireThat(
    mapping || (view && view.project_id === project) || source?.table.project_id===project,
    404,
    "视图已移除或不属于当前项目",
  );
  const tableId = view ? view.id : mapping?.source_table_id || source!.table.id;
  if(b.sourceMode==='priority_ledger'&&b.displayMode==='default')return {...w,data:await projectLedger(user,project,tableId,w.kind,b.status,1)};
  if(w.kind==='progress'&&b.sourceMode==='project_plan'&&b.displayMode==='default')return {...w,data:await projectProgress(user,project,tableId)};
  if(w.kind==='earned'&&b.sourceMode==='earned_snapshots'&&b.displayMode==='default')return {...w,data:await projectEarned(user,project,tableId,b)};
  if(w.kind==='todo'&&b.sourceMode==='project_todos'&&b.displayMode==='default')return {...w,data:await projectTodos(user,project,tableId)};
  if(b.displayMode==='table')return {...w,data:await dashboardTable(user,project,tableId,b.status,1)};
  const series = (
    metric: string,
    aggregation: "sum" | "count" | "average" | "min" | "max" = b.aggregation,
  ) =>
    reportSeries(user, project, {
      source: "business_table",
      tableId,
      dimension: b.dimension,
      metric,
      aggregation,
      status: b.status,
      ...(b.chartType==='scatter'&&b.xMetric?{xMetric:b.xMetric}:{}),
    });
  if (w.kind === "earned" && b.displayMode!=='chart') {
    requireThat(
      b.pvField && b.evField && b.acField,
      400,
      "请选择PV、EV、AC字段",
    );
    const [pv, ev, ac] = await Promise.all([
      series(b.pvField, "sum"),
      series(b.evField, "sum"),
      series(b.acField, "sum"),
    ]);
    const values = {
      pv: String(pv.overall),
      ev: String(ev.overall),
      ac: String(ac.overall),
    };
    return {
      ...w,
      data: {
        ...values,
        cv: evaluateFormula("[ev]-[ac]", values),
        sv: evaluateFormula("[ev]-[pv]", values),
        cpi: evaluateFormula("IF([ac]=0,null,[ev]/[ac])", values),
        spi: evaluateFormula("IF([pv]=0,null,[ev]/[pv])", values),
      },
    };
  }
  if (w.kind === "progress" && b.displayMode!=='chart') {
    requireThat(
      b.plannedField && b.actualField && b.dateField,
      400,
      "请选择日期、当日计划量及当日实际量字段",
    );
    // Reuse the statistical engine to validate numeric/date field permissions.
    await Promise.all([
      series(b.plannedField, "sum"),
      series(b.actualField, "sum"),
    ]);
    const virtual = view
      ? await executeView(user, project, view.definition)
      : null;
    const { table, permission } = view
      ? { table: view, permission: await access(user, project) }
      : await tableAccess(user, tableId);
    requireThat(
      (view ? view.columns : visibleColumns(permission, table)).some(
        (f: any) =>
          f.id === b.dateField &&
          ["date", "timestamp", "timestamptz"].includes(f.type),
      ),
      403,
      "日期字段不可用或无权读取",
    );
    const own = !canManage(permission) && permission.row_scope === "own";
    const rows = virtual
      ? virtual.rows
      : (
          await pool.query(
            "SELECT * FROM records WHERE table_id=$1 AND lifecycle<>'deleted' AND status='approved' AND ($2='all' OR status=$2)" +
              (own ? " AND created_by=$3" : "") +
              " ORDER BY id LIMIT 10001",
            own ? [tableId, b.status, user] : [tableId, b.status],
          )
        ).rows;
    requireThat(rows.length <= 10000, 400, "超过10000条，请拆分台账");
    const days = new Map<string, { planned: unknown[]; actual: unknown[] }>();
    const omitted: {id:string;planned:unknown;actual:unknown}[]=[];
    for (const r of rows.filter(
      (r) => view || rowAllowed(permission, r, user),
    )) {
      const data = view ? r.data : projectRecord(permission, table, r).data;
      const date = String(data[b.dateField!] ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {omitted.push({id:r.id,planned:data[b.plannedField!],actual:data[b.actualField!]});continue;}
      const d = days.get(date) || { planned: [], actual: [] };
      d.planned.push(data[b.plannedField!]);
      d.actual.push(data[b.actualField!]);
      days.set(date, d);
    }
    let planned = "0",
      actual = "0";
    const points = [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => {
        planned = exactSum([planned, ...d.planned]);
        actual = exactSum([actual, ...d.actual]);
        return { date, planned, actual };
      });
    return { ...w, data: { points, unit: "累计量", completeness:{matched:rows.length,included:rows.length-omitted.length,omitted:omitted.length,planned:exactSum(omitted.map(r=>r.planned)),actual:exactSum(omitted.map(r=>r.actual)),recordIds:omitted.slice(0,50).map(r=>r.id),sourceTableId:tableId} } };
  }
  return { ...w, data: await series(b.metric) };
}
async function dashboardTable(user:string,project:string,tableId:string,status:string,page:number){
 const view=await getPublicView(user,tableId);
 if(view){requireThat(view.project_id===project,404,'数据源不属于项目');const r=await executeView(user,project,view.definition);return {table:{id:view.id,name:view.name,columns:view.columns},rows:r.rows.slice((page-1)*50,page*50),total:r.rows.length,page,pageSize:50};}
 const {table,permission}=await tableAccess(user,tableId);requireThat(table.project_id===project,404,'数据源不属于项目');
 const own=!canManage(permission)&&permission.row_scope==='own',params:any[]=[tableId,status];if(own)params.push(user);
 const where="table_id=$1 AND lifecycle<>'deleted' AND status='approved' AND ($2='all' OR status=$2)"+(own?' AND created_by=$3':'');
 const [rows,count]=await Promise.all([pool.query(`SELECT * FROM records WHERE ${where} ORDER BY created_at,id LIMIT 50 OFFSET ${(page-1)*50}`,params),pool.query(`SELECT count(*)::int AS total FROM records WHERE ${where}`,params)]);
 return {table:{id:table.id,name:table.name,columns:visibleColumns(permission,table)},rows:rows.rows.filter(r=>rowAllowed(permission,r,user)).map(r=>projectRecord(permission,table,r)),total:count.rows[0].total,page,pageSize:50};
}
projectDashboard.get('/projects/:project/dashboard/widgets/:widget/table',async(req,res)=>{
 const project=id.parse(req.params.project);await access(req.user.id,project);const w=(await pool.query('SELECT * FROM project_dashboard_widgets WHERE id=$1 AND project_id=$2',[id.parse(req.params.widget),project])).rows[0];requireThat(w,404,'模块不存在');const b=config.parse(w.config);requireThat(b.mappingId,400,'请配置数据源');const m=(await pool.query('SELECT source_table_id FROM project_public_mappings WHERE id=$1 AND project_id=$2',[b.mappingId,project])).rows[0];res.json(await dashboardTable(req.user.id,project,m?.source_table_id||b.mappingId,b.status,z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page)));
});
projectDashboard.get('/projects/:project/dashboard/widgets/:widget/ledger',async(req,res)=>{const project=id.parse(req.params.project);await access(req.user.id,project);const w=(await pool.query('SELECT * FROM project_dashboard_widgets WHERE id=$1 AND project_id=$2',[id.parse(req.params.widget),project])).rows[0];requireThat(w,404,'模块不存在');const b=config.parse(w.config);requireThat(b.sourceMode==='priority_ledger'&&b.mappingId,400,'未配置明细台账');const mapping=(await pool.query('SELECT source_table_id FROM project_public_mappings WHERE id=$1 AND project_id=$2',[b.mappingId,project])).rows[0];res.json(await projectLedger(req.user.id,project,mapping?.source_table_id||b.mappingId,w.kind,b.status,z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page)));});
projectDashboard.get("/projects/:project/dashboard", async (req, res) => {
  const project = id.parse(req.params.project),
    a = await access(req.user.id, project);
  // Built-in cards are shared project definitions; initialize once, with no fabricated data.
  for (const [kind, name] of Object.entries(titles))
    await pool.query(
      "INSERT INTO project_dashboard_widgets(project_id,kind,name,position) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [project, kind, name, Object.keys(titles).indexOf(kind)],
    );
  const patterns: Record<string, string> = {
    safety: "安全",
    quality: "质量",
    design: "设计",
    procurement: "采购|物资",
  };
  for (const [kind, pattern] of Object.entries(patterns))
    await pool.query(
      "UPDATE project_dashboard_widgets w SET config=jsonb_build_object('mappingId',m.id,'chartType','bar','dimension','__status__','metric','__count__','aggregation','count','status','approved'),version=version+1 FROM (SELECT m.id FROM project_public_mappings m JOIN data_tables t ON t.id=m.source_table_id JOIN departments d ON d.id=t.department_id WHERE m.project_id=$1 AND t.lifecycle='active' AND (d.name ~ $3 OR t.name ~ $3) ORDER BY (t.name ~ '台账') DESC,t.created_at LIMIT 1) m WHERE w.project_id=$1 AND w.kind=$2 AND w.config='{}'::jsonb",
      [project, kind, pattern],
    );
  const widgets = (
    await pool.query(
      "SELECT * FROM project_dashboard_widgets WHERE project_id=$1 ORDER BY position,created_at",
      [project],
    )
  ).rows;
  const result = await Promise.all(
    widgets.map(async (w) => {
      try {
        return await widgetData(req.user.id, project, w);
      } catch (error) {
        return {
          id: w.id,
          kind: w.kind,
          name: w.name,
          version: w.version,
          position: w.position,
          ...(canManage(a) ? { config: w.config } : {}),
          data: null,
          message: (error as Error).message,
        };
      }
    }),
  );
  res.json({
    widgets: result,
    can_manage: canManage(a),
    updated_at: new Date().toISOString(),
  });
});
projectDashboard.post(
  "/projects/:project/dashboard/widgets",
  async (req, res) => {
    const project = id.parse(req.params.project),
      a = await access(req.user.id, project);
    requireThat(canManage(a));
    const b = z
      .object({ name: z.string().trim().min(1).max(120), config })
      .parse(req.body);
    await widgetData(req.user.id, project, {
      kind: "custom",
      config: b.config,
    });
    const row = await tx(async (c) => {
      const result = (
        await c.query(
          "INSERT INTO project_dashboard_widgets(project_id,kind,name,config,position) VALUES($1,'custom',$2,$3,100) RETURNING id",
          [project, b.name, JSON.stringify(b.config)],
        )
      ).rows[0];
      await audit(c, a.workspace_id, req.user.id, "新增总览图表", result.id);
      return result;
    });
    res.status(201).json(row);
  },
);
projectDashboard.put(
  "/projects/:project/dashboard/widgets/:widget",
  async (req, res) => {
    const project = id.parse(req.params.project),
      a = await access(req.user.id, project);
    requireThat(canManage(a));
    const b = z
      .object({
        name: z.string().trim().min(1).max(120),
        version: z.number().int().positive(),
        config,
      })
      .parse(req.body);
    const w = (
      await pool.query(
        "SELECT * FROM project_dashboard_widgets WHERE id=$1 AND project_id=$2",
        [id.parse(req.params.widget), project],
      )
    ).rows[0];
    requireThat(w, 404, "组件不存在");
    await widgetData(req.user.id, project, { ...w, config: b.config });
    await tx(async (c) => {
      const result = await c.query(
        "UPDATE project_dashboard_widgets SET name=$1,config=$2,version=version+1 WHERE id=$3 AND project_id=$4 AND version=$5",
        [b.name, JSON.stringify(b.config), w.id, project, b.version],
      );
      requireThat(result.rowCount, 409, "组件已被修改，请刷新");
      await audit(c, a.workspace_id, req.user.id, "配置总览图表", w.id, {
        config: b.config,
      });
    });
    res.json({ ok: true });
  },
);
projectDashboard.delete(
  "/projects/:project/dashboard/widgets/:widget",
  async (req, res) => {
    const project = id.parse(req.params.project),
      a = await access(req.user.id, project);
    requireThat(canManage(a));
    await tx(async (c) => {
      const r = await c.query(
        "DELETE FROM project_dashboard_widgets WHERE id=$1 AND project_id=$2 AND kind='custom' RETURNING id",
        [id.parse(req.params.widget), project],
      );
      requireThat(r.rowCount, 409, "仅自定义图表可删除");
      await audit(
        c,
        a.workspace_id,
        req.user.id,
        "删除总览图表",
        String(req.params.widget),
      );
    });
    res.json({ ok: true });
  },
);
