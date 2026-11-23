import {planDurationLabels} from './plan-duration';
import {durationText} from '../shared/duration-summary';
import {selectBaseline} from '../shared/performance';
import {p6ActivityFields} from '../shared/p6-planning';
import PlanControls from './PlanControls';
import {wbsSummaries} from '../shared/plan-inspection';
import {progressMoment} from '../shared/plan-progress';
import {wbsLevelColor} from "../shared/wbs-hierarchy";
import ActivityResources from "./ActivityResources";
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { RecordGrid } from "./DataCenter";
import PlanningTables from "./PlanningTables";
import NetworkEditor from './NetworkEditor';
import ProjectCalendar from "./ProjectCalendar";
import PlanResources from "./PlanResources";
import { usePlanDrag, type PlanAnchor } from "./PlanDrag";
import { FieldTypeOptions, ValueEditor, fieldOptions } from "./FieldControls";
import { displayValue, inputValue, isSystemField, isReference, } from "../shared/fields";
import { ActivityRecords } from "./RecordLinks";
import { lazy, Suspense, useState, useEffect } from "react";
import PanelToggle, { usePanelCollapsed } from "./PanelToggle";
import { CalendarDays, Plus, Flag, RefreshCw, PenLine, GitBranch, ArrowRight, Download, BarChart3, } from "lucide-react";
import { api, useApi, useApp, useRememberedState, PageTitle, Modal, Form, Field, Loading, ErrorBox, Empty, ApproveDialog, } from "./lib";
const PlanSummary=lazy(()=>import("./PlanSummary"));
const day = (date: string, offset: number) => {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
};
export default function Planning() {
    const [propertiesCollapsed, toggleProperties] = usePanelCollapsed("plan-properties");
    const {project,context,tick,reload,notify,boot,canLeave}=useApp();
    const [tab, setTab] = useRememberedState(`planning-tab:${boot.user.id}:${project.id}`,"wbs");
    const [pathRank,setPathRank]=useRememberedState(`gantt-path:${boot.user.id}:${project.id}`,0);
    const [quickFilter,setQuickFilter]=useRememberedState(`gantt-filter:${boot.user.id}:${project.id}`,'all');
    const [planRevision,setPlanRevision]=useState(0);
    useEffect(()=>{
      const changed=(event:Event)=>{const url=(event as CustomEvent).detail?.url||'';if(/^\/(records|tables|activities|activity-resources)\//.test(url)||url.startsWith(`/projects/${project.id}/`))setPlanRevision(v=>v+1)};
      const focused=()=>setPlanRevision(v=>v+1);
      window.addEventListener('studio-data-changed',changed);window.addEventListener('focus',focused);
      return ()=>{window.removeEventListener('studio-data-changed',changed);window.removeEventListener('focus',focused)};
    },[project.id]);
    const [activityCreate,setActivityCreate]=useState<{key:number;data:object}>();
    let wbsOrder={id:'code',direction:1};
    if(tab==='gantt')try{
      const saved=JSON.parse(sessionStorage.getItem(`project-studio:v1:plan-wbs-sort:${boot.user.id}:${project.id}`)||'null');
      if(typeof saved?.id==='string'&&saved.id.length<=50)wbsOrder=saved;
    }catch{}
    const [ganttDisplay,setGanttDisplay]=useRememberedState(`gantt-display:${boot.user.id}:${project.id}`,{scale:"week",name:true,duration:true,freeFloat:false,totalFloat:false,front:false,statusDate:new Date().toISOString().slice(0,10),baseline:"latest",baseline2:"none",baseline3:"none",critical:true},true);
    const selectedIds=[ganttDisplay.baseline,ganttDisplay.baseline2,ganttDisplay.baseline3].filter(v=>/^[a-f0-9-]{36}$/i.test(v||''));
    const {data:baselineCatalog}=useApi<any[]>(tab==='gantt'?`/projects/${project.id}/baselines/catalog`:null,tick+planRevision);
    const planUrl=`/projects/${project.id}/plan?view=${tab}&baseline_ids=${selectedIds.join(',')}`+(tab==='gantt'?`&wbs_sort=${encodeURIComponent(wbsOrder.id)}&wbs_direction=${wbsOrder.direction===-1?'desc':'asc'}`:'');
    const { data, error } = useApi(planUrl, tick+planRevision), { data: resourceLoad, error: resourceError, refresh:refreshResources } = useApi(["pool", "load", "assignments", "cost"].includes(tab)?`/projects/${project.id}/resource-load`:null, tick+planRevision), [dependency, setDependency] = useState<any>(null), [compact, setCompact] = useState(() => window.innerWidth < 680), [selected, setSelected] = useState(""), [editing, setEditing] = useState<any>(null), [modal, setModal] = useState(false), [baseline, setBaseline] = useState(false), [zoom, setZoom] = useState(7), [columnModal, setColumnModal] = useState(false), [columnTable, setColumnTable] = useState(""), [filter, setFilter] = useState(""), [sort, setSort] = useState("code"), [hidden, setHidden] = useState<string[]>(p6ActivityFields.map(f=>f.id));
    const activities = data?.activities || [], current = activities.find((a: any) => a.id === selected) || activities[0];
    const extras = (data?.table?.columns || []).filter((f: any) => !["code", "name", "duration", "progress"].includes(f.id));
    const shown = extras.filter((f: any) => !hidden.includes(f.id));
    const activePathRank=data?.critical_paths?.some((p:any)=>p.rank===pathRank)?pathRank:0;
    const displayActivities = activities
        .filter((a:any)=>!activePathRank||a.float_paths?.some((p:any)=>p.path===activePathRank))
        .filter((a:any)=>quickFilter==='all'||quickFilter==='critical'&&a.critical||quickFilter==='in_progress'&&a.progress>0&&a.progress<100||quickFilter==='not_started'&&a.progress===0||quickFilter==='completed'&&a.progress===100||quickFilter==='milestone'&&a.duration===0&&a.activity_type!=='LOE持续性作业'||quickFilter==='near'&&a.near_critical||quickFilter==='negative'&&a.float<0)
        .filter((a: any) => `${a.code} ${a.name} ${a.custom_references?.wbs?.items?.map((r:any)=>r.label).join(" ")||""} ${shown.map((f: any) => displayValue(a.custom_data?.[f.id])).join(" ")}`
        .toLowerCase()
        .includes(filter.toLowerCase()))
        .slice()
        .sort((a: any, b: any) => String(a.custom_data?.[sort] ?? a[sort] ?? "").localeCompare(String(b.custom_data?.[sort] ?? b[sort] ?? ""), "zh-CN", { numeric: true }));
    async function ensureTable() {
        if (data?.table)
            return data.table.id;
        const t = await api(`/projects/${project.id}/plan-table`, "POST", {});
        setColumnTable(t.id);
        reload();
        return t.id;
    }
    function link(source: PlanAnchor, target: PlanAnchor) {
        const a = activities.find((n: any) => n.id === target.id);
        if (!a)
            return;
        setDependency({
            predecessor: source.id,
            successor: target.id,
            type: source.edge + target.edge,
            lag: 0,
            version: a.version,
        });
    }
    function editRelation(a: any, d: any) {
        setDependency({
            predecessor: d.id,
            successor: a.id,
            type: d.type,
            lag: d.lag,
            version: a.version,
        });
    }
    function exportPlan() {
        const rows = [
            [
                "作业编码",
                "作业名称",
                "工期（项目日历日）",
                "完成率",
                "计划开始",
                "计划完成",
                "总浮时（工作日）",
                "自由浮时（工作日）",
                ...shown.map((f: any) => f.name),
            ],
            ...displayActivities.map((a: any) => [
                a.code,
                a.name,
                a.duration,
                a.progress,
                day(data.start_date, a.es),
                day(data.start_date, a.ef),
                a.float,
                a.free_float,
                ...shown.map((f: any) => displayValue(a.custom_data?.[f.id])),
            ]),
        ];
        const safe = (v: any) => '"' +
            String(v)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
            '"';
        const url = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(safe).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
        a.href = url;
        a.download = project.name + "-计划.csv";
        a.click();
        URL.revokeObjectURL(url);
    }
    return (<>
      <PageTitle icon={CalendarDays} title={__ui("计划管理")} subtitle={__ui(tab === 'arrow' ? '双代号时标网络图 · 拖拽绘制与决策建模'  : '制定、跟踪和优化项目进度计划')}>
        {__ui(tab !== 'arrow' && <>
        <button onClick={reload}>
          <RefreshCw size={16}/>{__ui(tab==="gantt"?"刷新横道图":"重新计算")}</button>
        {__ui(tab!=="gantt"&&context.permission.manage && (<button onClick={() => setBaseline(true)}>
            <Flag size={16}/>{__ui("申请设置基线")}</button>))}
        {__ui(tab!=="gantt"&&(data?.can_write??false) && (<button className="primary" onClick={async () => {
                    if(tab!=="table"&&!(await canLeave()))return;
                    if(data?.table){setActivityCreate({key:Date.now(),data:{}});setTab("table");return;}
                    setEditing(null);
                    setModal(true);
                }}>
            <Plus size={16}/>{__ui("新增作业")}</button>))}
        {__ui(context.permission.manage &&
                ["table", "arrow"].includes(tab) && (<button onClick={async () => {
                    try {
                        await ensureTable();
                        setColumnModal(true);
                    }
                    catch (e) {
                        notify((e as Error).message);
                    }
                }}>
              <Plus size={16}/>{__ui("新增列")}</button>))}
        <button onClick={exportPlan} disabled={!data}>
          <Download size={16}/>{__ui("导出计划")}</button>
        </>)}
      </PageTitle>
      {tab !== 'arrow'&&<p className="help">{__ui(tab==='gantt'?'横道图自动读取作业表；草稿显示为预排。作业字段只读，仅可调整逻辑关系。资源及费用仍仅计算有效作业。':'计划图表及资源费用仅计算有效作业；草稿仍保存在作业数据表，需主管确认后参与计算。')}</p>}
      <div className="plan-topline">
        <div className="local-tabs">
          {__ui([
            ["summary", "项目概况"],
            ["calendar", "日历管理"],
            ["organization", "组织架构"],
            ["constraints", "项目限制"],
            ["wbs", "WBS"],
            ["table", "作业数据表"],
            ["arrow", "双代号时标网络图"],
            ["gantt", "横道图"],
            ["pool", "资源池"],
            ["load", "资源负荷"],
            ["assignments", "作业资源分配表"],
            ["cost", "费用明细"],
            ["schedule", "排程设置与检查"],
        ].map(([id, name]) => (<button className={tab === id ? "active" : ""} onClick={async () => {if(id===tab||!(await canLeave()))return;setActivityCreate(undefined);setTab(id)}} key={id}>
              {__ui(name)}
            </button>)))}
        </div>
        {__ui(tab !== 'arrow' && <><span>{__ui("工作日历")}<strong>{__ui(data?.calendar || "标准五天工作周")}</strong>
        </span>
        {!["gantt","schedule"].includes(tab)&&<select aria-label={__ui("时间轴缩放")} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          <option value={7}>{__ui("周视图")}</option>
          <option value={14}>{__ui("日视图")}</option>
          <option value={4}>{__ui("月视图")}</option>
        </select>}
        </>)}
        {__ui(tab === "gantt" && (<select aria-label={__ui("横道图布局")} value={compact ? "compact" : "full"} onChange={(e) => setCompact(e.target.value === "compact")}>
            <option value="compact">{__ui("简洁时间轴")}</option>
            <option value="full">{__ui("完整列布局")}</option>
          </select>))}
      </div>
      {__ui(tab === "gantt" && (<div className="plan-table-toolbar">
          <select aria-label={__ui('浮时路径筛选')} value={activePathRank} onChange={e=>{const rank=Number(e.target.value);setPathRank(rank);if(rank)setSelected(data.critical_paths.find((p:any)=>p.rank===rank)?.activity_ids[0]||'')}}><option value={0}>{__ui('全部路径')}</option>{data?.critical_paths?.map((p:any)=><option key={p.rank} value={p.rank}>{__ui('路径')} {p.rank} · {__ui(durationText(p.gap_work_days,data.calendar_config?.hours_per_day||8))}</option>)}</select>
          <select aria-label={__ui('作业快速筛选')} value={quickFilter} onChange={e=>setQuickFilter(e.target.value)}>{[['all','全部作业'],['critical','关键作业'],['in_progress','进行中'],['not_started','未开始'],['completed','已完成'],['milestone','里程碑'],['negative','负浮时'],['near','近关键作业']].map(([id,name])=><option value={id} key={id}>{__ui(name)}</option>)}</select>
          <input aria-label={__ui("筛选横道图作业")} placeholder={__ui("搜索作业及显示列")} value={filter} onChange={(e) => setFilter(e.target.value)}/>
          <select aria-label={__ui("计划表排序")} value={sort} onChange={(e) => setSort(e.target.value)}>
            {__ui([
                ["code", "作业编码"],
                ["name", "作业名称"],
                ["duration", "工期"],
                ["progress", "完成率"],
                ...extras.map((f: any) => [f.id, f.name]),
            ].map(([id, name]) => (<option key={id} value={id}>{__ui("排序：")}{__ui(name)}
              </option>)))}
          </select>
          <details>
            <summary>{__ui("显示列 · ")}{__ui(shown.length)}{__ui("个扩展列")}</summary>
            {__ui(extras.map((f: any) => (<label className="checkbox-label" key={f.id}>
                <input type="checkbox" checked={!hidden.includes(f.id)} onChange={(e) => setHidden((v) => e.target.checked
                    ? v.filter((id) => id !== f.id)
                    : [...v, f.id])}/>
                {f.name}
              </label>)))}
          </details>
        </div>))}
      {tab==="gantt"&&<details className="gantt-display-settings"><summary>{__ui("显示设置")}</summary><div className="gantt-settings-fields">
        <label>{__ui("时间标尺")}<select aria-label={__ui("时间标尺")} value={ganttDisplay.scale} onChange={e=>setGanttDisplay({...ganttDisplay,scale:e.target.value})}><option value="day">{__ui("日")}</option><option value="week">{__ui("周")}</option><option value="month">{__ui("月")}</option></select></label>
        <label>{__ui("时间轴缩放")}<select aria-label={__ui("时间轴缩放")} value={zoom} onChange={e=>setZoom(Number(e.target.value))}><option value={4}>{__ui("紧凑")}</option><option value={7}>{__ui("标准")}</option><option value={14}>{__ui("放大")}</option></select></label>
        {([["name","作业名称"],["duration","工期"],["freeFloat","自由浮时"],["totalFloat","总浮时"],["front","前锋线"],["critical","关键路线"]] as const).map(([key,label])=><label className="checkbox-label" key={key}><input type="checkbox" checked={ganttDisplay[key]} onChange={e=>setGanttDisplay({...ganttDisplay,[key]:e.target.checked})}/>{__ui(label)}</label>)}
        <label>{__ui("状态日期")}<input aria-label={__ui("状态日期")} type="date" required disabled={!!data?.data_date} title={__ui('设置了项目状态日期时，前锋线自动跟随项目日期')} value={data?.data_date||ganttDisplay.statusDate} onChange={e=>e.target.value&&setGanttDisplay({...ganttDisplay,statusDate:e.target.value})}/></label>
        {(['baseline','baseline2','baseline3'] as const).map((key,index)=><label key={key}>{__ui(index===0?'基准计划':index===1?'对比基线2':'对比基线3')}<select aria-label={__ui(index===0?'基准计划':index===1?'对比基线2':'对比基线3')} value={/^\d+$/.test(ganttDisplay[key]||'')?data?.baselines?.[Number(ganttDisplay[key])]?.id||'none':ganttDisplay[key]||'none'} onChange={e=>setGanttDisplay({...ganttDisplay,[key]:e.target.value})}><option value="none">{__ui('不显示')}</option><option value="latest">{__ui('最新基线')}</option><option value="project">{__ui('项目基线')}</option>{[0,1,2].map(slot=><option key={slot} value={`role${slot}`}>{__ui(['主比较基线','次比较基线','第三比较基线'][slot])}</option>)}{(baselineCatalog||data?.baselines||[]).map((b:any)=><option key={b.id} value={b.id}>{b.name||b.created_at?.slice(0,10)}</option>)}</select></label>)}
        {ganttDisplay.baseline!=="none"&&!data?.baselines?.length&&<small>{__ui("暂无已批准基线")}</small>}
        {ganttDisplay.front&&<small>{__ui("前锋线依据完成率和项目工作日历定位，与状态日期对比；不代表历史实绩。")}</small>}
      </div></details>}
      {__ui(tab === "gantt" && (<p className="scroll-hint">{__ui("拖拽开始/完成端点到另一作业端点建立关系；点击关系线编辑或解除。横向滑动查看时间轴。")}</p>))}
      {__ui(dependency && (<section className="gantt-relation-inline" aria-label={__ui("编辑作业逻辑关系")}><strong>{__ui("编辑作业逻辑关系")}</strong>
          <Form key={dependency.predecessor+dependency.successor} submit="保存关系" onClose={() => setDependency(null)} onSubmit={async (d) => {
                await api(`/projects/${project.id}/dependencies`, "POST", {
                    ...dependency,
                    type: d.get("type"),
                    lag: Number(d.get("lag")),
                });
                setDependency(null);
                reload();
                notify("逻辑关系已保存并重新排程");
            }}>
            <p>
              {__ui(activities.find((a: any) => a.id === dependency.predecessor)
                ?.code)}{__ui(" ")}
              →{__ui(" ")}
              {__ui(activities.find((a: any) => a.id === dependency.successor)?.code)}
            </p>
            <Field label={__ui("关系类型")}>
              <select name="type" defaultValue={dependency.type}>
                <option value="FS">{__ui("FS 完成→开始")}</option>
                <option value="SS">{__ui("SS 开始→开始")}</option>
                <option value="FF">{__ui("FF 完成→完成")}</option>
                <option value="SF">{__ui("SF 开始→完成")}</option>
              </select>
            </Field>
            <Field label={__ui("间隔（工作日，可为负）")}>
              <input name="lag" type="number" min={-3650} max={3650} step={1} defaultValue={dependency.lag}/>
            </Field>
            <button type="button" onClick={async () => {
                try {
                    await api(`/projects/${project.id}/dependencies`, "POST", {
                        ...dependency,
                        remove: true,
                    });
                    setDependency(null);
                    reload();
                    notify("逻辑关系已解除");
                }
                catch (e) {
                    notify((e as Error).message);
                }
            }}>{__ui("解除关系")}</button>
          </Form>
        </section>))}
      {__ui(tab === 'arrow' ? <section className="panel"><NetworkEditor key={project.id}/></section> : tab === "summary" ? <Suspense fallback={<Loading/>}><PlanSummary key={project.id}/></Suspense> : tab === "wbs" || tab === "organization" || tab==="constraints" ? (<PlanningTables key={project.id + tab} kind={tab}/>) : tab === "calendar" ? (<ProjectCalendar />) : tab === "table" ? (<ActivityTable key={project.id} createRequest={activityCreate}/>) : error ? (<ErrorBox message={__ui(error)}/>) : !data ? (<Loading />) : tab === "schedule" ? <PlanControls key={project.id} data={data} editableSteps standalone/> : tab === "assignments" ? <ActivityResources data={resourceLoad} error={resourceError}/> : ["pool", "load", "cost"].includes(tab) ? (<PlanResources currency={data.currency} key={tab} mode={tab as "pool" | "load" | "cost"} calendar={data.calendar} projectId={project.id} activities={activities} resources={resourceLoad?.resources || []} canCreate={resourceLoad?.can_create===true} canWrite={(data?.can_write??false)} canManage={context.permission.manage} error={resourceError} reload={reload} refreshResources={refreshResources}/>) : !activities.length&&tab!=="gantt" ? (<Empty text={__ui("添加第一项作业，建立项目计划")}/>) : tab === "gantt" ? (<Gantt data={{ ...data,project_id:project.id, activities: displayActivities }} columns={shown} selected={current?.id} onSelect={setSelected} zoom={zoom} compact={compact} display={ganttDisplay} canWrite={(data?.can_write??false)} onLink={link} onRelation={editRelation}/>) : tab === "logic" ? (<Logic data={data} onSelect={setSelected}/>) : (<Empty text={__ui("请选择计划管理功能")}/>))}
      {__ui(["gantt", "logic"].includes(tab) && (<div className="plan-legend">
          {(tab!=="gantt"||ganttDisplay.critical)&&<span>
            <i className="legend-red"/>{__ui("关键作业")}</span>}
          <span><i style={{background:"#f5b965"}}/>{__ui("近关键作业")}</span>
          <span>
            <i className="legend-green"/>{__ui("普通作业")}</span>
          {(tab!=="gantt"||(ganttDisplay.baseline!=="none"&&data?.baselines?.length>0))&&<span>
            <i className="legend-grey"/>{__ui("批准基线")}</span>}
          {tab==='gantt'&&ganttDisplay.baseline2&&ganttDisplay.baseline2!=='none'&&<span><i style={{background:'#4b8dcb'}}/>{__ui('对比基线2')}</span>}
          {tab==='gantt'&&ganttDisplay.baseline3&&ganttDisplay.baseline3!=='none'&&<span><i style={{background:'#c58b3b'}}/>{__ui('对比基线3')}</span>}
          {tab==="gantt"&&activities.some((a:any)=>a.record_status&&a.record_status!=="approved")&&<span><i className="legend-draft"/>{__ui("草稿预排")}</span>}
          <span data-plan-duration title={__ui('按首项作业开始至末项完成的工作日历跨度，最小显示整小时')}>{__ui('总计划工期')}：{planDurationLabels(data).both}</span>
          <span title={__ui(data?.progress_note)}>{__ui("完成率 ")}{__ui(data?.progress || 0)}% · {__ui(data?.progress_note)}</span>
          {__ui(tab!=="gantt"&&context.permission.manage && <select aria-label={__ui("完成率口径")} value={data?.progress_method || 'duration'} onChange={async (e) => {
                    try {
                        await api(`/projects/${project.id}/progress-policy`, 'PUT', { method: e.target.value, previous: data.progress_method });
                        reload();
                    }
                    catch (err) {
                        notify((err as Error).message);
                    }
                }}><option value="duration">{__ui("按工作工期加权")}</option><option value="equal">{__ui("作业等权（含里程碑）")}</option></select>)}
        </div>))}
      {__ui(current && ["gantt", "logic"].includes(tab) && (<div className={"plan-bottom" + (propertiesCollapsed ? " properties-collapsed" : "")}>
          <section className="panel">
            <div className="section-heading">
              <h3>{__ui("当前作业：")}{current.name} <small>({__ui(current.code)})</small>
              </h3>
              {__ui(tab!=="gantt"&&(data?.can_write??false) && (<button disabled={!!current.record_id && !current.custom_editable} title={__ui(current.record_id && !current.custom_editable
                    ? "作业数据锁定或无修改权限，请通过作业数据表撤回或发起变更"
                    : "编辑作业")} onClick={() => {
                    setEditing(current);
                    setModal(true);
                }}>
                  <PenLine size={15}/>{__ui("编辑作业")}</button>))}
            </div>
            <div className="local-tabs compact">
              <button className="active">{__ui("前置作业")}</button>
            </div>
            <table className="data-grid">
              <thead>
                <tr>
                  <th>{__ui("编码")}</th>
                  <th>{__ui("前置作业")}</th>
                  <th>{__ui("关系类型")}</th>
                  <th>{__ui("时间间隔")}</th>
                </tr>
              </thead>
              <tbody>
                {__ui(current.predecessors.map((d: any) => {
                const p = activities.find((a: any) => a.id === d.id);
                return (<tr key={d.id}>
                      <td>{__ui(p?.code)}</td>
                      <td>{p?.name}</td>
                      <td>{__ui(d.type)}</td>
                      <td>{__ui(d.lag)}{__ui(" 天")}</td>
                    </tr>);
            }))}
              </tbody>
            </table>
            {__ui(!current.predecessors.length && (<p className="help">{__ui("该作业没有前置依赖。")}</p>))}
          </section>
          <aside className="panel plan-properties" aria-label={__ui("作业属性侧栏")}>
            <div className="panel-rail-heading">
              <h3 hidden={propertiesCollapsed}>{__ui("作业属性")}</h3>
              <PanelToggle name="作业属性栏" controls="plan-properties-content" side="right" collapsed={propertiesCollapsed} onToggle={toggleProperties}/>
            </div>
            <div id="plan-properties-content" hidden={propertiesCollapsed}>
              {tab!=="gantt"&&<ActivityRecords key={current.id} activityId={current.id}/>}
              <dl>
                <dt title={__ui("总浮时反映时间缓冲；是否关键由总浮时阈值或最长路径设置判定。")}>{__ui("总浮时（工作日）")}</dt>
                <dd className={current.critical ? "red-text" : ""}>
                  {__ui(current.float)}</dd>
                <dt title={__ui("不推迟紧后作业最早安排的允许延误时间。")}>{__ui("自由浮时（工作日）")}</dt>
                <dd>{__ui(current.free_float)}</dd>
                <dt>{__ui("计划开始")}</dt>
                <dd>{__ui(day(data.start_date, current.es))}</dd>
                <dt>{__ui("计划完成边界")}</dt>
                <dd>{__ui(day(data.start_date, current.ef))}</dd>
                <dt>{__ui("工期")}</dt>
                <dd>{__ui(current.duration)}{__ui(" 天")}</dd>
                <dt>{__ui("完成率")}</dt>
                <dd>{__ui(current.progress)}%</dd>
              </dl>
            </div>
          </aside>
        </div>))}
      {__ui(tab !== 'arrow' && <p className="help">{__ui("计算使用项目工作日历，支持四类逻辑及正负时距。LOE跟随关联作业范围，不驱动施工关键路线；资源超载仅提示，剩余工期重排在排程设置中启用。")}</p>)}
      {__ui(modal && (<ActivityForm editing={editing} activities={activities} onClose={() => setModal(false)}/>))}
      {__ui(columnModal && (<Modal title={__ui("新增计划列")} wide onClose={() => setColumnModal(false)}>
          <Form onClose={() => setColumnModal(false)} onSubmit={async (d) => {
                await api(`/tables/${data?.table?.id || columnTable}/columns`, "POST", {
                    id: d.get("id"),
                    name: d.get("name"),
                    type: d.get("type"),
                    required: d.get("required") === "on",
                    preserve_existing:d.get("preserve_existing")==="on",
                    ...fieldOptions(d),
                });
                setColumnModal(false);
                reload();
                notify("计划列已新增，数据表和横道图共用同一字段");
            }}>
            <Field label={__ui("列名称")}>
              <input name="name" required maxLength={120}/>
            </Field>
            <Field label={__ui("字段标识")}>
              <input name="id" required pattern="[a-zA-Z][a-zA-Z0-9_]{0,39}"/>
            </Field>
            <FieldTypeOptions fields={data?.table?.columns || []}/>
          </Form>
        </Modal>))}
      {__ui(baseline && (<ApproveDialog kind="baseline" title={project.name + __ui("计划基线")} onClose={() => setBaseline(false)}/>))}
    </>);
}
function Gantt({ data, selected, onSelect, zoom, compact, columns = [], canWrite, onLink, onRelation, display, }: {
    data: any;
    display: any;
    selected: string;
    onSelect: (id: string) => void;
    zoom: number;
    compact: boolean;
    columns?: any[];
    canWrite: boolean;
    onLink: (s: PlanAnchor, t: PlanAnchor) => void;
    onRelation: (a: any, d: any) => void;
}) {
    const drag = usePlanDrag(onLink);
    const [collapsed,setCollapsed]=useRememberedState<string[]>(`gantt-fold:${data.project_id}`,[],true);
    const row=46, bandHeight=30, left=(compact?190:380)+columns.length*150;
    const colors=['#b9c5d1','#4b8dcb','#c58b3b'];
    const chosen=[display.baseline,display.baseline2||'none',display.baseline3||'none'].map((key,index)=>({baseline:selectBaseline(data.baselines,key==='project'?data.schedule_options?.baseline_id||'latest':/^role[012]$/.test(key)?data.schedule_options?.comparison_baseline_ids?.[Number(key.slice(-1))]||'none':key),color:colors[index],index})).filter((v,i,all)=>v.baseline&&all.findIndex(x=>x.baseline?.id===v.baseline.id)===i);
    const origins=chosen.map(v=>({ ...v,origin:v.baseline.snapshot.start_date?(Date.parse(v.baseline.snapshot.start_date)-Date.parse(data.start_date))/86400000:0}));
    const timelineOrigin=Math.floor(Math.min(0,...data.activities.map((a:any)=>Number(a.es)),...origins.flatMap(v=>v.baseline.snapshot.activities.map((a:any)=>v.origin+Number(a.es)))));
    const timelineEnd=Math.max(data.duration,...origins.flatMap(v=>v.baseline.snapshot.activities.map((a:any)=>v.origin+Number(a.ef))));
    const width=Math.max(780,(timelineEnd-timelineOrigin)*zoom+340);
    const nodes:Array<{id:string;name:string;depth:number;parent_id:string|null}>=data.wbsHierarchy||[];
    const byId=new Map(nodes.map(node=>[node.id,node]));
    const grouped=new Map<string,any[]>();
    for(const activity of data.activities){
      const id=activity.custom_data?.wbs?.[0], key=byId.has(id)?id:'';
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key)!.push(activity);
    }
    const included=new Set<string>();
    for(const id of grouped.keys()){
      let node=byId.get(id);
      while(node&&!included.has(node.id)){included.add(node.id);node=byId.get(node.parent_id||'');}
    }
    const bands:Array<{key:string;name:string;depth:number;y:number}>=[];
    const activityRows:Array<{activity:any;y:number}>=[];
    const summaries=wbsSummaries(nodes,data.activities,data.progress_method);
    const hiddenNode=(node:any)=>{let parent=byId.get(node.parent_id||'');const seen=new Set<string>();while(parent&&!seen.has(parent.id)){if(collapsed.includes(parent.id))return true;seen.add(parent.id);parent=byId.get(parent.parent_id||'');}return false;};
    let height=80;
    for(const node of nodes){
      if(hiddenNode(node))continue;
      bands.push({key:node.id,name:node.name,depth:node.depth,y:height});height+=bandHeight;
      for(const activity of collapsed.includes(node.id)?[]:grouped.get(node.id)||[]){activityRows.push({activity,y:height});height+=row;}
    }
    if(grouped.get('')?.length&&nodes.length){bands.push({key:'unassigned',name:__ui('未归类作业'),depth:0,y:height});height+=bandHeight;}
    for(const activity of grouped.get('')||[]){activityRows.push({activity,y:height});height+=row;}
    const rowsById=new Map(activityRows.map(item=>[item.activity.id,item]));
    const x = (v: number) => left + (v-timelineOrigin) * zoom;
    const ticks:number[]=[];
    const maxDays=timelineOrigin+Math.ceil(width/zoom);
    if(display.scale==='month'){
      ticks.push(timelineOrigin);const date=new Date(day(data.start_date,timelineOrigin)+'T00:00:00Z');date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);
      while((date.getTime()-Date.parse(data.start_date))/86400000<maxDays){ticks.push((date.getTime()-Date.parse(data.start_date))/86400000);date.setUTCMonth(date.getUTCMonth()+1);}
    }else for(let v=timelineOrigin;v<maxDays;v+=display.scale==='day'?1:7)ticks.push(v);
    const frontDate=data.data_date||display.statusDate;
    const statusOffset=(Date.parse(frontDate)-Date.parse(data.start_date))/86400000;
    const frontPoints=[`${x(Math.max(0,statusOffset))},80`,...activityRows.map(({activity:a,y})=>{
      const progress=Math.max(0,Math.min(100,Number(a.progress)||0))/100;
      const point=progress===1||(progress===0&&a.es>statusOffset)?statusOffset:progressMoment(data.calendar_config,data.start_date,a.es,a.ef,Number(a.progress)||0);
      return `${x(Math.max(0,point))},${y+23}`;
    }),`${x(Math.max(0,statusOffset))},${height}`].join(' ');
    return (<div className="gantt-scroll" tabIndex={0} aria-label={__ui("可横向滚动的项目时间轴")}>
      <svg {...drag.bindings} role="img" aria-label={__ui("项目横道图")} className="gantt" width={left + width} height={height} viewBox={`0 0 ${left + width} ${height}`}>
        <defs>
          <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill="#8598ac"/>
          </marker>
        </defs>
        <rect width={left + width} height="80" fill="#f5f8fb"/>
        {__ui(compact ? (<text x="12" y="42" className="svg-head">{__ui("作业 / 时间轴")}</text>) : (<>
            <text x="16" y="42" className="svg-head">{__ui("编码")}</text>
            <text x="80" y="42" className="svg-head">{__ui("作业名称")}</text>
            <text x="276" y="42" className="svg-head">{__ui("工期")}</text>
            <text x="330" y="42" className="svg-head">{__ui("完成率")}</text>
          </>))}
        {__ui(columns.map((f: any, i: number) => (<text key={f.id} x={(compact ? 190 : 380) + i * 150 + 10} y={42} className="svg-head">
            <title>{f.name}</title>
            {__ui(f.name.slice(0, 12))}
          </text>)))}
        {ticks.map((v,i)=><g key={v}><line x1={x(v)} x2={x(v)} y1="0" y2={height} stroke="#e5edf3"/>{(display.scale!=="day"||i%Math.max(1,Math.ceil(45/zoom))===0)&&<text x={x(v)+4} y="33" className="svg-caption">{day(data.start_date,v).slice(display.scale==='month'?0:5)}</text>}</g>)}
        {bands.map(b=><g key={b.key} className="gantt-wbs-band" role="button" tabIndex={0} aria-label={__ui('展开或折叠WBS')+' '+b.name} onClick={()=>setCollapsed(v=>v.includes(b.key)?v.filter(id=>id!==b.key):[...v,b.key])} onKeyDown={e=>{if(e.key==='Enter')setCollapsed(v=>v.includes(b.key)?v.filter(id=>id!==b.key):[...v,b.key])}}>
          <rect x="0" y={b.y} width={left+width} height={bandHeight} fill={wbsLevelColor(b.depth)} fillOpacity={0.18}/>
          <rect x="0" y={b.y} width="4" height={bandHeight} fill={wbsLevelColor(b.depth)}/>
          <text x={12+b.depth*14} y={b.y+20} className="svg-head"><title>{b.name}</title>{collapsed.includes(b.key)?'⊞ ':'⊟ '}{b.name||__ui('WBS')}</text>
          {summaries.get(b.key)?.count>0&&<><text x={Math.max(260,left-160)} y={b.y+20} className="svg-caption">{summaries.get(b.key).count} · {Math.round(summaries.get(b.key).progress)}%</text><path d={`M${x(summaries.get(b.key).es)},${b.y+9} H${x(summaries.get(b.key).ef)} V${b.y+20} l-5,-5 H${x(summaries.get(b.key).es)+5} l-5,5 Z`} fill={wbsLevelColor(b.depth)}><title>{__ui('WBS汇总')} · {summaries.get(b.key).count} · {Math.round(summaries.get(b.key).progress)}%</title></path></>}
        </g>)}
        {__ui(activityRows.map(({activity:a,y},i) => {
            return (<g key={a.id} className={"gantt-row"+(a.activity_type==='LOE持续性作业'?' gantt-loe-row':'')} data-record-status={a.record_status} onClick={() => onSelect(a.id)} tabIndex={0} role="button" aria-label={__uiFormat("查看作业 {0}", [a.name])} onKeyDown={(e) => {
                    if (e.key === "Enter")
                        onSelect(a.id);
                }}>
              <rect x="0" y={y} width={left + width} height={row} fill={selected === a.id
                    ? "#e9f7f2"
                    : i % 2 === 0
                        ? "#fff"
                        : "#fbfcfe"}/>
              <line x1="0" x2={left + width} y1={y + row} y2={y + row} stroke="#e6edf3"/>
              <title>
                {__ui(a.code)} · {a.name} · {__ui(a.duration)}{__ui("天 · 完成")}{__ui(a.progress)}% ·{__ui(" ")}
                {__ui(day(data.start_date, a.es))}{__ui(" 至 ")}{__ui(day(data.start_date, a.ef))}{a.record_status!=='approved'?__ui(" · 草稿预排"):""}
              </title>
              {__ui(compact ? (<>
                  <text x="12" y={y + 18}>
                    {__ui(a.code)}
                  </text>
                  <text x="12" y={y + 35} className={(display.critical&&a.critical)?"svg-caption plan-critical-name":a.near_critical?"svg-caption plan-near-critical-name":"svg-caption"}>
                    {display.name&&__ui(a.name.length > 12 ? a.name.slice(0, 12) + "…" : a.name)}
                  </text>
                </>) : (<>
                  <text x="16" y={y + 27}>
                    {__ui(a.code)}
                  </text>
                  <text x="80" y={y + 27} className={(display.critical&&a.critical)?"plan-critical-name":a.near_critical?"plan-near-critical-name":""}>
                    {display.name&&__ui(a.name.length > 13 ? a.name.slice(0, 13) + "…" : a.name)}
                  </text>
                  <text x="280" y={y + 27}>
                    {display.duration&&<>{__ui(a.duration)}{__ui("天")}</>}</text>
                  <text x="334" y={y + 27} fill="#00876b">
                    {__ui(a.progress)}%
                  </text>
                </>))}
              {__ui(columns.map((f: any, index: number) => {
                    const refs = a.custom_references?.[f.id];
                    const value = refs
                        ? refs.items.map((r: any) => r.label).join("；") +
                            (refs.restricted ? "（部分不可见）" : "")
                        : displayValue(a.custom_data?.[f.id]);
                    return (<text key={f.id} className={f.id==='name'&&(display.critical&&a.critical)?"plan-critical-name":f.id==='name'&&a.near_critical?"plan-near-critical-name":""} x={(compact ? 190 : 380) + index * 150 + 10} y={y + 27} aria-label={__uiFormat("计划单元格 {0} {1}", [a.code, f.name])}>
                    <title>{value || "空值"}</title>
                    {__ui(value.length > 12
                            ? value.slice(0, 12) + "…"
                            : value || "—")}
                  </text>);
                }))}
              <text className="svg-caption gantt-bar-label" x={x(a.ef)+12} y={y+26}>{[display.name?(a.activity_type==='LOE持续性作业'?'LOE · ':'')+a.name:null,display.duration?`${a.duration}${__ui("天")}`:null,display.freeFloat?`${__ui("自由浮时")} ${a.free_float??0}`:null,display.totalFloat?`${__ui("总浮时")} ${a.float??0}`:null].filter(Boolean).join(" · ")}</text>
              {origins.map(v=>{const b=v.baseline.snapshot.activities.find((b:any)=>b.id===a.id);return b?<rect key={v.baseline.id} data-baseline-id={v.baseline.id} x={x(b.es+v.origin)} y={y+31+v.index*5} width={Math.max(3,(b.ef-b.es)*zoom)} height="4" rx="1" fill={v.color}><title>{v.baseline.name} · {day(v.baseline.snapshot.start_date||data.start_date,b.es)} — {day(v.baseline.snapshot.start_date||data.start_date,b.ef)}</title></rect>:null;})}
              {__ui(a.duration === 0&&a.activity_type!=='LOE持续性作业' ? (<path d={`M${x(a.es)},${y + 15} l8,8 l-8,8 l-8,-8Z`} fill="#128e77" stroke="#17324d"/>) : (<>
                  <rect x={x(a.es)} y={y + 15} width={(a.ef - a.es) * zoom} height="15" rx="3" fill={a.activity_type==='LOE持续性作业'?"#d6e6fa":(display.critical&&a.critical) ? "#f18b8f" : a.near_critical?"#f5b965":"#88c6b8"} stroke={a.record_status!=='approved'?"#607d8b":undefined} strokeDasharray={a.record_status!=='approved'?"4 3":undefined}/>
                  <rect x={x(a.es)} y={y + 15} width={((a.ef - a.es) * zoom * a.progress) / 100} height="15" rx="3" fill={a.activity_type==='LOE持续性作业'?"#628fc4":"#008b72"}/>
                </>))}
            </g>);
        }))}
        {__ui(activityRows.flatMap(({activity:a,y}) => a.predecessors.map((d: any) => {
            const source=rowsById.get(d.id),p=source?.activity;
            if(!source||!p)return null;
            const from=x(d.type[0]==="F"?p.ef:p.es),to=x(d.type[1]==="F"?a.ef:a.es),y1=source.y+23,y2=y+23;
            return (<g key={a.id + d.id} role={canWrite&&a.custom_editable ? "button" : undefined} tabIndex={canWrite&&a.custom_editable ? 0 : undefined} aria-label={__uiFormat("逻辑关系 {0} 到 {1}", [p.code, a.code])} onClick={() => canWrite&&a.custom_editable && onRelation(a, d)} onKeyDown={(e) => {
                    if (canWrite&&a.custom_editable && e.key === "Enter")
                        onRelation(a, d);
                }} className="plan-dependency">
                <title>{(p.activity_type==='LOE持续性作业'||a.activity_type==='LOE持续性作业')?__ui('LOE关联线不驱动排程')+' · ':''}{p.name} → {a.name} · {d.type}{d.lag?` (${d.lag})`:''}</title>
                <path d={`M${from},${y1} H${from + 8} V${y2 - 12} H${to - 5} V${y2} H${to}`} fill="none" stroke="transparent" strokeWidth="18"/>
                <path d={`M${from},${y1} H${from + 8} V${y2 - 12} H${to - 5} V${y2} H${to}`} fill="none" stroke="#8598ac" strokeWidth="3" strokeDasharray={p.activity_type==='LOE持续性作业'||a.activity_type==='LOE持续性作业'?"4 3":undefined} markerEnd="url(#gantt-arrow)" pointerEvents="none"/>
              </g>);
        })))}
        {display.front&&<g className="gantt-progress-front" pointerEvents="none"><line x1={x(Math.max(0,statusOffset))} x2={x(Math.max(0,statusOffset))} y1="60" y2={height} stroke="#c27c16" strokeDasharray="5 4"/><polyline points={frontPoints} fill="none" stroke="#c27c16" strokeWidth="2"/><text x={x(Math.max(0,statusOffset))+4} y="58" className="svg-caption">{__ui("前锋线")} {frontDate}</text></g>}
        <line x1={left} x2={left} y1="0" y2={height} stroke="#cbd8e4"/>
        {__ui(activityRows.flatMap(({activity:a,y}) => [
            drag.handle(a, "S", x(a.es) - 8, y + 23, canWrite&&a.custom_editable),
            drag.handle(a, "F", x(a.ef) + 8, y + 23, canWrite&&a.custom_editable),
        ]))}
        {__ui(drag.preview)}
      </svg>
    </div>);
}
function Logic({ data, onSelect, }: {
    data: any;
    onSelect: (id: string) => void;
}) {
    const nodes = data.activities, positions = new Map<string, {
        x: number;
        y: number;
    }>(nodes.map((a: any, i: number) => [
        a.id,
        { x: 40 + Math.min(a.es * 8, 1500), y: 30 + i * 100 },
    ]));
    return (<div className="network-scroll">
      <svg width="1900" height={Math.max(450, nodes.length * 100 + 30)} role="img" aria-label={__ui("作业逻辑图")}>
        <defs>
          <marker id="logic-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8" fill="#8aa0b0"/>
          </marker>
        </defs>
        {__ui(nodes.flatMap((a: any) => a.predecessors.map((d: any) => {
            const p = positions.get(d.id)!, n = positions.get(a.id)!;
            return (<g key={a.id + d.id}>
                <path d={`M${p.x + 180},${p.y + 32} H${p.x + 205} V${n.y + 32} H${n.x}`} fill="none" stroke="#8aa0b0" markerEnd="url(#logic-arrow)"/>
                <text x={p.x + 207} y={(p.y + n.y) / 2 + 25} className="svg-caption">
                  {__ui(d.type)} {__ui(d.lag ? `${d.lag}天` : "")}
                </text>
              </g>);
        })))}
        {__ui(nodes.map((a: any) => {
            const p = positions.get(a.id)!;
            return (<g key={a.id} onClick={() => onSelect(a.id)} className="logic-node">
              <rect x={p.x} y={p.y} width="180" height="64" rx="5" fill="#fff" stroke={a.critical ? "#ee868a" : a.near_critical?"#c47810":"#00977b"} strokeWidth="1.5"/>
              <rect x={p.x} y={p.y} width="5" height="64" rx="2" fill={a.critical ? "#ee868a" : a.near_critical?"#c47810":"#00977b"}/>
              <text x={p.x + 14} y={p.y + 23} className={a.critical?"plan-critical-name":a.near_critical?"plan-near-critical-name":""}>
                {__ui(a.code)}　{a.name}
              </text>
              <text x={p.x + 14} y={p.y + 47} className="svg-caption">
                {__ui(a.duration)}{__ui("天　完成 ")}{__ui(a.progress)}%
              </text>
            </g>);
        }))}
      </svg>
    </div>);
}
function ActivityForm({ editing, activities, onClose, }: {
    editing: any;
    activities: any[];
    onClose: () => void;
}) {
    const { context, project, reload, notify } = useApp(), [dependencies, setDependencies] = useState<any[]>(editing?.predecessors || []);
    return (<Modal title={__ui(editing ? "编辑计划作业" : "新增计划作业")} onClose={onClose} wide>
      <Form onClose={onClose} onSubmit={async (d) => {
            const body = {
                code: d.get("code"),
                name: d.get("name"),
                duration: Number(d.get("duration")),
                progress: Number(d.get("progress")),
                department_id: d.get("department") || null,
                predecessors: dependencies,
                version: editing?.version,
            };
            await api(`/projects/${project.id}/activities${editing ? "/" + editing.id : ""}`, editing ? "PUT" : "POST", body);
            reload();
            notify("作业已保存，排程已重新计算");
            onClose();
        }}>
        <div className="form-grid">
          <Field label={__ui("作业编码")}>
            <input name="code" defaultValue={editing?.code || `1.${activities.length + 1}`} required/>
          </Field>
          <Field label={__ui("作业名称")}>
            <input name="name" defaultValue={editing?.name} required/>
          </Field>
          <Field label={__ui("工期（项目日历日；0为里程碑）")}>
            <input name="duration" type="number" min={0} max={3650} defaultValue={editing?.duration ?? 1} required/>
          </Field>
          <Field label={__ui("完成率（%）")}>
            <input name="progress" type="number" min={0} max={100} defaultValue={editing?.progress ?? 0} required/>
          </Field>
        </div>
        <Field label={__ui("责任部门")}>
          <select name="department" defaultValue={editing?.department_id || ""}>
            <option value="">{__ui("未分配")}</option>
            {__ui(context.departments.map((d: any) => (<option key={d.id} value={d.id}>
                {d.name}
              </option>)))}
          </select>
        </Field>
        <div className="section-heading">
          <h3>{__ui("前置关系")}</h3>
          <button type="button" onClick={() => setDependencies((d) => [...d, { id: "", type: "FS", lag: 0 }])}>
            <Plus size={15}/>{__ui("添加关系")}</button>
        </div>
        {__ui(dependencies.map((d, i) => (<div className="dependency-form" key={i}>
            <select aria-label={__uiFormat("前置作业{0}", [i + 1])} required value={d.id} onChange={(e) => setDependencies((s) => s.map((v, j) => (j === i ? { ...v, id: e.target.value } : v)))}>
              <option value="">{__ui("选择前置作业")}</option>
              {__ui(activities
                .filter((a) => a.id !== editing?.id)
                .map((a) => (<option value={a.id} key={a.id}>
                    {__ui(a.code)} {a.name}
                  </option>)))}
            </select>
            <select aria-label={__uiFormat("关系类型{0}", [i + 1])} value={d.type} onChange={(e) => setDependencies((s) => s.map((v, j) => j === i ? { ...v, type: e.target.value } : v))}>
              {__ui(["FS", "SS", "FF", "SF"].map((t) => (<option key={t}>{__ui(t)}</option>)))}
            </select>
            <input aria-label={__uiFormat("时间间隔{0}", [i + 1])} type="number" value={d.lag} onChange={(e) => setDependencies((s) => s.map((v, j) => j === i ? { ...v, lag: Number(e.target.value) } : v))}/>
            <button type="button" onClick={() => setDependencies((s) => s.filter((_, j) => j !== i))}>{__ui("移除")}</button>
          </div>)))}
      </Form>
    </Modal>);
}

function ActivityTable({createRequest}:{createRequest?:{key:number;data:object}}){
 const {project,tick,context,reload,notify}=useApp(),{data,error}=useApi<any>(`/projects/${project.id}/plan-table`,tick);
 if(error)return <ErrorBox message={__ui(error)}/>;
 if(!data)return <Loading/>;
 if(data.table)return <div className="plan-native-table"><RecordGrid key={data.table.id} table={data.table} mode="entry" planningHierarchy="activity" createRequest={createRequest}/></div>;
 return <section className="panel"><Empty text={__ui("尚未建立作业数据表")}/>{context.permission.manage&&<button className="primary" onClick={async()=>{try{await api(`/projects/${project.id}/plan-table`,"POST",{});reload();notify(__ui("已迁移现有作业，作业表已启用"))}catch(e:any){notify(e.message)}}}>{__ui("启用作业数据表")}</button>}</section>;
}

