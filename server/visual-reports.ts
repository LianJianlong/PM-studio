import { Router } from "express";
import { z } from "zod";
import { access, canManage, operationAllowed, requireThat, HttpError } from "./auth.ts";
import { pool, tx, uid, audit } from "./db.ts";
import { guestToken, supersetOrigin, supersetSession } from "./superset-client.ts";

export const visualReports = Router();
const uuid = z.string().uuid();
const input = z.object({
  name: z.string().trim().min(1).max(120),
  source: z.enum(["activity_progress", "resource_cost"]),
  dimension: z.string(),
  metric: z.string(),
  chart_type: z.enum(["bar", "line", "pie", "table"]),
});
const sources = {
  activity_progress: {
    dimensions: { department: "部门", activity_name: "作业名称", code: "作业编码" },
    metrics: { duration: ["SUM(duration)", "计划工期"], progress: ["AVG(progress)", "平均完成率"], completed_days: ["SUM(completed_days)", "完成工期"] },
  },
  resource_cost: {
    dimensions: { department: "部门", activity_name: "作业名称", resource_kind: "资源类型", resource_name: "资源名称" },
    metrics: { quantity: ["SUM(quantity)", "资源数量"], planned_cost: ["SUM(planned_cost)", "计划费用"], actual_cost: ["SUM(actual_cost)", "实际费用"], cost_variance: ["SUM(cost_variance)", "费用差额"] },
  },
} as const;
const vizTypes = { bar: "echarts_timeseries_bar", line: "echarts_timeseries_line", pie: "pie", table: "table" } as const;

visualReports.get("/projects/:project/visual-reports/options", async (req, res) => {
  await access(req.user.id, uuid.parse(req.params.project));
  res.json({ sources });
});
visualReports.get("/projects/:project/visual-reports", async (req, res) => {
  const a = await access(req.user.id, uuid.parse(req.params.project));
  res.json((await pool.query(
    "SELECT id,name,source,dimension,metric,chart_type,created_at FROM visual_reports WHERE project_id=$1 ORDER BY created_at DESC",
    [a.id],
  )).rows.filter(r=>r.source!=='resource_cost'||operationAllowed(a,'$data','read')));
});
visualReports.post("/projects/:project/visual-reports", async (req, res) => {
  const a = await access(req.user.id, uuid.parse(req.params.project));
  requireThat(canManage(a) || a.can_export);
  const body = input.parse(req.body);
  if(body.source==='resource_cost')requireThat(operationAllowed(a,'$data','read'),403,'没有项目费用读取权限');
  const source = sources[body.source];
  requireThat(body.dimension in source.dimensions && body.metric in source.metrics, 400, "不支持的数据维度或指标");
  const [sqlMetric, label] = (source.metrics as Record<string, readonly [string, string]>)[body.metric];
  const session = await supersetSession();
  let chartId: number | undefined;
  let dashboardId: number | undefined;
  try {
    const datasets = await session.request<{ result: Array<{ id: number; table_name: string; schema: string }> }>(
      "GET", "/api/v1/dataset/?q=%7B%22page_size%22%3A100%7D",
    );
    const dataset = datasets.result.find((d) => d.table_name === body.source && d.schema === "analytics");
    if (!dataset) throw new HttpError(503, "Superset 数据集尚未初始化");
    const metric = { expressionType: "SQL", sqlExpression: sqlMetric, label };
    const formData: Record<string, unknown> = {
      datasource: `${dataset.id}__table`, viz_type: vizTypes[body.chart_type],
      metrics: [metric], row_limit: 1000, time_range: "No filter", show_legend: false,
    };
    if (body.chart_type === "pie") {
      formData.groupby = [body.dimension];
      formData.metric = metric;
    } else if (body.chart_type === "table") {
      formData.groupby = [body.dimension];
      formData.query_mode = "aggregate";
    } else {
      formData.x_axis = body.dimension;
      formData.orientation = "vertical";
    }
    const queryContext = {
      datasource: { id: dataset.id, type: "table" }, force: false,
      queries: [{ columns: [body.dimension], metrics: [metric], filters: [], time_range: "No filter",
        row_limit: 1000, order_desc: true, extras: { where: "", having: "" }, annotation_layers: [] }],
      form_data: formData, result_format: "json", result_type: "full",
    };
    const chart = await session.request<{ id: number }>("POST", "/api/v1/chart/", {
      slice_name: body.name, datasource_id: dataset.id, datasource_type: "table",
      viz_type: vizTypes[body.chart_type], params: JSON.stringify(formData),
    });
    chartId = chart.id;
    await session.request("PUT", `/api/v1/chart/${chartId}`, {
      params: JSON.stringify(formData), query_context: JSON.stringify(queryContext), viz_type: vizTypes[body.chart_type],
    });
    await session.request("GET", `/api/v1/chart/${chartId}/data/`);
    const position = {
      DASHBOARD_VERSION_KEY: "v2",
      ROOT_ID: { id: "ROOT_ID", type: "ROOT", children: ["GRID_ID"] },
      GRID_ID: { id: "GRID_ID", type: "GRID", parents: ["ROOT_ID"], children: ["ROW-1"] },
      HEADER_ID: { id: "HEADER_ID", type: "HEADER", meta: { text: body.name } },
      "ROW-1": { id: "ROW-1", type: "ROW", parents: ["ROOT_ID", "GRID_ID"], children: [`CHART-${chartId}`], meta: { background: "BACKGROUND_TRANSPARENT" } },
      [`CHART-${chartId}`]: { id: `CHART-${chartId}`, type: "CHART", parents: ["ROOT_ID", "GRID_ID", "ROW-1"], children: [], meta: { chartId, height: 70, width: 12 } },
    };
    const dashboard = await session.request<{ id: number }>("POST", "/api/v1/dashboard/", {
      dashboard_title: `Project Studio · ${body.name}`, published: true,
      position_json: JSON.stringify(position), json_metadata: JSON.stringify({ refresh_frequency: 0 }),
    });
    dashboardId = dashboard.id;
    await session.request("PUT", `/api/v1/chart/${chartId}`, { dashboards: [dashboardId] });
    const embedded = await session.request<{ result?: { uuid?: string }; uuid?: string }>("POST", `/api/v1/dashboard/${dashboardId}/embedded`, {
      allowed_domains: [process.env.STUDIO_PUBLIC_URL || "http://127.0.0.1:9090"],
    });
    const embedUuid = embedded.result?.uuid || embedded.uuid;
    if (!embedUuid || !uuid.safeParse(embedUuid).success) throw new Error("Superset embed UUID missing");
    const reportId = uid();
    await tx(async (c) => {
      await c.query(
        "INSERT INTO visual_reports(id,project_id,name,source,dimension,metric,chart_type,superset_dashboard_id,superset_embed_uuid,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [reportId, a.id, body.name, body.source, body.dimension, body.metric, body.chart_type, dashboardId, embedUuid, req.user.id],
      );
      await audit(c, a.workspace_id, req.user.id, "生成可视化报表", reportId);
    });
    res.status(201).json({ id: reportId });
  } catch (error) {
    if (dashboardId) await session.request("DELETE", `/api/v1/dashboard/${dashboardId}`).catch(() => {});
    if (chartId) await session.request("DELETE", `/api/v1/chart/${chartId}`).catch(() => {});
    throw error;
  } finally {
    session.close();
  }
});
async function reportAccess(user: string, reportId: string) {
  const report = (await pool.query("SELECT * FROM visual_reports WHERE id=$1", [uuid.parse(reportId)])).rows[0];
  requireThat(report, 404, "可视化报表不存在");
  const a=await access(user, report.project_id);
  if(report.source==='resource_cost')requireThat(operationAllowed(a,'$data','read'),403,'没有项目费用读取权限');
  return report;
}
visualReports.get("/visual-reports/:report/embed", async (req, res) => {
  const report = await reportAccess(req.user.id, req.params.report);
  res.json({ origin: supersetOrigin(), dashboardId: report.superset_embed_uuid, name: report.name });
});
visualReports.post("/visual-reports/:report/guest-token", async (req, res) => {
  const report = await reportAccess(req.user.id, req.params.report);
  res.json({ token: await guestToken(req.user, report.project_id, report.superset_embed_uuid) });
});
