import DashboardLedger from './DashboardLedger';
import {formatUiTemplate as __uiFormat} from "./i18n";
import { useInterface } from "./Preferences";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { api, useApi, useApp, Modal, Form, Field, ErrorBox, Loading, Empty, } from "./lib";
import { Overview } from "./Insights";
import { Chart, chartTypes } from "./ReportDesigner";
import { formatExact, displayValue } from "../shared/fields";
import { evaluateFormula } from "../shared/formulas";
import "./project-dashboard.css";
function OriginalTable({ widget, project, tick, }: {
    widget: any;
    project: string;
    tick: number;
}) {
    const [page, setPage] = useState(1);
    const { data, error } = useApi<any>(`/projects/${project}/dashboard/widgets/${widget.id}/table?page=${page}`, tick);
    useEffect(() => setPage(1), [widget.id, widget.version]);
    if (error)
        return <ErrorBox message={__ui(error)}/>;
    if (!data)
        return <Loading />;
    return (<>
      <div className="dashboard-source-table">
        <table>
          <thead>
            <tr>
              {__ui(data.table.columns.map((c: any) => (<th key={c.id}>{c.name}</th>)))}
            </tr>
          </thead>
          <tbody>
            {__ui(data.rows.map((r: any) => (<tr key={r.id}>
                {__ui(data.table.columns.map((c: any) => (<td key={c.id}>{displayValue(r.data[c.id])}</td>)))}
              </tr>)))}
          </tbody>
        </table>
      </div>
      <div className="section-heading">
        <small>
          {data.table.name}{__ui(" · 共")}{__ui(data.total)}{__ui("行 · 第")}{__ui(page)}{__ui("页")}</small>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>{__ui("上一页")}</button>
        <button disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>{__ui("下一页")}</button>
      </div>
    </>);
}
function ProgressChart({points,kind='progress',unit=''}:{points:any[];kind?:'progress'|'earned';unit?:string}){
 const {language}=useInterface(),host=useRef<HTMLDivElement>(null);
 useEffect(()=>{let disposed=false,chart:any,observer:ResizeObserver;import('./ReportChart').then(({mountReportChart})=>{if(disposed||!host.current)return;const defs=kind==='earned'?[['pv','计划值 PV','#6a84b9'],['ev','挣值 EV','#218771'],['ac','实际成本 AC','#d47a48']]:[['planned','计划累计','#6a84b9'],['actual','已审实际累计','#218771'],['current','当前填报完成率','#d47a48']];chart=mountReportChart(host.current,{tooltip:{trigger:'axis'},legend:{type:'scroll',bottom:0,itemWidth:14,textStyle:{fontSize:11},data:defs.map(d=>__ui(d[1]))},grid:{left:55,right:20,top:30,bottom:70},xAxis:{type:'category',data:points.map(p=>p.date)},yAxis:{type:'value',...(unit==='%'?{min:0,max:100,axisLabel:{formatter:'{value}%'}}:{})},series:defs.map(([key,name,color])=>({name:__ui(name),type:key==='current'?'scatter':'line',showSymbol:true,symbolSize:key==='current'?9:4,connectNulls:key==='actual',smooth:false,data:points.map(p=>p[key]===null||p[key]===undefined?null:Number(p[key])),itemStyle:{color},lineStyle:{color,type:key==='planned'?'dashed':'solid'}}))});observer=new ResizeObserver(()=>chart.resize());observer.observe(host.current);});return()=>{disposed=true;observer?.disconnect();chart?.dispose();};},[points,language,kind,unit]);return <div className="dashboard-chart" ref={host}/>;
}
export default function ProjectDashboard() {
    const { project, tick, navigate, reload, notify } = useApp(), [poll, setPoll] = useState(0), [edit, setEdit] = useState<any>(null), [mappingId, setMappingId] = useState(""), [displayMode, setDisplayMode] = useState("default");
    const { data, error } = useApi<any>(`/projects/${project.id}/dashboard`, tick + poll);
    const { data: folder, error: folderError } = useApi<any>(`/projects/${project.id}/public`, tick + poll);
    const { data: datasets, error: datasetError } = useApi<any[]>(`/projects/${project.id}/report-datasets`, tick + poll);
    useEffect(() => {
        const timer = setInterval(() => setPoll((p) => p + 1), 30000);
        return () => clearInterval(timer);
    }, []);
    const mapping = folder?.tables.find((m: any) => m.id === mappingId), dataset = datasets?.find((d) => d.id ===
        (mapping?.is_view ? mapping.id : mapping?.source_table_id || mappingId));
    function configure(w: any) {
        setEdit(w);
        setMappingId(w.config?.mappingId || "");
        setDisplayMode(w.config?.displayMode || "default");
    }
    if (error || folderError || datasetError)
        return (<ErrorBox message={__ui(error || folderError || datasetError)}/>);
    if (!data || !folder || !datasets)
        return <Loading />;
    const ordered = data.widgets.filter((w: any) => w.kind !== "custom"), custom = data.widgets.filter((w: any) => w.kind === "custom");
    function card(w: any) {
        return (<section className={"panel dashboard-card " +
                (w.kind === "progress"||w.config?.sourceMode==='priority_ledger' ? "dashboard-wide" : "")} key={w.id}>
        <div className="section-heading">
          <h3>{__ui(w.name)}</h3>
          {__ui(data.can_manage && (<button onClick={() => configure(w)}>{__ui("配置")}</button>))}
        </div>
        <p className="help">{__ui("数据源 ·")}{__ui(" ")}
          {__ui(w.config?.status === "all" ? "全部有效状态" : "按配置审批状态")}{__ui("· 自动更新")}</p>
        {__ui(w.message ? (<Empty text={__ui(w.message)}/>) : w.config?.sourceMode==='priority_ledger'&&w.config?.displayMode==='default' ? <DashboardLedger widget={w} project={project.id} tick={tick+poll}/> : w.config?.displayMode === "table" ? (<OriginalTable widget={w} project={project.id} tick={tick + poll}/>) : w.kind === "progress" && w.config?.displayMode !== "chart" ? (<>{__ui(!!w.data.completeness?.omitted && <ErrorBox message={__uiFormat("有{0}条记录缺少日期，未计入S曲线；遗漏计划量 {1}，实际量 {2}。请在数据录入中补全日期。记录ID：{3}", [w.data.completeness.omitted, w.data.completeness.planned, w.data.completeness.actual, w.data.completeness.recordIds.join('、')])}/>)}{__ui(w.data.points.length ? (<ProgressChart points={w.data.points} unit={w.data.unit}/>) : (<Empty text={__ui("暂无已授权的进度数据")}/>))}</>) : w.kind === "todo" && w.config?.sourceMode==='project_todos' ? (<><Chart type="donut" rows={w.data.rows} overall={w.data.overall}/><ul className="dashboard-todos">{w.data.todos.map((t:any)=><li key={t.id}><span><strong>{t.title}</strong><small>{__ui(t.source)} · {t.owner}</small></span><span>{t.due_date||'—'} · {__ui(t.status)}</span></li>)}</ul><button onClick={()=>navigate('owner-items')}>{__ui('事项与日历')}</button></>) : w.kind === "earned" && w.config?.displayMode !== "chart" ? (w.data.empty?<Empty text={__ui(w.data.note)}/>:<><p className="help">{__ui('统计日期')}：{w.data.date} · {w.data.currency||project.currency}</p><ProgressChart points={w.data.points||[]} kind="earned"/><div className="earned-metrics">
            {__ui([
                    ["pv", "计划值 PV"],
                    ["ev", "挣值 EV"],
                    ["ac", "实际成本 AC"],
                    ["cv", "成本偏差 CV"],
                    ["sv", "进度偏差 SV"],
                    ["cpi", "成本绩效 CPI"],
                    ["spi", "进度绩效 SPI"],
                ].map(([key, label]) => (<div key={key}>
                <span>{__ui(label)}</span>
                <strong>
                  {__ui(w.data[key] === null
                        ? "—"
                        : formatExact(["cpi", "spi"].includes(key)
                            ? evaluateFormula("ROUND([value],4)", {
                                value: String(w.data[key]),
                            })
                            : w.data[key]))}
                </strong>
              </div>)))}
          </div></>) : (<>
            <strong className="dashboard-total">
              {__ui(formatExact(w.data.overall))}
            </strong>
            {__ui(w.data.rows.length ? (<Chart type={w.config?.chartType || "bar"} rows={w.data.rows} gaugeMax={w.config?.gaugeMax ?? 100} overall={w.data.overall}/>) : (<Empty text={__ui("暂无符合条件的记录")}/>))}
            {__ui(w.data.groupCount > w.data.rows.length && (<p className="help">{__ui("图表显示前")}{__ui(w.data.rows.length)}{__ui("组；整体指标统计全部匹配数据。")}</p>))}
          </>))}
        {w.kind==='progress'&&w.data?.unit==='%'&&<p className="help">{__ui(w.data.progress_method==='equal'?'计划按作业等权计算；实际快照应使用同一计量口径。':'计划按工作工期加权计算；实际快照应使用同一计量口径。')}</p>}
        {w.data?.note&&<p className="help">{__ui(w.data.note)}</p>}
        {__ui(w.kind === "custom" && data.can_manage && (<button className="danger" onClick={async () => {
                    try {
                        await api(`/projects/${project.id}/dashboard/widgets/${w.id}`, "DELETE", {});
                        reload();
                    }
                    catch (error) {
                        notify((error as Error).message);
                    }
                }}>{__ui("移除图表")}</button>))}
      </section>);
    }
    return (<>
      <Overview compact/>
      <div className="dashboard-grid">
        {__ui(ordered.map(card))}
      </div>
      <section className="dashboard-custom">
        <div className="section-heading">
          <h3>{__ui("自定义可视化图表")}</h3>
          {__ui(data.can_manage && (<button className="primary" onClick={() => configure({ kind: "custom", name: "自定义图表", config: {} })}>{__ui("添加图表")}</button>))}
        </div>
        {__ui(custom.length ? (<div className="dashboard-grid">{__ui(custom.map(card))}</div>) : (<div className="dashboard-blank">{__ui("留白区 · 可添加public视图表的可视化图表，直接显示在总览")}</div>))}
      </section>
      <p className="help">{__ui("数据按当前用户权限读取，每30秒刷新；最后更新")}{__ui(" ")}
        {__ui(new Date(data.updated_at).toLocaleTimeString())}
      </p>
      {__ui(edit && (<Modal title={__ui(edit.id ? "配置总览模块" : "添加自定义图表")} onClose={() => setEdit(null)} wide>
          <Form onClose={() => setEdit(null)} onSubmit={async (d) => {
                const b: any = {
                    ...edit.config,
                    mappingId,
                    displayMode,
                    gaugeMax: Number(d.get("gaugeMax") || edit.config?.gaugeMax || 100),
                    xMetric: String(d.get("xMetric") || "") || undefined,
                    chartType: String(d.get("chartType") || edit.config?.chartType || "bar"),
                    dimension: String(d.get("dimension") || edit.config?.dimension || "__status__"),
                    metric: String(d.get("metric") || edit.config?.metric || "__count__"),
                    aggregation: String(d.get("aggregation") || edit.config?.aggregation || "count"),
                    status: mapping?.is_view
                        ? "all"
                        : String(d.get("status") || "approved"),
                };
                for (const key of [
                    "dateField",
                    "plannedField",
                    "actualField",
                    "pvField",
                    "evField",
                    "acField",
                ])
                    if (d.get(key))
                        b[key] = String(d.get(key));
                await api(`/projects/${project.id}/dashboard/widgets${edit.id ? "/" + edit.id : ""}`, edit.id ? "PUT" : "POST", {
                    name: String(d.get("name")),
                    config: b,
                    ...(edit.id ? { version: edit.version } : {}),
                });
                setEdit(null);
                reload();
                notify("总览图表已保存");
            }}>
            <Field label={__ui("模块名称")}>
              <input name="name" required defaultValue={edit.name} maxLength={120}/>
            </Field>
            <Field label={__ui("数据源（原表或public视图）")}>
              <select value={mappingId} required onChange={(e) => setMappingId(e.target.value)}>
                <option value="">{__ui("选择public视图")}</option>
                {__ui(folder.tables.map((m: any) => (<option value={m.id} key={m.id}>
                    {m.name}
                  </option>)))}
                {__ui(datasets
                .filter((d) => !d.is_view)
                .map((d) => (<option key={d.id} value={d.id}>{__ui("原表 ·")}{__ui(d.department)} · {d.name}
                    </option>)))}
              </select>
            </Field>
            {__ui(mapping?.is_view ? (<p className="help">{__ui("统计此视图的全部查询结果；源记录状态与筛选条件在视图设计中设置。")}</p>) : (<Field label={__ui("统计范围")}>
                <select name="status" defaultValue={edit.config?.status || "approved"}>
                  <option value="approved">{__ui("已审核记录")}</option>
                  <option value="all">{__ui("全部有效状态")}</option>
                  <option value="pending">{__ui("待审核记录")}</option>
                  <option value="draft">{__ui("草稿记录")}</option>
                </select>
              </Field>))}
            <Field label={__ui("显示方式")}>
              <select aria-label={__ui("显示方式")} value={displayMode} onChange={(e) => setDisplayMode(e.target.value)}>
                <option value="default">{__ui("默认显示（S曲线 / 指标卡 / 图表）")}</option>
                <option value="table">{__ui("原表")}</option>
                <option value="chart">{__ui("ECharts图表")}</option>
              </select>
            </Field>
            {__ui(displayMode === "chart" && (<Field label={__ui("图表类型")}>
                <select name="chartType" defaultValue={edit.config?.chartType || "bar"}>
                  {__ui(chartTypes.map(([id, name]) => (<option key={id} value={id}>
                      {__ui(name)}
                    </option>)))}
                </select>
              </Field>))}
            {__ui(displayMode !== "table" && (<>
                <Field label={__ui("仪表图目标 / 上限")}>
                  <input name="gaugeMax" type="number" min="0.0001" max="1000000000000000" step="any" defaultValue={edit.config?.gaugeMax ?? 100}/>
                </Field>
                <Field label={__ui("散点图X指标")}>
                  <select name="xMetric" defaultValue={edit.config?.xMetric || ""}>
                    <option value="">{__ui("序号（未配置真实X指标）")}</option>
                    {__ui(dataset?.metrics.map((f: any) => (<option key={f.id} value={f.id}>
                        {f.name}
                      </option>)))}
                  </select>
                </Field>
              </>))}
            {__ui(dataset && displayMode !== "table" && (<div key={mappingId} className="form-grid">
                {__ui(edit.kind === "progress" && edit.config?.sourceMode==='project_plan' && displayMode!=='chart' ? <p className="help">{__ui('计划线取主计划或最新已审基线，实际线取已审进度快照；当前填报完成率单独标点。')}</p> : edit.kind === "progress" && displayMode !== "chart" ? (<>
                    <Field label={__ui("日期列")}>
                      <select name="dateField" required defaultValue={edit.config?.dateField}>
                        <option value="">{__ui("选择日期")}</option>
                        {__ui(dataset.dates
                        .filter((f: any) => f.id !== "__created_date__")
                        .map((f: any) => (<option key={f.id} value={f.id}>
                              {f.name}
                            </option>)))}
                      </select>
                    </Field>
                    {__ui([
                        ["plannedField", "当日计划量（增量）"],
                        ["actualField", "当日实际量（增量）"],
                    ].map(([key, label]) => (<Field label={__ui(label)} key={key}>
                        <select name={key} required defaultValue={edit.config?.[key]}>
                          <option value="">{__ui("选择数值列")}</option>
                          {__ui(dataset.metrics
                            .filter((f: any) => f.id !== "__count__")
                            .map((f: any) => (<option key={f.id} value={f.id}>
                                {f.name}
                              </option>)))}
                        </select>
                      </Field>)))}
                  </>) : edit.kind === "earned" && displayMode !== "chart" ? (<>
                    {__ui([
                        ["pvField", "计划值 PV"],
                        ["evField", "挣值 EV"],
                        ["acField", "实际成本 AC"],
                    ].map(([key, label]) => (<Field label={__ui(label)} key={key}>
                        <select name={key} required defaultValue={edit.config?.[key]}>
                          <option value="">{__ui("选择数值列")}</option>
                          {__ui(dataset.metrics
                            .filter((f: any) => f.id !== "__count__")
                            .map((f: any) => (<option key={f.id} value={f.id}>
                                {f.name}
                              </option>)))}
                        </select>
                      </Field>)))}
                    <p className="help">{__ui("从台账汇总PV、EV、AC；CPI=EV/AC，SPI=EV/PV，分母为零时显示空值。")}</p>
                  </>) : (<>
                    {__ui(displayMode !== "chart" && (<Field label={__ui("图表类型")}>
                        <select name="chartType" defaultValue={edit.config?.chartType || "bar"}>
                          {__ui(chartTypes.map(([id, name]) => (<option key={id} value={id}>
                              {__ui(name)}
                            </option>)))}
                        </select>
                      </Field>))}
                    <Field label={__ui("分类维度")}>
                      <select name="dimension" defaultValue={edit.config?.dimension || "__status__"}>
                        {__ui(dataset.dimensions.map((f: any) => (<option key={f.id} value={f.id}>
                            {f.name}
                          </option>)))}
                      </select>
                    </Field>
                    <Field label={__ui("统计指标")}>
                      <select name="metric" defaultValue={edit.config?.metric || "__count__"}>
                        {__ui(dataset.metrics.map((f: any) => (<option key={f.id} value={f.id}>
                            {f.name}
                          </option>)))}
                      </select>
                    </Field>
                    <Field label={__ui("汇总方法")}>
                      <select name="aggregation" defaultValue={edit.config?.aggregation || "count"}>
                        {__ui([
                        ["count", "计数"],
                        ["sum", "求和"],
                        ["average", "平均值"],
                        ["min", "最小值"],
                        ["max", "最大值"],
                    ].map(([v, n]) => (<option key={v} value={v}>
                            {__ui(n)}
                          </option>)))}
                      </select>
                    </Field>
                  </>))}
              </div>))}
            <p className="help">{__ui("修改源表后图表动态更新。视图不复制数据，也不扩大权限。S曲线累计同单位的每日增量，不混用百分比与工程量。")}</p>
          </Form>
        </Modal>))}
    </>);
}
