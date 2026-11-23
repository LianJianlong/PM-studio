import FrozenReportSnapshot from './FrozenReportSnapshot';
import {reportCategories,reportCadences} from '../shared/report-template-catalog';
import {planDurationLabels} from './plan-duration';
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, useEffect, lazy, Suspense } from "react";
import { formatExact } from "../shared/fields";
import { formatCost, groupCosts, type CostDimension, type CostRow, } from "../shared/cost-dashboard";
import { ReportDesigner } from "./ReportDesigner";
import WorkItems from "./WorkItems";
import { Folder, Building2, Plus, ArrowRight, CheckCircle2, Clock3, ClipboardList, CalendarDays, ChartNoAxesCombined, Users, FileText, Printer, Bot, ShieldCheck, PenLine, ChevronLeft, ChevronRight, Flag, } from "lucide-react";
import { api, useApi, useApp, useRememberedState, PageTitle, Modal, Form, Field, Loading, ErrorBox, Empty, ApproveDialog, shortDate, today, currentMonth, timestamp, } from "./lib";
const ReportSchedules=lazy(()=>import("./ReportSchedules"));
export function Overview({ compact = false }: {
    compact?: boolean;
} = {}) {
    const { project, boot, context, tick, navigate, reload, notify } = useApp(), { data: summary, error } = useApi(`/projects/${project.id}/summary`, tick), { data: plan, error: planError } = useApi(`/projects/${project.id}/plan`, tick), { data: todos, error: todoError } = useApi<any[]>(`/projects/${project.id}/todos`, tick), [stage, setStage] = useState(false), [payload, setPayload] = useState<any>(null);
    const directStage = boot.user.system_admin || context.permission.role === "owner";
    const openTodos = todos?.filter((t) => !t.done && t.owner_id === boot.user.id) || [];
    if (error || planError || todoError)
        return <ErrorBox message={__ui(error || planError || todoError)}/>;
    if (!summary || !plan || !todos)
        return <Loading />;
    return (<>
      <PageTitle icon={Building2} title={__ui("项目总览")} subtitle={project.name}>
        <button className="primary" onClick={() => navigate("data")}>
          <PenLine size={16}/>{__ui("录入日报")}</button>
        <button onClick={() => navigate("planning")}>
          <CalendarDays size={16}/>{__ui("查看计划")}</button>
      </PageTitle>
      <div className="stages">
        {__ui([
            ["工程阶段", "engineering_stage", boot.engineeringStages],
            ["经营阶段", "business_stage", boot.businessStages],
        ].map(([label, key, values]: any) => (<div className="stage-line" key={key}>
            <strong>{__ui(label)}</strong>
            <div>
              {__ui(values.map((v: string) => (<span key={v} className={project[key] === v ? "current" : ""}>
                  {__ui(v)}
                </span>)))}
            </div>
          </div>)))}
        {__ui(context.permission.manage && (<button className="stage-change text-button" onClick={() => setStage(true)}>{__ui(directStage ? "设置项目阶段" : "申请变更阶段")}<ArrowRight size={13}/>
          </button>))}
      </div>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="metrics">
        <Metric label={__ui("实际完成率")} value={`${plan?.progress ?? 0}%`} icon={CheckCircle2} ring={plan?.progress || 0} detail={__ui("按作业工期加权")}/>
        <Metric label={__ui("总计划工期")} value={planDurationLabels(plan).working} icon={Clock3} detail={`${planDurationLabels(plan).calendar} · ${__ui(plan?.calendar || "项目日历")}`}/>
        <Metric label={__ui("待办事项")} value={openTodos.length} icon={ClipboardList} detail={__uiFormat("已完成 {0} 项", [todos.filter((t) => t.done && t.owner_id === boot.user.id).length])}/>
        <Metric label={__ui("待审核记录")} value={summary?.counts.pending ?? 0} icon={FileText} detail={__uiFormat("正式记录 {0} 条", [summary?.counts.approved ?? 0])}/>
      </div>
      <div className="overview-grid" hidden={compact}>
        <section className="panel activity-panel">
          <div className="section-heading">
            <h3>{__ui("作业完成情况")}</h3>
            <span className="legend">
              <i />{__ui("实际完成率")}</span>
          </div>
          {__ui(plan?.activities.length ? (<div className="activity-bars">
              {__ui(plan.activities.slice(0, 8).map((a: any) => (<div className="activity-bar" key={a.id}>
                  <span>{a.name}</span>
                  <div>
                    <i style={{ width: a.progress + "%" }}/>
                  </div>
                  <strong>{__ui(a.progress)}%</strong>
                </div>)))}
            </div>) : (<Empty text={__ui("尚未建立计划")}/>))}
          <button className="text-button panel-link" onClick={() => navigate("planning")}>{__ui("进入计划管理")}<ArrowRight size={15}/>
          </button>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h3>{__ui("数据处理进度")}</h3>
            <button className="text-button" onClick={() => navigate("approvals")}>{__ui("审批中心")}</button>
          </div>
          <div className="data-funnel">
            {__ui([
            ["草稿", summary?.counts.draft || 0, "#91a6b8"],
            ["待审核", summary?.counts.pending || 0, "#eda33d"],
            ["正式生效", summary?.counts.approved || 0, "#00876b"],
        ].map(([label, count, color]) => (<div key={label}>
                <span style={{ background: String(color) }}/>
                <div>
                  <strong>{__ui(label)}</strong>
                  <small>
                    {__ui(label === "正式生效"
                ? "纳入指标与正式统计"
                : "保留完整操作记录")}
                  </small>
                </div>
                <b>{__ui(count)}</b>
              </div>)))}
          </div>
          <div className="note">{__ui("统计数据遵循当前账号权限。未经审核的记录不会计入正式工程量。")}</div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h3>{__ui("部门协同")}</h3>
            <button className="text-button" onClick={() => navigate("departments")}>{__ui("全部部门")}<ArrowRight size={14}/>
            </button>
          </div>
          <div className="department-summary">
            {__ui(context.departments.map((d: any) => {
            const tables = summary?.tables.filter((t: any) => t.department === d.name) ||
                [];
            return (<div key={d.id}>
                  <Users size={16}/>
                  <span>{d.name}</span>
                  <small>{__ui(tables.length)}{__ui(" 张表")}</small>
                  <strong>
                    {__ui(tables.reduce((s: number, t: any) => s + t.total, 0))}{__ui(" ")}{__ui("条记录")}</strong>
                </div>);
        }))}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h3>{__ui("我的待办")}</h3>
            <span className="count-badge">{__ui(openTodos.length)}</span>
          </div>
          {__ui(openTodos.length ? (<div className="todo-list">
              {__ui(openTodos.slice(0, 5).map((t) => (<label key={t.id}>
                  <input type="checkbox" onChange={async () => {
                    try {
                        await api(`/todos/${t.id}`, "PATCH", {
                            done: true,
                            version: t.version,
                        });
                        reload();
                        notify("待办已完成");
                    }
                    catch (e) {
                        notify((e as Error).message);
                    }
                }}/>
                  <div>
                    <strong>{t.title}</strong>
                    <small>{project.name}</small>
                    <time>{__ui(shortDate(t.due_date))}</time>
                  </div>
                </label>)))}
            </div>) : (<Empty text={__ui("暂无未完成待办")}/>))}
          <button className="text-button panel-link" onClick={() => navigate("calendar")}>{__ui("查看全部待办")}<ArrowRight size={15}/>
          </button>
        </section>
      </div>
      {__ui(stage && (<Modal title={__ui(directStage ? "设置项目阶段" : "申请变更项目阶段")} onClose={() => setStage(false)}>
          <Form submit={directStage ? "保存" : "选择审批人"} onClose={() => setStage(false)} onSubmit={async (d) => {
                if (directStage) {
                  await api(`/projects/${project.id}/stages`, "PUT", {engineering_stage:d.get("engineering"),business_stage:d.get("business"),reason:d.get("reason")});
                  setStage(false); reload(); notify("项目阶段已更新"); return;
                }
                setPayload({
                    engineering_stage: d.get("engineering"),
                    business_stage: d.get("business"),
                    reason: d.get("reason"),
                });
                setStage(false);
            }}>
            <Field label={__ui("工程阶段")}>
              <select name="engineering" defaultValue={project.engineering_stage}>
                {__ui(boot.engineeringStages.map((s: string) => (<option key={s}>{__ui(s)}</option>)))}
              </select>
            </Field>
            <Field label={__ui("经营阶段")}>
              <select name="business" defaultValue={project.business_stage}>
                {__ui(boot.businessStages.map((s: string) => (<option key={s}>{__ui(s)}</option>)))}
              </select>
            </Field>
            <Field label={__ui("变更依据 / 关口成果说明")}>
              <textarea name="reason" required={!directStage} maxLength={1000}/>
            </Field>
          </Form>
        </Modal>))}
      {__ui(payload && (<ApproveDialog kind="stage" title={__ui("项目阶段变更")} payload={payload} onClose={() => setPayload(null)}/>))}
    </>);
}
function Metric({ label, value, suffix, detail, icon: Icon, ring, }: {
    label: string;
    value: any;
    suffix?: string;
    detail: string;
    icon: any;
    ring?: number;
}) {
    return (<div className="metric">
      <div className={"metric-icon " + (ring !== undefined ? "ring" : "")} style={ring !== undefined
            ? { background: `conic-gradient(#00876b ${ring}%, #e3f3ee 0)` }
            : undefined}>
        <span>
          <Icon size={25}/>
        </span>
      </div>
      <div>
        <span>{__ui(label)}</span>
        <strong>
          {value}
          <small>{__ui(suffix)}</small>
        </strong>
        <p>{__ui(detail)}</p>
      </div>
    </div>);
}
export function Insights({ departmentsOnly = false, }: {
    departmentsOnly?: boolean;
}) {
    const { project, tick, navigate } = useApp(), { data, error } = useApi(`/projects/${project.id}/summary`, tick), { data: costs, error: costsError } = useApi<{
        rows: CostRow[];
    }>(departmentsOnly ? null : `/projects/${project.id}/cost-dashboard`, tick), [costDimension, setCostDimension] = useState<CostDimension>("kind"), [department, setDepartment] = useState("all");
    const tables = data?.tables.filter((t: any) => department === "all" || t.department === department) || [];
    return (<>
      <PageTitle icon={departmentsOnly ? Users : ChartNoAxesCombined} title={__ui(departmentsOnly ? "部门工作台" : "数据统计与可视化")} subtitle={__ui(departmentsOnly
            ? "11个部门共享项目数据，各司其职"
            : "业务数据按授权的正式记录统计；计划资源费用按作业分配汇总")}>
        <select aria-label={__ui("部门筛选")} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="all">{__ui("全部部门")}</option>
          {__ui([
            ...new Set<string>(data?.tables.map((t: any) => t.department) || []),
        ].map((d) => (<option key={d}>{__ui(d)}</option>)))}
        </select>
      </PageTitle>
      {__ui(error ? (<ErrorBox message={__ui(error)}/>) : !data ? (<Loading />) : (<>
          <div className="stats-strip">
            <div>
              <span>{__ui("数据表")}</span>
              <strong>{__ui(tables.length)}</strong>
            </div>
            <div>
              <span>{__ui("全部记录")}</span>
              <strong>
                {__ui(tables.reduce((s: number, t: any) => s + t.total, 0))}
              </strong>
            </div>
            <div>
              <span>{__ui("正式生效")}</span>
              <strong>
                {__ui(tables.reduce((s: number, t: any) => s + t.approved, 0))}
              </strong>
            </div>
            <div>
              <span>{__ui("待审核")}</span>
              <strong>
                {__ui(tables.reduce((s: number, t: any) => s + t.pending, 0))}
              </strong>
            </div>
          </div>
          {__ui(!departmentsOnly && (<section className="panel cost-dashboard">
              <div className="section-heading">
                <h3>{__ui("计划资源费用")}</h3>
                <select aria-label={__ui("费用统计维度")} value={costDimension} onChange={(e) => setCostDimension(e.target.value as CostDimension)}>
                  <option value="kind">{__ui("按资源类型")}</option>
                  <option value="department">{__ui("按作业部门")}</option>
                  <option value="activity">{__ui("按计划作业")}</option>
                </select>
              </div>
              {__ui(costsError ? (<ErrorBox message={__ui(costsError)}/>) : !costs ? (<Loading />) : !costs.rows.length ? (<Empty text={__ui("尚无作业资源分配")}/>) : (<CostDashboard rows={costs.rows} dimension={costDimension}/>))}
            </section>))}
          <section className="panel">
            <div className="section-heading">
              <h3>{__ui("部门记录分布")}</h3>
              <span className="legend">
                <i />{__ui("正式记录")}<i className="legend-grey"/>{__ui("全部记录")}</span>
            </div>
            <div className="distribution">
              {__ui(tables.map((t: any) => (<div key={t.id}>
                  <span>{__ui(t.department)}</span>
                  <div>
                    <i className="total" style={{
                    width: Math.max(1, (t.total /
                        Math.max(...tables.map((t: any) => t.total), 1)) *
                        100) + "%",
                }}/>
                    <i className="approved" style={{
                    width: (t.approved /
                        Math.max(...tables.map((t: any) => t.total), 1)) *
                        100 +
                        "%",
                }}/>
                  </div>
                  <strong>
                    {__ui(t.approved)} / {__ui(t.total)}
                  </strong>
                </div>)))}
            </div>
          </section>
          <section className="panel">
            <h3>{__ui("数据表与指标")}</h3>
            <div className="grid-scroll">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>{__ui("部门")}</th>
                    <th>{__ui("数据表")}</th>
                    <th>{__ui("记录总数")}</th>
                    <th>{__ui("正式记录")}</th>
                    <th>{__ui("指标汇总（已审核）")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {__ui(tables.map((t: any) => (<tr key={t.id}>
                      <td>{__ui(t.department)}</td>
                      <td>
                        <strong>{t.name}</strong>
                      </td>
                      <td>{__ui(t.total)}</td>
                      <td>{__ui(t.approved)}</td>
                      <td>
                        {__ui(t.metrics.length ? (t.metrics.map((m: any) => (<div key={m.id}>
                              {m.name}：<b>{__ui(formatExact(m.sum))}</b> {__ui(m.unit)}
                            </div>))) : (<span className="muted">{__ui("暂无数值字段")}</span>))}
                      </td>
                      <td>
                        <button className="text-button" onClick={() => navigate("data")}>{__ui("查看数据")}<ArrowRight size={14}/>
                        </button>
                      </td>
                    </tr>)))}
                </tbody>
              </table>
            </div>
          </section>
        </>))}
    </>);
}
function CostDashboard({ rows, dimension, }: {
    rows: CostRow[];
    dimension: CostDimension;
}) {
    const groups = groupCosts(rows, dimension);
    const total = groups.reduce((sum, row) => ({
        planned: sum.planned + row.planned,
        actual: sum.actual + row.actual,
    }), { planned: 0n, actual: 0n });
    return (<>
      <div className="stats-strip cost-totals">
        <div>
          <span>{__ui("计划费用")}</span>
          <strong>{__ui(formatCost(total.planned))}</strong>
        </div>
        <div>
          <span>{__ui("实际费用")}</span>
          <strong>{__ui(formatCost(total.actual))}</strong>
        </div>
        <div>
          <span>{__ui("剩余 / 超支")}</span>
          <strong className={total.actual > total.planned ? "red-text" : ""}>
            {__ui(formatCost(total.planned - total.actual))}
          </strong>
        </div>
      </div>
      <div className="grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              <th>
                {__ui(dimension === "kind"
            ? "资源类型"
            : dimension === "department"
                ? "作业部门"
                : "计划作业")}
              </th>
              <th>{__ui("计划费用")}</th>
              <th>{__ui("实际费用")}</th>
              <th>{__ui("剩余 / 超支")}</th>
              <th>{__ui("费用使用率")}</th>
            </tr>
          </thead>
          <tbody>
            {__ui(groups.map((row) => (<tr key={row.key}>
                <td>{__ui(row.label)}</td>
                <td>{__ui(formatCost(row.planned))}</td>
                <td>{__ui(formatCost(row.actual))}</td>
                <td className={row.variance < 0n ? "red-text" : ""}>
                  {__ui(formatCost(row.variance))}
                </td>
                <td>
                  <div className="cost-use-bar">
                    <span style={{
                width: `${row.planned ? Math.min(100, Number((row.actual * 100n) / row.planned)) : row.actual ? 100 : 0}%`,
            }} className={row.variance < 0n ? "over" : ""}/>
                  </div>
                </td>
              </tr>)))}
          </tbody>
        </table>
      </div>
      <p className="help">{__ui("费用来自作业资源分配的计划与实际金额。负数表示超支；不同资源单位仅汇总费用，不汇总数量。")}</p>
    </>);
}
export function Calendar({ initialTodoId, createOnMount = false, }: {
    initialTodoId?: string;
    createOnMount?: boolean;
} = {}) {
    const { project, context, boot, tick, reload, notify, notificationTarget, consumeNotificationTarget, } = useApp();
    const [showArchived, setShowArchived] = useState(false), [modal, setModal] = useState(createOnMount), [editingTodo, setEditingTodo] = useState<any>(null);
    const { data, error } = useApi<any[]>(`/projects/${project.id}/todos${showArchived ? "?archived=true" : ""}`, tick);
    const [openedInitial, setOpenedInitial] = useState(false);
    useEffect(() => {
        if (initialTodoId && data && !openedInitial) {
            setEditingTodo(data.find((t) => t.id === initialTodoId) || null);
            setOpenedInitial(true);
        }
    }, [initialTodoId, data, openedInitial]);
    const [month, setMonth] = useState(currentMonth), [filter, setFilter] = useState("all"), [range, setRange] = useState("all"), [selectedDay, setSelectedDay] = useState(today), [display, setDisplay] = useState("calendar");
    const date = new Date(month + "-01T12:00:00"), first = (date.getDay() + 6) % 7, days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const addDays = (day: string, offset: number) => {
        const d = new Date(day + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + offset);
        return d.toISOString().slice(0, 10);
    };
    const weekStart = addDays(today(), -((new Date(today() + "T12:00:00Z").getUTCDay() + 6) % 7));
    const filtered = (data || []).filter((t) => filter === "all" ||
        (filter === "open"
            ? !t.done
            : filter === "done"
                ? t.done
                : filter === "overdue"
                    ? !t.done && shortDate(t.due_date) < today()
                    : t.priority === filter));
    const rows = filtered.filter((t) => range === "all" ||
        (range === "today"
            ? shortDate(t.due_date) === today()
            : range === "week"
                ? shortDate(t.due_date) >= weekStart &&
                    shortDate(t.due_date) <= addDays(weekStart, 6)
                : shortDate(t.due_date) === selectedDay));
    const editable = (t: any) => !showArchived &&
        context.permission.write &&
        (context.permission.manage || t.owner_id === boot.user.id);
    const chooseDay = (day: string) => {
        setSelectedDay(day);
        setRange("day");
    };
    function move(delta: number) {
        const next = new Date(date);
        next.setMonth(next.getMonth() + delta);
        setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    }
    async function complete(t: any) {
        try {
            await api(`/todos/${t.id}`, "PATCH", {
                done: !t.done,
                version: t.version,
            });
            reload();
        }
        catch (e) {
            notify((e as Error).message);
        }
    }
    useEffect(() => {
        if (!data ||
            notificationTarget?.kind !== "todo" ||
            notificationTarget.project_id !== project.id)
            return;
        const task = data.find((item) => item.id === notificationTarget.resource_id);
        if (task) {
            const day = shortDate(task.due_date);
            setSelectedDay(day);
            setMonth(day.slice(0, 7));
            setRange("day");
            setFilter("all");
            setDisplay("list");
        }
        else
            notify("该待办已归档、移除或不再可访问。");
        consumeNotificationTarget?.();
    }, [data, notificationTarget, project.id]);
    const priorityName = (t: any) => (({ low: "低", normal: "普通", high: "高", urgent: "紧急" }) as any)[t.priority] || "普通";
    async function archive(t: any) {
        if (window.confirm(__ui("归档后可由项目经理恢复，是否继续？"))) {
            try {
                await api(`/todos/${t.id}`, "DELETE", {});
                reload();
                notify("待办已归档");
            }
            catch (e) {
                notify((e as Error).message);
            }
        }
    }
    return (<>
      <PageTitle icon={CalendarDays} title={__ui("日历与待办")} subtitle={__ui("按日期、负责人和优先级安排每天的行动")}>
        <button className="primary" onClick={() => setModal(true)} disabled={!context.permission.write}>
          <Plus size={16}/>{__ui("新增待办")}</button>
      </PageTitle>
      <WorkItems />
      <div className="calendar-toolbar">
        <button aria-label={__ui("上个月")} onClick={() => move(-1)}>
          <ChevronLeft size={17}/>
        </button>
        <h2>
          {__ui(date.getFullYear())}{__ui("年 ")}{date.getMonth() + 1}{__ui("月")}</h2>
        <button aria-label={__ui("下个月")} onClick={() => move(1)}>
          <ChevronRight size={17}/>
        </button>
        <button onClick={() => {
            setMonth(currentMonth());
            setRange("all");
        }}>{__ui("本月")}</button>
        <select aria-label={__ui("待办筛选")} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">{__ui("全部待办")}</option>
          <option value="open">{__ui("未完成")}</option>
          <option value="done">{__ui("已完成")}</option>
          <option value="overdue">{__ui("已逾期")}</option>
          <option value="urgent">{__ui("紧急")}</option>
          <option value="high">{__ui("高优先级")}</option>
        </select>
      </div>
      <div className="agenda-controls">
        <div className="local-tabs">
          <button className={display === "calendar" ? "active" : ""} onClick={() => setDisplay("calendar")}>{__ui("月历")}</button>
          <button className={display === "list" ? "active" : ""} onClick={() => setDisplay("list")}>{__ui("议程列表")}</button>
        </div>
        <div className="agenda-ranges">
          {__ui([
            ["all", "全部日期"],
            ["today", "今天"],
            ["week", "本周"],
        ].map(([key, label]) => (<button key={key} className={range === key ? "active" : ""} onClick={() => {
                setRange(key);
                if (key !== "all")
                    setMonth(currentMonth());
            }}>
              {__ui(label)}
            </button>)))}
          <label>{__ui("指定日期")}<input aria-label={__ui("议程日期")} type="date" value={selectedDay} onChange={(e) => {
            if (e.target.value) {
                chooseDay(e.target.value);
                setMonth(e.target.value.slice(0, 7));
            }
        }}/>
          </label>
        </div>
      </div>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      {__ui(display === "calendar" && (<div className="calendar-grid">
          {__ui(["一", "二", "三", "四", "五", "六", "日"].map((d) => (<div className="calendar-week" key={d}>{__ui("周")}{__ui(d)}
            </div>)))}
          {__ui(Array.from({ length: Math.ceil((days + first) / 7) * 7 }, (_, i) => {
                const d = i - first + 1, valid = d > 0 && d <= days, day = `${month}-${String(d).padStart(2, "0")}`, tasks = filtered.filter((t) => shortDate(t.due_date) === day);
                return (<div key={i} className={`calendar-cell ${valid ? "" : "outside"} ${day === today() ? "today" : ""} ${range === "day" && day === selectedDay ? "selected-day" : ""}`}>
                {__ui(valid && (<>
                    <button className="calendar-day" aria-label={__uiFormat("查看 {0} 待办", [day])} aria-pressed={range === "day" && day === selectedDay} onClick={() => chooseDay(day)}>
                      {__ui(d)}
                      <small>{__ui(tasks.length ? `${tasks.length}项` : "")}</small>
                    </button>
                    {__ui(tasks.slice(0, 3).map((t) => (<button key={t.id} className={`calendar-event ${t.done ? "done" : ""}`} title={t.title} onClick={() => chooseDay(day)}>
                        {t.title}
                      </button>)))}
                    {__ui(tasks.length > 3 && (<button className="calendar-more" onClick={() => chooseDay(day)}>{__ui("另")}{__ui(tasks.length - 3)}{__ui("项")}</button>))}
                  </>))}
              </div>);
            }))}
        </div>))}
      <section className="panel todo-table-panel">
        <div className="section-heading">
          <h3>
            {__ui(range === "day"
            ? `${selectedDay} 的待办`
            : range === "today"
                ? "今天的待办"
                : range === "week"
                    ? "本周待办"
                    : "待办清单")}{__ui(" ")}
            <small>{__ui("共")}{__ui(rows.length)}{__ui("项")}</small>
          </h3>
          <div>
            {__ui(range === "day" && context.permission.write && !showArchived && (<button onClick={() => setModal(true)}>{__ui("在此日期新建")}</button>))}
            {__ui(context.permission.manage && (<button onClick={() => setShowArchived((v) => !v)}>
                {__ui(showArchived ? "返回活动待办" : "查看归档待办")}
              </button>))}
          </div>
        </div>
        {__ui(!rows.length ? (<Empty text={__ui("暂无符合条件的待办")}/>) : (<table className="data-grid todo-table">
            <thead>
              <tr>
                <th>{__ui("完成")}</th>
                <th>{__ui("待办事项")}</th>
                <th>{__ui("优先级")}</th>
                <th>{__ui("负责人")}</th>
                <th>{__ui("到期日期")}</th>
                <th>{__ui("状态")}</th>
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(rows.map((t) => (<tr key={t.id} data-todo-id={t.id}>
                  <td data-label={__ui("完成")}>
                    <input type="checkbox" aria-label={__ui("完成 ") + t.title} checked={t.done} disabled={!editable(t)} onChange={() => void complete(t)}/>
                  </td>
                  <td data-label={__ui("事项")}>{t.title}</td>
                  <td data-label={__ui("优先级")}>
                    <span className={`status ${t.priority === "urgent" ? "rejected" : t.priority === "high" ? "pending" : "draft"}`}>
                      {__ui(priorityName(t))}
                    </span>
                  </td>
                  <td data-label={__ui("负责人")}>{t.owner_name}</td>
                  <td data-label={__ui("到期日期")}>{__ui(shortDate(t.due_date))}</td>
                  <td data-label={__ui("状态")}>
                    <span className={`status ${t.done ? "approved" : "pending"}`}>
                      {__ui(t.done ? "已完成" : "待处理")}
                    </span>
                  </td>
                  <td data-label={__ui("操作")}>
                    <button disabled={!editable(t)} onClick={() => setEditingTodo(t)}>{__ui("编辑")}</button>
                    {__ui(showArchived ? (<button disabled={!context.permission.manage} onClick={async () => {
                        try {
                            await api(`/todos/${t.id}/restore`, "POST", {});
                            reload();
                            notify("待办已恢复");
                        }
                        catch (e) {
                            notify((e as Error).message);
                        }
                    }}>{__ui("恢复")}</button>) : (<button disabled={!editable(t)} onClick={() => void archive(t)}>{__ui("归档")}</button>))}
                  </td>
                </tr>)))}
            </tbody>
          </table>))}
      </section>
      {__ui((modal || editingTodo) && (<Modal title={__ui(editingTodo ? "编辑待办" : "新增待办")} onClose={() => {
                setModal(false);
                setEditingTodo(null);
            }}>
          <Form onClose={() => {
                setModal(false);
                setEditingTodo(null);
            }} onSubmit={async (d) => {
                const body = {
                    title: d.get("title"),
                    due_date: d.get("date"),
                    owner_id: d.get("owner"),
                    priority: d.get("priority"),
                    recurrence: d.get("recurrence"),
                    recurrence_until: d.get("until") || (editingTodo ? null : undefined),
                    ...(editingTodo ? { version: editingTodo.version } : {}),
                };
                await api(editingTodo
                    ? `/todos/${editingTodo.id}`
                    : `/projects/${project.id}/todos`, editingTodo ? "PATCH" : "POST", body);
                setModal(false);
                setEditingTodo(null);
                reload();
                notify(editingTodo ? "待办已更新" : "待办已创建");
            }}>
            <Field label={__ui("待办事项")}>
              <input name="title" required maxLength={120} defaultValue={editingTodo?.title || ""}/>
            </Field>
            <Field label={__ui("到期日期")}>
              <input name="date" type="date" required defaultValue={editingTodo?.due_date
                ? shortDate(editingTodo.due_date)
                : range === "day"
                    ? selectedDay
                    : today()}/>
            </Field>
            <Field label={__ui("负责人")}>
              <select name="owner" defaultValue={editingTodo?.owner_id || boot.user.id}>
                {__ui(context.users
                .filter((u: any) => context.permission.manage || u.id === boot.user.id)
                .map((u: any) => (<option key={u.id} value={u.id}>
                      {u.name}
                    </option>)))}
              </select>
            </Field>
            <Field label={__ui("优先级")}>
              <select name="priority" defaultValue={editingTodo?.priority || "normal"}>
                <option value="low">{__ui("低")}</option>
                <option value="normal">{__ui("普通")}</option>
                <option value="high">{__ui("高")}</option>
                <option value="urgent">{__ui("紧急")}</option>
              </select>
            </Field>
            <Field label={__ui("重复规则")}>
              <select name="recurrence" defaultValue={editingTodo?.recurrence || "none"}>
                <option value="none">{__ui("不重复")}</option>
                <option value="daily">{__ui("每天")}</option>
                <option value="weekly">{__ui("每周")}</option>
                <option value="monthly">{__ui("每月")}</option>
              </select>
            </Field>
            <Field label={__ui("重复截止日期")}>
              <input name="until" type="date" defaultValue={editingTodo?.recurrence_until
                ? shortDate(editingTodo.recurrence_until)
                : ""}/>
            </Field>
          </Form>
        </Modal>))}
    </>);
}
export function Reports() {
    const [snapshotCategory,setSnapshotCategory]=useState("全部"),[snapshotTemplate,setSnapshotTemplate]=useState(""),[snapshotFrom,setSnapshotFrom]=useState(""),[snapshotTo,setSnapshotTo]=useState(""),[reportCategory,setReportCategory]=useState("全部"),[reportSearch,setReportSearch]=useState(""),[installing,setInstalling]=useState(false);
    const { project, boot, tick, reload, context, notify, setReportFocus } = useApp(), { data, error } = useApi<any[]>(`/projects/${project.id}/reports`, tick), { data: visuals, error: visualError } = useApi<any[]>(`/projects/${project.id}/report-documents`, tick), [create, setCreate] = useState(false), [createVisual, setCreateVisual] = useState(false), [savedMode, setMode] = useRememberedState<"visual" | "snapshot" | "schedule">(`report-mode:${boot.user.id}:${project.id}`,"visual"), [savedVisual, setVisualSelected] = useRememberedState(`report-design:${boot.user.id}:${project.id}`,""), [savedSnapshot, setSelected] = useRememberedState(`report-snapshot:${boot.user.id}:${project.id}`,"");
    const mode=savedMode==="schedule"&&!context.permission.manage?"visual":savedMode;
    const visualSelected=visuals?.some(r=>r.id===savedVisual)?savedVisual:"";
    const selected=data?.some(r=>r.id===savedSnapshot)?savedSnapshot:"";
    const {data:report,error:reportError}=useApi(selected?`/reports/${selected}`:null,tick);
    useEffect(() => {
        setReportFocus?.(mode === "visual" && Boolean(visualSelected));
        return () => setReportFocus?.(false);
    }, [mode, visualSelected, setReportFocus]);
    return (<>
      <PageTitle icon={FileText} title={__ui("报表中心")} subtitle={__ui("原生报表设计器、10 种 ECharts 图表与授权数据快照")}>
        <button disabled={!context.permission.manage && !context.permission.export} className="primary" onClick={() => setCreateVisual(true)}>
          <Plus size={16}/>{__ui("新建报表")}</button>
        <button disabled={!context.permission.export} onClick={() => {
            setMode("snapshot");
            setSnapshotTemplate(visuals?.find(r=>r.category==='进度'&&r.cadence==='day')?.id||'');setSnapshotFrom('');setSnapshotTo('');
            setCreate(true);
        }}>
          <Plus size={16}/>{__ui("生成统计快照")}</button>
      </PageTitle>
      <div className="report-mode-tabs">
        <button className={mode === "visual" ? "active" : ""} onClick={() => setMode("visual")}>{__ui("报表设计")}</button>
        <button className={mode === "snapshot" ? "active" : ""} onClick={() => setMode("snapshot")}>{__ui("统计快照")}</button>
        {context.permission.manage&&<button className={mode === "schedule" ? "active" : ""} onClick={() => setMode("schedule")}>{__ui("定时任务")}</button>}
      </div>
      {mode === "schedule" ? <Suspense fallback={<Loading/>}><ReportSchedules key={project.id}/></Suspense> : __ui(mode === "visual" ? (<>
          {__ui(visualError && <ErrorBox message={__ui(visualError)}/>)}
          <div className="reports-layout">
            <section className="report-list">
              <div className="report-catalog-tools"><label>{__ui('报表分类')}<select aria-label={__ui('报表分类')} value={reportCategory} onChange={e=>setReportCategory(e.target.value)}>{['全部',...reportCategories,'未分类'].map(c=><option key={c} value={c}>{__ui(c)}</option>)}</select></label><input aria-label={__ui('搜索报表')} placeholder={__ui('搜索报表')} value={reportSearch} onChange={e=>setReportSearch(e.target.value)}/>
              {reportCategory!=='全部'&&<button onClick={()=>setReportCategory('全部')}>{__ui('返回分类文件夹')}</button>}
              {context.permission.manage&&<button disabled={installing} onClick={async()=>{setInstalling(true);try{const r=await api<any>(`/projects/${project.id}/report-templates/install`,'POST',{});notify(`新增 ${r.created} 份模板，保留 ${r.skipped} 份已有模板`);await reload()}catch(e){notify((e as Error).message)}finally{setInstalling(false)}}}>{__ui(installing?'正在配置…':'补齐标准模板')}</button>}</div>
              {reportCategory==='全部'?<div className="report-folders">{[...reportCategories,'未分类'].filter(c=>c!=='未分类'||visuals?.some(r=>!r.category)).map(c=><button key={c} onClick={()=>setReportCategory(c)}><Folder size={24}/><span><strong>{__ui(c)}</strong><small>{visuals?.filter(r=>(r.category||'未分类')===c).length||0} {__ui('份报表模板')}</small></span><ArrowRight size={14}/></button>)}</div>:<>
              {__ui(visuals?.filter(r=>(reportCategory==='全部'||(r.category||'未分类')===reportCategory)&&r.name.toLowerCase().includes(reportSearch.toLowerCase())).sort((a,b)=>reportCategories.indexOf(a.category)-reportCategories.indexOf(b.category)||a.name.localeCompare(b.name,'zh')).map((r) => (<button key={r.id} className={visualSelected === r.id ? "active" : ""} onClick={() => setVisualSelected(r.id)}>
                  <ChartNoAxesCombined size={23}/>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{__ui(r.category||'未分类')} · {__ui((reportCadences as any)[r.cadence]||(r.cadence==='topic'?'专题报表':'自定义报表'))}</small>
                  </div>
                  <ArrowRight size={15}/>
                </button>)))}
              </>}
              {__ui(!visuals?.length && <Empty text={__ui("尚无报表，点击上方按钮创建")}/>)}
            </section>
            <section className="report-preview visual-report-preview">
              {__ui(visualSelected ? (<ReportDesigner key={visualSelected} reportId={visualSelected} onClose={() => setVisualSelected("")} onOpen={setVisualSelected}/>) : (<Empty text={__ui("选择一份报表进入设计器")}/>))}
            </section>
          </div>
        </>) : (<>
          {__ui(error && <ErrorBox message={__ui(error)}/>)}
          <div className="reports-layout">
            <section className="report-list">
              {snapshotCategory==='全部'?<div className="report-folders">{[...reportCategories,'未分类'].filter(c=>c!=='未分类'||data?.some(r=>!r.category)).map(c=><button key={c} onClick={()=>setSnapshotCategory(c)}><Folder size={24}/><span><strong>{__ui(c)}</strong><small>{data?.filter(r=>(r.category||'未分类')===c).length||0} {__ui('份快照')}</small></span></button>)}</div>:<><button onClick={()=>setSnapshotCategory('全部')}>{__ui('返回分类文件夹')}</button>
              {__ui(data?.filter(r=>(r.category||'未分类')===snapshotCategory).map((r) => (<button key={r.id} className={selected === r.id ? "active" : ""} onClick={() => setSelected(r.id)}>
                  <FileText size={23}/>
                  <div>
                    <strong>{r.name}</strong>
                    <small>{__ui(timestamp(r.created_at))}</small>
                  </div>
                  <ArrowRight size={15}/>
                </button>)))}
</>}
              {__ui(!data?.length && <Empty text={__ui("暂无报表快照")}/>)}
            </section>
            <section className="report-preview">
              {__ui(reportError ? (<ErrorBox message={__ui(reportError)}/>) : report ? (<>
                  <div className="report-toolbar">
                    <span>{__ui("个人统计快照 · 权限复核后查看")}</span>
                    <button onClick={() => window.print()}>
                      <Printer size={16}/>{__ui("打印 / PDF")}</button>
                  </div>
                  {report.snapshot.kind==='template_report'?<FrozenReportSnapshot report={report}/>:<article className="report-paper">
                    <div className="report-eyebrow">{__ui("PROJECT STUDIO / 项目数据报告")}</div>
                    <h1>{report.name}</h1>
                    <p>{report.snapshot.project.name}</p>
                    <div className="report-rule"/>
                    <div className="report-meta">
                      <span>{__ui("生成时间：")}{__ui(timestamp(report.created_at))}</span>
                      <span>{__ui("工程阶段：")}{__ui(report.snapshot.project.engineering_stage)}
                      </span>
                    </div>
                    <h2>{__ui("一、数据概况")}</h2>
                    <p>{__ui("记录总数")}{__ui(report.snapshot.counts.total)}{__ui(" 条，正式生效")}{__ui(" ")}
                      {__ui(report.snapshot.counts.approved)}{__ui(" 条，待审核")}{__ui(" ")}
                      {__ui(report.snapshot.counts.pending)}{__ui("条。")}</p>
                    <h2>{__ui("二、部门统计")}</h2>
                    <table className="data-grid">
                      <thead>
                        <tr>
                          <th>{__ui("部门")}</th>
                          <th>{__ui("数据表")}</th>
                          <th>{__ui("正式记录")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {__ui(report.snapshot.tables.map((t: any) => (<tr key={t.id}>
                            <td>{__ui(t.department)}</td>
                            <td>{t.name}</td>
                            <td>{__ui(t.approved)}</td>
                          </tr>)))}
                      </tbody>
                    </table>
                    <h2>{__ui("三、已审核数据指标")}</h2>
                    {__ui(report.snapshot.tables
                    .filter((t: any) => t.metrics.length)
                    .map((t: any) => (<div key={t.id}>
                          <h3>{t.name}</h3>
                          {__ui(t.metrics.map((m: any) => (<p key={m.id}>
                              {m.name}：{__ui(formatExact(m.sum))} {__ui(m.unit)}
                            </p>)))}
                        </div>)))}
                    <p className="report-footnote">{__ui("本报告为生成时刻的个人统计快照，非正式审批发布文件。仅含当时授权范围内的数据；不同单位与字段分别统计。")}</p>
                  </article>}
                </>) : (<Empty text={__ui("选择一份报表查看内容")}/>))}
            </section>
          </div>
        </>))}
      {__ui(createVisual && (<Modal title={__ui("新建报表")} onClose={() => setCreateVisual(false)}>
          <Form submit="创建并设计" onClose={() => setCreateVisual(false)} onSubmit={async (d) => {
                const result = await api<{
                    id: string;
                }>(`/projects/${project.id}/report-documents`, "POST", { name: d.get("name") });
                setCreateVisual(false);
                setVisualSelected(result.id);
                setMode("visual");
                reload();
                notify("报表已创建，请在设计器中编辑");
            }}>
            <Field label={__ui("报表名称")}>
              <input name="name" defaultValue={`${project.name} · 项目分析报告`} required maxLength={120}/>
            </Field>
            <p className="help">{__ui("创建后可组合页眉、明细、汇总、页脚，以及图表、指标和数据表。")}</p>
          </Form>
        </Modal>))}
      {__ui(create && (<Modal title={__ui("生成统计报表")} onClose={() => setCreate(false)}>
          <div className="snapshot-template-chooser"><Field label={__ui('基本快照类型')}><select aria-label={__ui('基本快照类型')} value={snapshotTemplate} onChange={e=>setSnapshotTemplate(e.target.value)}><option value="">{__ui('全项目数据概况（当前时刻）')}</option>{reportCategories.map(c=><optgroup key={c} label={__ui(c)}>{visuals?.filter(r=>r.category===c&&r.cadence).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>)}</select></Field>{snapshotTemplate&&<><label>{__ui('开始日期')}<input type="date" aria-label={__ui('快照开始日期')} value={snapshotFrom} onChange={e=>setSnapshotFrom(e.target.value)}/></label><label>{__ui('结束日期')}<input type="date" aria-label={__ui('快照结束日期')} value={snapshotTo} onChange={e=>setSnapshotTo(e.target.value)}/></label><p className="help">{__ui('日报、周报、月报默认按生成日的相对周期；自定义周期与专题需填写起止日期。')}</p></>}</div>
          <Form submit="生成快照" onClose={() => setCreate(false)} onSubmit={async (d) => {
                if((snapshotFrom&&!snapshotTo)||(!snapshotFrom&&snapshotTo)||snapshotFrom>snapshotTo)throw Error(__ui("请填写有效的统计起止日期"));
                const r = await api(`/projects/${project.id}/reports`, "POST", {
                    name: d.get("name"),...(snapshotTemplate?{templateId:snapshotTemplate,...(snapshotFrom&&snapshotTo?{dateFrom:snapshotFrom,dateTo:snapshotTo}:{})}:{}),
                });
                setSelected(r.id);
                setSnapshotCategory(visuals?.find(t=>t.id===snapshotTemplate)?.category||'未分类');
                setCreate(false);
                reload();
                notify("统计报表快照已生成");
            }}>
            <Field label={__ui("报表名称")}>
              <input key={snapshotTemplate} name="name" defaultValue={(visuals?.find(t=>t.id===snapshotTemplate)?.name||project.name + " · 数据统计报告")} required maxLength={120}/>
            </Field>
            <p className="help">{__ui("将保存当前权限范围的数据统计结果，数据后续变更不会改写此快照。")}</p>
          </Form>
        </Modal>))}
    </>);
}
