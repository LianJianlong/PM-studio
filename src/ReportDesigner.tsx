import {reportAssessment} from '../shared/report-assessment';
import {reportCategories} from '../shared/report-template-catalog';
import {printReport} from "./printReport";
import {formulaSeries} from "../shared/report-formula";
import {formatUiTemplate as __uiFormat} from "./i18n";
import { useInterface } from "./Preferences";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChartNoAxesCombined, ChevronDown, Copy, Download, Eye, GripVertical, Plus, Printer, Save, Trash2, X, } from "lucide-react";
import { api, useApi, useApp, useUnsavedChanges } from "./lib";
import { moveReportBlock, nudgeReportBlock } from "../shared/report-layout";
import { exactSum, formatExact } from "../shared/fields";
import type { ReportPivot } from "../shared/report-pivot";
import "./report-designer.css";
type Section = "header" | "detail" | "summary" | "footer";
type Block = {
    reportId?:string;formula?:string;pageBreakBefore?:boolean;keepTogether?:boolean;
    gaugeMax?: number;
    xMetric?: string;
    periodRequired?:boolean;
    id: string;
    type: "title" | "text" | "kpi" | "table" | "chart" | "divider" | "subreport" | "pagebreak" | "assessment";
    title?: string;
    text?: string;
    source?: string;
    tableId?: string;
    dimension?: string;
    dimension2?: string;
    metric?: string;
    aggregation?: string;
    status?: string;
    filterField?: string;
    filterOperator?: "equals" | "contains";
    filterValue?: string;
    detailFields?:string[];
    datePreset?:"day"|"week"|"fortnight"|"month";
    dateField?: string;
    dateFrom?: string;
    dateTo?: string;
    departmentId?: string;
    chartType?: string;
    align?: "left" | "center" | "right";
    fontSize?: number;
    color?: string;
};
type BusinessDataset = {
    fields?:{id:string;name:string}[];
    is_view?: boolean;
    id: string;
    name: string;
    department: string;
    dimensions: {
        id: string;
        name: string;
    }[];
    metrics: {
        id: string;
        name: string;
        unit?: string;
    }[];
    dates: {
        id: string;
        name: string;
    }[];
};
type Layout = {
    category?:typeof reportCategories[number];template?:{version:number;key:string;cadence:string;references:string[]};
    page?:{paper:"A4"|"A3"|"Letter";orientation:"portrait"|"landscape";margin:number;pageNumbers:boolean;header?:string;footer?:string};
    sections: Record<Section, Block[]>;
};
type Document = {
    can_edit?:boolean;
    id: string;
    name: string;
    version: number;
    layout: Layout;
};
const sections: {
    id: Section;
    label: string;
    hint: string;
}[] = [
    { id: "header", label: "页眉", hint: "报告顶部" },
    { id: "detail", label: "明细", hint: "数据主体" },
    { id: "summary", label: "汇总", hint: "统计结论" },
    { id: "footer", label: "页脚", hint: "报告底部" },
];
const types = [
    ["assessment", "依据与结论"],
    ["title", "标题"],
    ["text", "文本"],
    ["kpi", "指标卡"],
    ["table", "数据表"],
    ["chart", "图表"],
    ["divider", "分隔线"], ["subreport", "子报表"], ["pagebreak", "分页符"],
] as const;
export const chartTypes = [
    ["bar", "柱状图"],
    ["horizontalBar", "条形图"],
    ["line", "折线图"],
    ["area", "面积图"],
    ["pie", "饼图"],
    ["donut", "环形图"],
    ["scatter", "散点图"],
    ["radar", "雷达图"],
    ["funnel", "漏斗图"],
    ["gauge", "仪表图"],
] as const;
const sources: Record<string, {
    label: string;
    dimensions: Record<string, string>;
    metrics: Record<string, string>;
}> = {
    record_summary: {
        label: "数据记录",
        dimensions: { table: "数据表", department: "部门" },
        metrics: { total: "记录总数", approved: "已审核", pending: "待审核" },
    },
    activity_progress: {
        label: "计划进度",
        dimensions: {
            department: "部门",
            activity_name: "作业名称",
            code: "作业编码",
        },
        metrics: {
            duration: "计划工期",
            progress: "平均完成率",
            completed_days: "完成工期",
        },
    },
    resource_cost: {
        label: "资源费用",
        dimensions: {
            department: "部门",
            activity_name: "作业名称",
            resource_kind: "资源类型",
            resource_name: "资源名称",
        },
        metrics: {
            quantity: "资源数量",
            planned_cost: "计划费用",
            actual_cost: "实际费用",
            cost_variance: "费用差额",
        },
    },
};
const newBlock = (type: Block["type"]): Block => ({
    id: crypto.randomUUID(),
    type,
    ...(type === "title"
        ? { text: "报告标题" }
        : type === "text"
            ? { text: "在这里输入说明文字" }
            : ["chart", "table", "kpi"].includes(type)
                ? {
                    title: types.find((t) => t[0] === type)?.[1],
                    source: "record_summary",
                    dimension: "table",
                    metric: "total",
                    chartType: "bar",
                }
                : {}),
});
export function makeOption(type: string, rows: {
    label: string;
    value: number | string;
    x?: string;
}[], gaugeMax = 100, overall?: string | number) {
    const labels = rows.map((r) => r.label), values = rows.map((r) => Number(r.value));
    const common = {
        color: ["#0f9e91", "#4779d3", "#f3b84d", "#8c62bd", "#e46b73"],
        tooltip: { trigger: "item" },
        animation: false,
    };
    const axis = {
        ...common,
        grid: { left: 50, right: 24, top: 35, bottom: 55, containLabel: true },
        xAxis: {
            type: "category",
            data: labels,
            axisLabel: { rotate: labels.length > 5 ? 35 : 0 },
        },
        yAxis: { type: "value" },
    };
    switch (type) {
        case "horizontalBar":
            return {
                ...axis,
                xAxis: { type: "value" },
                yAxis: { type: "category", data: labels },
                series: [
                    {
                        type: "bar",
                        data: values,
                        itemStyle: { borderRadius: [0, 4, 4, 0] },
                    },
                ],
            };
        case "line":
            return {
                ...axis,
                series: [{ type: "line", data: values, smooth: true, symbolSize: 7 }],
            };
        case "area":
            return {
                ...axis,
                series: [
                    {
                        type: "line",
                        data: values,
                        smooth: true,
                        areaStyle: { opacity: 0.2 },
                    },
                ],
            };
        case "pie":
        case "donut":
            return {
                ...common,
                legend: { bottom: 0 },
                series: [
                    {
                        type: "pie",
                        radius: type === "donut" ? ["42%", "70%"] : "70%",
                        center: ["50%", "46%"],
                        data: rows.map((r) => ({ name: r.label, value: Number(r.value) })),
                    },
                ],
            };
        case "scatter":
            return {
                ...axis,
                xAxis: {
                    type: "value",
                    name: rows.some((r) => r.x !== undefined) ? "X指标" : "序号",
                },
                series: [
                    {
                        type: "scatter",
                        symbolSize: 16,
                        data: values.map((v, i) => [
                            rows[i].x === undefined ? i + 1 : Number(rows[i].x),
                            v,
                            labels[i],
                            rows[i].x ?? String(i + 1),
                            String(rows[i].value),
                        ]),
                    },
                ],
                tooltip: {
                    formatter: (p: any) => `${escapeChartText(p.data[2])}<br/>X：${escapeChartText(p.data[3])} · Y：${escapeChartText(p.data[4])}`,
                },
            };
        case "radar":
            return {
                ...common,
                radar: {
                    indicator: rows.map((r) => ({
                        name: r.label,
                        max: Math.max(...values, 1) * 1.2,
                    })),
                },
                series: [
                    {
                        type: "radar",
                        data: [
                            { value: values, name: "统计值", areaStyle: { opacity: 0.18 } },
                        ],
                    },
                ],
            };
        case "funnel":
            return {
                ...common,
                series: [
                    {
                        type: "funnel",
                        top: 10,
                        bottom: 20,
                        left: "12%",
                        width: "76%",
                        label: { show: true, position: "inside" },
                        data: rows.map((r) => ({ name: r.label, value: Number(r.value) })),
                    },
                ],
            };
        case "gauge":
            return {
                ...common,
                series: [
                    {
                        type: "gauge",
                        min: 0,
                        max: gaugeMax,
                        progress: { show: true },
                        axisLabel: { show: false },
                        axisTick: { show: false },
                        splitLine: { show: false },
                        pointer: { show: false },
                        title: { offsetCenter: [0, "45%"], fontSize: 13 },
                        detail: {
                            offsetCenter: [0, "10%"],
                            fontSize: 24,
                            valueAnimation: true,
                        },
                        data: [
                            {
                                value: Number(overall ?? exactSum(rows.map((r) => r.value))),
                                name: `合计 / 目标 ${gaugeMax}`,
                            },
                        ],
                    },
                ],
            };
        default:
            return {
                ...axis,
                series: [
                    {
                        type: "bar",
                        data: values,
                        itemStyle: { borderRadius: [4, 4, 0, 0] },
                    },
                ],
            };
    }
}
function escapeChartText(v: unknown) {
    return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
export function Chart({ type, rows, gaugeMax = 100, overall, }: {
    type: string;
    rows: {
        label: string;
        value: number | string;
        x?: string;
    }[];
    reportId?:string;formula?:string;pageBreakBefore?:boolean;keepTogether?:boolean;
    gaugeMax?: number;
    overall?: string | number;
}) {
    const { language } = useInterface();
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let disposed = false, chart: any, observer: ResizeObserver;
        import("./ReportChart").then(({ mountReportChart }) => {
            if (disposed || !host.current)
                return;
            if (["pie", "donut", "funnel", "gauge", "radar"].includes(type) &&
                rows.some((r) => Number(r.value) < 0))
                return;
            chart = mountReportChart(host.current, makeOption(type, rows, gaugeMax, overall));
            observer = new ResizeObserver(() => chart.resize());
            observer.observe(host.current);
        });
        return () => {
            disposed = true;
            observer?.disconnect();
            chart?.dispose();
        };
    }, [type, rows, gaugeMax, overall, language]);
    if (["pie", "donut", "funnel", "gauge", "radar"].includes(type) &&
        rows.some((r) => Number(r.value) < 0))
        return (<p className="rd-error">{__ui("此图表不支持负值，请选择柱状、条形或折线图。")}</p>);
    return <div className="rd-chart" ref={host}/>;
}
function DataBlock({ block, projectId, dataset, }: {
    block: Block;
    projectId: string;
    dataset?: BusinessDataset;
}) {
    const query = new URLSearchParams({
        source: block.source || "record_summary",
        dimension: block.dimension || "table",
        metric: block.metric || "total",
    });
    if (block.source === "business_table") {
        if(block.type==='table'&&block.detailFields?.length)query.set('detailFields',block.detailFields.join(','));
        if (block.type === "table" && block.dimension2)
            query.set("dimension2", block.dimension2);
        query.set("tableId", block.tableId || "");
        if (block.chartType === "scatter" && block.xMetric)
            query.set("xMetric", block.xMetric);
        query.set("aggregation", block.aggregation || (block.metric === "__count__" ? "count" : "sum"));
        query.set("status", block.status || "approved");
        if (block.filterField && block.filterValue) {
            query.set("filterField", block.filterField);
            query.set("filterOperator", block.filterOperator || "equals");
            query.set("filterValue", block.filterValue);
        }
        if(block.datePreset)query.set("datePreset",block.datePreset);
        if (block.dateFrom || block.dateTo||block.datePreset) {
            query.set("dateField", block.dateField || "__created_date__");
            if (block.dateFrom)
                query.set("dateFrom", block.dateFrom);
            if (block.dateTo)
                query.set("dateTo", block.dateTo);
        }
    }
    else if (block.departmentId) {
        query.set("departmentId", block.departmentId);
    }
    const awaitingPeriod=block.periodRequired&&(!block.dateFrom||!block.dateTo);
    const { data:rawData, error } = useApi<{
        rows: {
            label: string;
            value: number | string;
        }[];
        details?:{columns:{id:string;name:string}[];rows:string[][];total:number;limit:number};
        overall?: string | number;
        groupCount?: number;
        pivot?: ReportPivot;
    }>(awaitingPeriod?null:`/projects/${projectId}/report-series?${query}`);
    let data=rawData;let formulaError="";try{if(data)data=formulaSeries(data,block.formula)}catch(e:any){formulaError=e.message}
    const rows = data?.rows || [];
    const dimensionLabel = block.source === "business_table"
        ? dataset?.dimensions.find((f) => f.id === block.dimension)?.name ||
            "分组"
        : sources[block.source || "record_summary"]?.dimensions[block.dimension || "table"];
    const metricLabel = block.source === "business_table"
        ? dataset?.metrics.find((f) => f.id === block.metric)?.name || "指标"
        : sources[block.source || "record_summary"]?.metrics[block.metric || "total"];
    if(awaitingPeriod)return <p className="rd-muted">{__ui("请先设置报表统计起止日期")}</p>;
    if (error||formulaError)
        return <p className="rd-error">{__ui(error||formulaError)}</p>;
    if (!data)
        return <p className="rd-muted">{__ui("正在读取授权数据…")}</p>;
    if(block.type==='assessment')return <p className="rd-assessment" style={{whiteSpace:'pre-wrap'}}>{reportAssessment(block,data,dataset?.name)}</p>;
    if(block.type==='table'&&data.details){const d=data.details;return <><div className="rd-pivot-scroll"><table className="rd-table rd-record-details"><thead><tr>{d.columns.map(c=><th key={c.id}>{c.name}</th>)}</tr></thead><tbody>{d.rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j} style={{whiteSpace:'pre-wrap'}}>{v||'—'}</td>)}</tr>)}</tbody></table></div><p className="rd-muted">{__ui('匹配记录数')} {d.total} · {__ui('明细最多显示100条，按创建时间倒序；请缩小统计周期查看其余记录。')}</p></>;}
    if (!rows.length)
        return (<p className="rd-muted">{__ui("当前数据源暂无记录，可在右侧切换数据源和指标。")}</p>);
    const displayValue = (value: string | number) => block.source === "activity_progress" && block.metric === "progress"
        ? `${Number(value).toFixed(2)}%`
        : formatExact(value);
    if (block.type === "table" && data.pivot) {
        const p = data.pivot;
        const columnLabel = dataset?.dimensions.find((f) => f.id === block.dimension2)?.name ||
            "列分组";
        return (<>
        <div className="rd-pivot-scroll">
          <table className="rd-table rd-pivot">
            <thead>
              <tr>
                <th>
                  {__ui(dimensionLabel)} / {__ui(columnLabel)}
                </th>
                {__ui(p.columns.map((column) => (<th key={column}>{__ui(column)}</th>)))}
                <th>{__ui("整体指标（全列）")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(p.rows.map((row, i) => (<tr key={row}>
                  <th>{__ui(row)}</th>
                  {__ui(p.values[i].map((value, j) => (<td key={j}>{__ui(value === null ? "—" : formatExact(value))}</td>)))}
                  <td>{__ui(formatExact(p.rowTotals[i]))}</td>
                </tr>)))}
              <tr className="rd-pivot-total">
                <th>{__ui("整体指标（全行）")}</th>
                {__ui(p.columnTotals.map((value, i) => (<td key={i}>{__ui(formatExact(value))}</td>)))}
                <td>{__ui(formatExact(p.overall))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="rd-muted">
          {__ui(metricLabel)}{__ui(" · 共 ")}{__ui(p.rowCount)}{__ui(" 行 × ")}{__ui(p.columnCount)}{__ui("列，最多显示前 30 行 × 30 列。行列整体指标含未显示数据；平均值按原始记录计算。")}</p>
      </>);
    }
    const rangeNote = data.groupCount && data.groupCount > rows.length ? (<p className="rd-muted">{__ui("共")}{__ui(data.groupCount)}{__ui(" 组，显示数值排序前 ")}{__ui(rows.length)}{__ui(" ")}{__ui("组；整体指标统计全部匹配分组。")}</p>) : null;
    if (block.type === "table")
        return (<>
        <table className="rd-table">
          <thead>
            <tr>
              <th>{__ui(dimensionLabel)}</th>
              <th>{__ui(metricLabel)}</th>
            </tr>
          </thead>
          <tbody>
            {__ui(rows.map((r) => (<tr key={r.label}>
                <td>{__ui(r.label)}</td>
                <td>{displayValue(r.value)}</td>
              </tr>)))}
          </tbody>
        </table>
        {__ui(rangeNote)}
      </>);
    if ((block.type === "kpi"||block.chartType==='gauge')&&data.overall==='分项计量，不汇总总量')return <p className="rd-muted">{__ui('分项计量，不汇总总量')}</p>;
    if (block.type === "kpi")
        return (<div className="rd-kpi">
        <strong>
          {displayValue(data.overall ?? exactSum(rows.map((r) => r.value)))}
        </strong>
        <span>{__ui(metricLabel)}</span>
      </div>);
    return (<>
      <Chart type={block.chartType || "bar"} rows={rows} gaugeMax={block.gaugeMax} overall={data.overall}/>
      {__ui(rangeNote)}
    </>);
}
function SubreportBlock({reportId,projectId,datasets}:{reportId?:string;projectId:string;datasets?:BusinessDataset[]}){
 const {data,error}=useApi<any>(reportId?`/report-documents/${reportId}/expanded`:null);
 if(!reportId)return <p className="rd-muted">{__ui('请在属性中选择子报表')}</p>;
 if(error)return <p className="rd-error">{__ui(error)}</p>;
 if(!data)return <p>{__ui('正在读取授权数据…')}</p>;
 if(data.project_id!==projectId)return <p className="rd-error">{__ui('子报表必须属于当前项目')}</p>;
 return <div className="rd-subreport">{Object.values(data.layout.sections).flat().map((b:any)=><div key={b.id} style={{breakBefore:b.pageBreakBefore?'page':undefined,breakInside:b.keepTogether?'avoid':undefined}}>{b.type==='title'?<h2>{b.text}</h2>:b.type==='text'?<p>{b.text}</p>:b.type==='divider'?<hr/>:b.type==='pagebreak'?<div className="rd-explicit-break"/>:<DataBlock block={b} projectId={projectId} dataset={datasets?.find(d=>d.id===b.tableId)}/>}</div>)}</div>
}
export function ReportDesigner({ reportId, onClose, onOpen, }: {
    reportId: string;
    onClose: () => void;
    onOpen: (id: string) => void;
}) {
    const { project, notify, reload, context } = useApp();
    const {data:reportChoices}=useApi<any[]>(`/projects/${project.id}/report-documents`);
    const { data: fetched, error } = useApi<Document>(`/report-documents/${reportId}`);
    const { data: datasets, error: datasetError } = useApi<BusinessDataset[]>(`/projects/${project.id}/report-datasets`);
    const { data: departments } = useApi<{
        id: string;
        name: string;
    }[]>(`/projects/${project.id}/report-departments`);
    const [doc, setDoc] = useState<Document | null>(null), [dirty, setDirty] = useState(false), [selected, setSelected] = useState<string | null>(null), [activeSection, setActiveSection] = useState<Section>("detail"), [datasetSearch, setDatasetSearch] = useState(""), [preview, setPreview] = useState(false), [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [periodFrom,setPeriodFrom]=useState(""),[periodTo,setPeriodTo]=useState("");
    const [mobilePanel, setMobilePanel] = useState("canvas");
    useEffect(() => {
        if (fetched && !dirty)
            setDoc(fetched);
    }, [fetched?.version]);
    useUnsavedChanges(dirty);
    const chosen = useMemo(() => doc
        ? Object.values(doc.layout.sections)
            .flat()
            .find((b) => b.id === selected)
        : undefined, [doc, selected]);
    const chosenSection = doc && selected
        ? sections.find(({ id }) => doc.layout.sections[id].some((block) => block.id === selected))?.id
        : undefined;
    const selectedDataset = datasets?.find((table) => table.id === chosen?.tableId);
    const sourceChoices = [
        ...Object.entries(sources).map(([value, source]) => ({
            value,
            label: source.label,
        })),
        ...(datasets || []).map((table) => ({
            value: `business:${table.id}`,
            label: `${table.department} · ${table.name}`,
        })),
    ];
    const businessChoices = sourceChoices
        .slice(Object.keys(sources).length)
        .filter((item) => item.label
        .toLocaleLowerCase()
        .includes(datasetSearch.trim().toLocaleLowerCase()));
    const sourceValue = chosen?.source === "business_table"
        ? `business:${chosen.tableId}`
        : chosen?.source || "record_summary";
    const dimensionChoices = chosen?.source === "business_table"
        ? selectedDataset?.dimensions.map((f) => [f.id, f.name]) || []
        : Object.entries(sources[chosen?.source || "record_summary"].dimensions);
    const metricChoices = chosen?.source === "business_table"
        ? selectedDataset?.metrics.map((f) => [f.id, f.name]) || []
        : Object.entries(sources[chosen?.source || "record_summary"].metrics);
    const sourcePatch = (value: string): Partial<Block> => {
        if (value.startsWith("business:")) {
            const table = datasets?.find((item) => item.id === value.slice(9));
            return {
                source: "business_table",
                detailFields: undefined,
                xMetric: undefined,
                dimension2: undefined,
                tableId: table?.id,
                dimension: table?.dimensions[0]?.id || "__status__",
                metric: "__count__",
                aggregation: "count",
                status: table?.is_view ? "all" : "approved",
                departmentId: undefined,
                filterField: undefined,
                filterValue: undefined,
                dateField: table?.is_view ? table.dates[0]?.id : "__created_date__",
                dateFrom: undefined,
                dateTo: undefined,
                datePreset: undefined,
            };
        }
        return {
            source: value,
            dimension2: undefined,
            detailFields: undefined,
            tableId: undefined,
            dimension: Object.keys(sources[value].dimensions)[0],
            metric: Object.keys(sources[value].metrics)[0],
            aggregation: undefined,
            status: undefined,
            filterField: undefined,
            filterValue: undefined,
            dateField: undefined,
            dateFrom: undefined,
            dateTo: undefined,
            datePreset: undefined,
        };
    };
    const chooseSource = (value: string) => {
        const patch = sourcePatch(value);
        if (chosen && ["chart", "table", "kpi", "assessment"].includes(chosen.type))
            updateBlock(patch);
        else {
            add(activeSection, "chart");
            setDoc((current) => {
                if (!current)
                    return current;
                const list = current.layout.sections[activeSection];
                const last = list.at(-1)!;
                return {
                    ...current,
                    layout: { ...current.layout,
                        sections: {
                            ...current.layout.sections,
                            [activeSection]: [...list.slice(0, -1), { ...last, ...patch }],
                        },
                    },
                };
            });
        }
    };
    const canExport = context.permission.manage || context.permission.export;
    const writable = doc?.can_edit??(context.permission.manage || context.permission.export);
    const updateBlock = (patch: Partial<Block>) => {
        if (!doc || !selected)
            return;
        setDoc({
            ...doc,
            layout: { ...doc!.layout,
                sections: Object.fromEntries(sections.map(({ id }) => [
                    id,
                    doc.layout.sections[id].map((b) => b.id === selected ? { ...b, ...patch } : b),
                ])) as Layout["sections"],
            },
        });
        setDirty(true);
    };
    const add = (section: Section, type: Block["type"]) => {
        if (!doc)
            return;
        const b = newBlock(type);
        setDoc({
            ...doc,
            layout: { ...doc!.layout,
                sections: {
                    ...doc.layout.sections,
                    [section]: [...doc.layout.sections[section], b],
                },
            },
        });
        setActiveSection(section);
        setSelected(b.id);
        setDirty(true);
    };
    const remove = () => {
        if (!doc || !selected)
            return;
        setDoc({
            ...doc,
            layout: { ...doc!.layout,
                sections: Object.fromEntries(sections.map(({ id }) => [
                    id,
                    doc.layout.sections[id].filter((b) => b.id !== selected),
                ])) as Layout["sections"],
            },
        });
        setSelected(null);
        setDirty(true);
    };
    const move = (blockId: string, target: Section, beforeId?: string) => {
        if (!doc)
            return;
        const next = moveReportBlock(doc.layout.sections, blockId, target, beforeId);
        if (next === doc.layout.sections)
            return;
        setDoc({ ...doc, layout: { ...doc!.layout, sections: next } });
        setActiveSection(target);
        setDirty(true);
    };
    const nudge = (direction: -1 | 1) => {
        if (!doc || !selected)
            return;
        const next = nudgeReportBlock(doc.layout.sections, selected, direction);
        if (next === doc.layout.sections)
            return;
        setDoc({ ...doc, layout: { ...doc!.layout, sections: next } });
        setDirty(true);
    };
    const save = async () => {
        if (!doc)
            return;
        setSaving(true);
        try {
            const updated = await api<Document>(`/report-documents/${doc.id}`, "PUT", { name: doc.name, version: doc.version, layout: doc.layout });
            setDoc(updated);
            setDirty(false);
            reload();
            notify("报表已保存");
        }
        catch (e: any) {
            notify(e.message);
        }
        finally {
            setSaving(false);
        }
    };
    const exportExcel = async () => {
        if (!doc || dirty || exporting)
            return;
        setExporting(true);
        try {
            const response = await fetch(`/api/report-documents/${doc.id}/export.xlsx?version=${doc.version}`, { credentials: "same-origin" });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || "报表导出失败");
            }
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${doc.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")}.xlsx`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            notify("Excel已导出，包含统计结果和筛选说明");
        }
        catch (e: any) {
            notify(e.message);
        }
        finally {
            setExporting(false);
        }
    };
    const leave = () => {
        if (dirty && !window.confirm(__ui("报表有未保存的修改，确定返回吗？")))
            return;
        onClose();
    };
    const duplicate = async () => {
        if (!doc || dirty)
            return;
        try {
            const copy = await api<Document>(`/report-documents/${doc.id}/duplicate`, "POST", {});
            reload();
            onOpen(copy.id);
            notify("已复制报表");
        }
        catch (e: any) {
            notify(e.message);
        }
    };
    const removeDocument = async () => {
        if (!doc || dirty || !window.confirm(__uiFormat("确定删除报表“{0}”？", [doc.name])))
            return;
        try {
            await api(`/report-documents/${doc.id}`, "DELETE", {});
            reload();
            onClose();
            notify("报表已删除");
        }
        catch (e: any) {
            notify(e.message);
        }
    };
    if (error)
        return <p className="rd-error">{__ui(error)}</p>;
    if (!doc)
        return <p className="rd-muted">{__ui("正在载入报表设计器…")}</p>;
    const renderBlock = (b: Block, section: Section) => (<div key={b.id} className={`rd-block ${selected === b.id && !preview ? "selected" : ""}`} draggable={!preview && writable} onDragStart={(e) => e.dataTransfer.setData("block", b.id)} onDragOver={(e) => {
            if (!preview && writable)
                e.preventDefault();
        }} onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            move(e.dataTransfer.getData("block"), section, b.id);
        }} onClick={() => {
            setSelected(b.id);
            setActiveSection(section);
        }} style={{ textAlign: b.align, color: b.color,breakBefore:b.pageBreakBefore?"page":undefined,breakInside:b.keepTogether===false?"auto":"avoid" }}>
      {__ui(!preview && writable && <GripVertical className="rd-grip" size={15}/>)}
      {__ui(b.type === "subreport" ? <SubreportBlock reportId={b.reportId} projectId={project.id} datasets={datasets||undefined}/> : b.type === "pagebreak" ? <div className="rd-explicit-break">{__ui("分页符")}</div> : b.type === "title" ? (<h1 style={{ fontSize: b.fontSize, color: b.color }}>
          {__ui(b.text || "报告标题")}
        </h1>) : b.type === "text" ? (<p style={{ fontSize: b.fontSize }}>{__ui(b.text || "文本")}</p>) : b.type === "divider" ? (<hr />) : (<>
          <h3 style={{ color: b.color, fontSize: b.fontSize }}>{b.title}</h3>
          <DataBlock block={b} projectId={project.id} dataset={datasets?.find((table) => table.id === b.tableId)}/>
        </>))}
    </div>);
    return (<div className={`rd-shell ${preview ? "rd-preview" : ""}`}>
      <div className="rd-toolbar">
        <button onClick={leave}>
          <X size={17}/>{__ui("返回报表")}</button>
        <div className="rd-name">
          <span>{__ui("报表设计器")}</span>
          <input aria-label={__ui("报表名称")} value={doc.name} onChange={(e) => {
            setDoc({ ...doc, name: e.target.value });
            setDirty(true);
        }} disabled={!writable || preview}/>
        </div>
        <select aria-label={__ui('报表分类')} value={doc.layout.category||''} disabled={!writable||preview} onChange={e=>{setDoc({...doc,layout:{...doc.layout,category:(e.target.value||undefined) as Layout['category']}});setDirty(true)}}><option value="">{__ui('未分类')}</option>{reportCategories.map(c=><option key={c} value={c}>{__ui(c)}</option>)}</select>
        <div className="rd-actions">
          <span className="rd-state">{__ui(dirty ? "● 未保存" : "已保存")}</span>
          {__ui(canExport && (<>
              <button onClick={duplicate} disabled={dirty} title={__ui(dirty ? "请先保存当前修改" : "复制报表")}>
                <Copy size={16}/>{__ui("复制")}</button>
              {writable && <button onClick={removeDocument} disabled={dirty} title={__ui(dirty ? "请先保存当前修改" : "删除报表")}>
                <Trash2 size={16}/>{__ui("删除")}</button>}
            </>))}
          <button onClick={() => setPreview(!preview)}>
            <Eye size={16}/>
            {__ui(preview ? "返回设计" : "预览")}
          </button>
          {canExport && <button onClick={() => {const paper=document.querySelector<HTMLElement>(".rd-paper");if(paper)void printReport(paper,doc.layout.page)}}>
            <Printer size={16}/>{__ui("打印 / PDF")}</button>}
          {__ui(canExport && (<button onClick={exportExcel} disabled={dirty || exporting} title={__ui(dirty
                ? "请先保存筛选条件和报表修改"
                : "导出已保存报表的统计结果")}>
              <Download size={16}/>
              {__ui(exporting ? "导出中…" : "导出 Excel")}
            </button>))}
          <button className="primary" onClick={save} disabled={!writable || !dirty || saving}>
            <Save size={16}/>
            {__ui(saving ? "保存中" : "保存报表")}
          </button>
        </div>
      </div>
      {doc.layout.template&&<div className="rd-period-tools">
        <span>{__ui(doc.layout.category||'未分类')} · {__ui('统计周期')}</span>
        <label>{__ui('开始日期')}<input type="date" aria-label={__ui('报表周期开始')} value={periodFrom} onChange={e=>setPeriodFrom(e.target.value)} disabled={!writable}/></label>
        <label>{__ui('结束日期')}<input type="date" aria-label={__ui('报表周期结束')} value={periodTo} onChange={e=>setPeriodTo(e.target.value)} disabled={!writable}/></label>
        <button disabled={!writable||!periodFrom||!periodTo||periodFrom>periodTo} onClick={()=>{const sections=Object.fromEntries(Object.entries(doc.layout.sections).map(([key,items])=>[key,items.map(b=>b.dateField?{...b,datePreset:undefined,dateFrom:periodFrom,dateTo:periodTo}:b)])) as Layout['sections'];setDoc({...doc,layout:{...doc.layout,sections}});setDirty(true)}}>{__ui('应用到整份报表')}</button>
        <button disabled={!writable||!['day','week','month'].includes(doc.layout.template.cadence)} onClick={()=>{const cadence=doc.layout.template!.cadence as 'day'|'week'|'month';const sections=Object.fromEntries(Object.entries(doc.layout.sections).map(([key,items])=>[key,items.map(b=>b.dateField?{...b,datePreset:cadence,dateFrom:undefined,dateTo:undefined}:b)])) as Layout['sections'];setDoc({...doc,layout:{...doc.layout,sections}});setPeriodFrom('');setPeriodTo('');setDirty(true)}}>{__ui('恢复相对周期')}</button>
        <small>{__ui('只调整发生量组件；当前快照不随周期过滤。保存后用于导出及定时任务。')}</small>
      </div>}
      {__ui(!preview && (<div className="rd-mobile-panels" role="group" aria-label={__ui("设计器面板")}>
          {__ui([
                ["canvas", "画布"],
                ["palette", "组件库"],
                ["properties", "属性设置"],
            ].map(([key, label]) => (<button key={key} className={mobilePanel === key ? "active" : ""} aria-pressed={mobilePanel === key} onClick={() => setMobilePanel(key)}>
              {__ui(label)}
            </button>)))}
        </div>))}
      <div className="rd-workspace" data-mobile-panel={mobilePanel}>
        <aside className="rd-palette">
          <div className="rd-panel-heading">{__ui("组件库")}</div><fieldset className="rd-page-settings"><legend>{__ui('页面设置')}</legend><label>{__ui('纸张')}<select aria-label={__ui('纸张')} disabled={!writable} value={doc.layout.page?.paper||'A4'} onChange={e=>{setDoc({...doc,layout:{...doc.layout,page:{...{paper:'A4' as const,orientation:'portrait' as const,margin:12,pageNumbers:true},...doc.layout.page,paper:e.target.value as any}}});setDirty(true)}}>{['A4','A3','Letter'].map(v=><option key={v}>{v}</option>)}</select></label><label>{__ui('方向')}<select aria-label={__ui('方向')} disabled={!writable} value={doc.layout.page?.orientation||'portrait'} onChange={e=>{setDoc({...doc,layout:{...doc.layout,page:{...{paper:'A4' as const,orientation:'portrait' as const,margin:12,pageNumbers:true},...doc.layout.page,orientation:e.target.value as any}}});setDirty(true)}}><option value="portrait">{__ui('纵向')}</option><option value="landscape">{__ui('横向')}</option></select></label><label>{__ui('页边距(mm)')}<input aria-label={__ui('页边距(mm)')} type="number" min={5} max={40} disabled={!writable} value={doc.layout.page?.margin??12} onChange={e=>{setDoc({...doc,layout:{...doc.layout,page:{...{paper:'A4' as const,orientation:'portrait' as const,margin:12,pageNumbers:true},...doc.layout.page,margin:Number(e.target.value)}}});setDirty(true)}}/></label>{(['header','footer'] as const).map(key=><label key={key}>{__ui(key==='header'?'每页页眉':'每页页脚')}<input aria-label={__ui(key==='header'?'每页页眉':'每页页脚')} maxLength={120} disabled={!writable} value={doc.layout.page?.[key]||''} onChange={e=>{setDoc({...doc,layout:{...doc.layout,page:{...{paper:'A4' as const,orientation:'portrait' as const,margin:12,pageNumbers:true},...doc.layout.page,[key]:e.target.value}}});setDirty(true)}}/></label>)}<label><input type="checkbox" checked={doc.layout.page?.pageNumbers!==false} disabled={!writable} onChange={e=>{setDoc({...doc,layout:{...doc.layout,page:{...{paper:'A4' as const,orientation:'portrait' as const,margin:12,pageNumbers:true},...doc.layout.page,pageNumbers:e.target.checked}}});setDirty(true)}}/>{__ui('显示页码')}</label></fieldset>
          <label className="rd-band-picker">{__ui("添加到分区")}<select aria-label={__ui("添加到分区")} value={activeSection} onChange={(event) => setActiveSection(event.target.value as Section)}>
              {__ui(sections.map((section) => (<option key={section.id} value={section.id}>
                  {__ui(section.label)}
                </option>)))}
            </select>
          </label>
          <div className="rd-palette-grid">
            {__ui(types.map(([type, label]) => (<button key={type} disabled={!writable} onClick={() => add(activeSection, type)}>
                <Plus size={16}/>
                {__ui(label)}
              </button>)))}
          </div>
          <div className="rd-panel-heading">{__ui("平台数据集")}</div>
          {__ui(datasetError && (<p className="rd-error">{__ui("业务表读取失败：")}{__ui(datasetError)}</p>))}
          {__ui(sourceChoices
            .slice(0, Object.keys(sources).length)
            .map(({ value, label }) => (<button className="rd-source" key={value} disabled={!writable} onClick={() => chooseSource(value)}>
                <ChartNoAxesCombined size={16}/>
                <span>{__ui(label)}</span>
                <ChevronDown size={14}/>
              </button>)))}
          <div className="rd-panel-heading rd-business-heading">{__ui("业务数据表")}<small>{__ui(datasets?.length || 0)}</small>
          </div>
          <input className="rd-dataset-search" aria-label={__ui("搜索业务数据表")} placeholder={__ui("搜索部门或数据表")} value={datasetSearch} onChange={(event) => setDatasetSearch(event.target.value)}/>
          <div className="rd-business-list">
            {__ui(businessChoices.map(({ value, label }) => (<button className="rd-source" key={value} disabled={!writable} onClick={() => chooseSource(value)}>
                <ChartNoAxesCombined size={16}/>
                <span>{__ui(label)}</span>
                <ChevronDown size={14}/>
              </button>)))}
            {__ui(!businessChoices.length && (<p className="rd-muted">{__ui("没有匹配的数据表")}</p>))}
          </div>
          <p>{__ui("选择数据集可更新当前组件；拖动组件可调整位置。")}</p>
        </aside>
        <main className="rd-stage">
          <div className="rd-stage-caption">{__ui("A4 纵向 · 实时数据预览")}</div>
          <style>{`@media print{@page{size:${doc.layout.page?.paper||'A4'} ${doc.layout.page?.orientation||'portrait'};margin:${doc.layout.page?.margin||12}mm;${doc.layout.page?.pageNumbers!==false?'@bottom-right{content:counter(page) " / " counter(pages)}':''}}}`}</style>
          <article className="rd-paper" style={{maxWidth:doc.layout.page?.orientation==='landscape'?'1100px':undefined,padding:doc.layout.page?`${doc.layout.page.margin}mm`:undefined}}>
            <div className="rd-paper-brand">
              PROJECT STUDIO <span>{__ui("项目数据报告")}</span>
            </div>
            {__ui(sections.map(({ id, label, hint }) => (<section key={id} className="rd-section" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault();
                move(event.dataTransfer.getData("block"), id);
            }}>
                <div className="rd-section-label">
                  <strong>{__ui(label)}</strong>
                  <span>{__ui(hint)}</span>
                  {__ui(!preview && writable && (<button title={__uiFormat("向{0}添加组件", [label])} onClick={() => add(id, id === "header"
                    ? "title"
                    : id === "detail"
                        ? "chart"
                        : "text")}>
                      <Plus size={14}/>
                    </button>))}
                </div>
                {__ui(doc.layout.sections[id].map((block) => renderBlock(block, id)))}
                {__ui(!doc.layout.sections[id].length && (<div className="rd-drop">{__ui("将组件拖至此处")}</div>))}
              </section>)))}
          </article>
        </main>
        <aside className="rd-properties">
          <div className="rd-panel-heading">{__ui("属性设置")}</div>
          {__ui(chosen ? (<>
              <div className="rd-property-type">
                {__ui(types.find((type) => type[0] === chosen.type)?.[1])}{__ui(" ")}
                <button onClick={remove} disabled={!writable}>{__ui("删除")}</button>
              </div>
<label><input type="checkbox" disabled={!writable} checked={!!chosen.pageBreakBefore} onChange={e=>updateBlock({pageBreakBefore:e.target.checked})}/>{__ui('组件前分页')}</label><label><input type="checkbox" disabled={!writable} checked={chosen.keepTogether!==false} onChange={e=>updateBlock({keepTogether:e.target.checked})}/>{__ui('组件保持整块')}</label>
 {chosen.type==='subreport'&&<label>{__ui('引用子报表')}<select aria-label={__ui('引用子报表')} disabled={!writable} value={chosen.reportId||''} onChange={e=>updateBlock({reportId:e.target.value})}><option value="">{__ui('请选择')}</option>{reportChoices?.filter(r=>r.id!==doc.id).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
 {['table','chart','kpi'].includes(chosen.type)&&<label>{__ui('计算公式')}<textarea aria-label={__ui('计算公式')} disabled={!writable} value={chosen.formula||''} onChange={e=>updateBlock({formula:e.target.value})}/><small>{__ui('变量 VALUE、TOTAL、COUNT、VALUES；函数 IF、ROUND、SUM、AVG、MIN、MAX、ABS、POWER、AND、OR。示例：IF(TOTAL=0,0,ROUND(VALUE/TOTAL*100,2))。适用于分组统计，不适用于原始明细或交叉表。')}</small></label>}
              <div className="rd-position-actions">
                <button onClick={() => nudge(-1)} disabled={!writable}>{__ui("上移")}</button>
                <button onClick={() => nudge(1)} disabled={!writable}>{__ui("下移")}</button>
                <select aria-label={__ui("组件分区")} value={chosenSection} onChange={(event) => move(chosen.id, event.target.value as Section)} disabled={!writable}>
                  {__ui(sections.map((section) => (<option key={section.id} value={section.id}>
                      {__ui(section.label)}
                    </option>)))}
                </select>
              </div>
              {__ui(["title", "text"].includes(chosen.type) ? (<label>{__ui("文字内容")}<textarea value={chosen.text || ""} onChange={(event) => updateBlock({ text: event.target.value })} disabled={!writable} rows={chosen.type === "text" ? 5 : 2}/>
                </label>) : chosen.type !== "divider" ? (<>
                  <label>{__ui("组件标题")}<input value={chosen.title || ""} onChange={(event) => updateBlock({ title: event.target.value })} disabled={!writable}/>
                  </label>
                  <label>{__ui("数据集")}<select value={sourceValue} onChange={(event) => updateBlock(sourcePatch(event.target.value))} disabled={!writable}>
                      {__ui(!sourceChoices.some((item) => item.value === sourceValue) && (<option value={sourceValue}>{__ui("数据表不可用或无权限")}</option>))}
                      {__ui(sourceChoices.map(({ value, label }) => (<option key={value} value={value}>
                          {__ui(label)}
                        </option>)))}
                    </select>
                  </label>
                  {chosen.type==='table'&&chosen.source==='business_table'&&<label>{__ui('明细展示字段')}<select multiple aria-label={__ui('明细展示字段')} value={chosen.detailFields||[]} disabled={!writable} onChange={e=>updateBlock({detailFields:[...e.target.selectedOptions].map(o=>o.value).slice(0,12),dimension2:undefined})}>{selectedDataset?.fields?.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select><small>{__ui('留空显示分组统计；选择后展示原始记录，最多12列。')}</small></label>}
                  <label>{__ui("分组维度")}<select value={chosen.dimension || dimensionChoices[0]?.[0] || ""} onChange={(event) => updateBlock({
                    dimension: event.target.value,
                    dimension2: chosen.dimension2 === event.target.value
                        ? undefined
                        : chosen.dimension2,
                })} disabled={!writable || !dimensionChoices.length}>
                      {__ui(dimensionChoices.map(([key, label]) => (<option key={key} value={key}>
                          {__ui(label)}
                        </option>)))}
                    </select>
                  </label>
                  <label>{__ui("统计指标")}<select value={chosen.metric || metricChoices[0]?.[0] || ""} onChange={(event) => updateBlock({
                    metric: event.target.value,
                    aggregation: event.target.value === "__count__"
                        ? "count"
                        : "sum",
                })} disabled={!writable || !metricChoices.length}>
                      {__ui(metricChoices.map(([key, label]) => (<option key={key} value={key}>
                          {__ui(label)}
                        </option>)))}
                    </select>
                  </label>
                  {__ui(chosen.source === "business_table" ? (<>
                      {__ui(chosen.type === "table" && (<label>{__ui("交叉列维度")}<select aria-label={__ui("交叉列维度")} value={chosen.dimension2 || ""} onChange={(event) => updateBlock({
                            dimension2: event.target.value || undefined,
                            detailFields: undefined,
                        })} disabled={!writable}>
                            <option value="">{__ui("不限（普通统计表）")}</option>
                            {__ui(dimensionChoices
                            .filter(([key]) => key !== chosen.dimension)
                            .map(([key, label]) => (<option key={key} value={key}>
                                  {__ui(label)}
                                </option>)))}
                          </select>
                        </label>))}
                      <label>{__ui("汇总方式")}<select value={chosen.metric === "__count__"
                        ? "count"
                        : chosen.aggregation || "sum"} onChange={(event) => updateBlock({ aggregation: event.target.value })} disabled={!writable || chosen.metric === "__count__"}>
                          <option value="count">{__ui("计数")}</option>
                          <option value="sum">{__ui("求和")}</option>
                          <option value="average">{__ui("平均值")}</option>
                          <option value="min">{__ui("最小值")}</option>
                          <option value="max">{__ui("最大值")}</option>
                        </select>
                      </label>
                      {__ui(selectedDataset?.is_view ? (<p className="rd-muted">{__ui("视图结果按视图定义筛选源记录状态；此处统计全部查询结果。")}</p>) : (<label>{__ui("记录状态")}<select value={chosen.status || "approved"} onChange={(event) => updateBlock({ status: event.target.value })} disabled={!writable}>
                            <option value="approved">{__ui("已审核")}</option>
                            <option value="pending">{__ui("待审核")}</option>
                            <option value="draft">{__ui("草稿")}</option>
                            <option value="all">{__ui("全部有效状态")}</option>
                          </select>
                        </label>))}
                      <div className="rd-panel-heading rd-style-heading">{__ui("数据筛选")}</div>
                      <label>{__ui("筛选字段")}<select value={chosen.filterField || ""} onChange={(event) => updateBlock({
                        filterField: event.target.value || undefined,
                        filterValue: undefined,
                    })} disabled={!writable}>
                          <option value="">{__ui("不限")}</option>
                          {__ui(selectedDataset?.dimensions
                        .filter((field) => !field.id.startsWith("__"))
                        .map((field) => (<option key={field.id} value={field.id}>
                                {field.name}
                              </option>)))}
                        </select>
                      </label>
                      {__ui(chosen.filterField && (<>
                          <label>{__ui("匹配方式")}<select value={chosen.filterOperator || "equals"} onChange={(event) => updateBlock({
                            filterOperator: event.target
                                .value as Block["filterOperator"],
                        })} disabled={!writable}>
                              <option value="equals">{__ui("等于")}</option>
                              <option value="contains">{__ui("包含")}</option>
                            </select>
                          </label>
                          <label>{__ui("筛选值")}<input value={chosen.filterValue || ""} maxLength={160} onChange={(event) => updateBlock({ filterValue: event.target.value })} placeholder={__ui("输入字段值")} disabled={!writable}/>
                          </label>
                        </>))}
                      <label>{__ui("日期字段")}<select value={chosen.dateField ||
                        (selectedDataset?.is_view ? "" : "__created_date__")} onChange={(event) => updateBlock({ dateField: event.target.value })} disabled={!writable || !selectedDataset?.dates.length}>
                          {__ui(!selectedDataset?.dates.length && (<option value="">{__ui("无日期列")}</option>))}
                          {__ui(selectedDataset?.dates.map((field) => (<option key={field.id} value={field.id}>
                              {field.name}
                            </option>)))}
                        </select>
                      </label>
                      <label>{__ui('统计周期')}<select aria-label={__ui('统计周期')} value={chosen.datePreset||''} disabled={!writable} onChange={e=>updateBlock({datePreset:(e.target.value||undefined) as Block['datePreset'],dateFrom:undefined,dateTo:undefined})}>{[['','全部 / 自定义日期'],['day','今日'],['week','本周（周一至周日）'],['fortnight','近14天'],['month','本月']].map(([value,label])=><option key={value} value={value}>{__ui(label)}</option>)}</select></label>
                      <div className="rd-date-range">
                        <label>{__ui("起始日期")}<input type="date" value={chosen.dateFrom || ""} onChange={(event) => updateBlock({
                        dateFrom: event.target.value || undefined,datePreset:undefined,
                    })} disabled={!writable || !selectedDataset?.dates.length}/>
                        </label>
                        <label>{__ui("结束日期")}<input type="date" value={chosen.dateTo || ""} onChange={(event) => updateBlock({
                        dateTo: event.target.value || undefined,datePreset:undefined,
                    })} disabled={!writable || !selectedDataset?.dates.length}/>
                        </label>
                      </div>
                      <p className="rd-muted">{__ui("筛选后统计当前账号有权查看的记录；单次最多处理 10,000 条。")}</p>
                    </>) : (<label>{__ui("部门范围")}<select value={chosen.departmentId || ""} onChange={(event) => updateBlock({
                        departmentId: event.target.value || undefined,
                    })} disabled={!writable}>
                        <option value="">{__ui("全部可见部门")}</option>
                        {__ui(departments?.map((department) => (<option key={department.id} value={department.id}>
                            {department.name}
                          </option>)))}
                      </select>
                    </label>))}
                  {__ui(chosen.type === "chart" && chosen.chartType === "gauge" && (<label>{__ui("仪表图目标 / 上限")}<input type="number" min="0.0001" step="any" value={chosen.gaugeMax ?? 100} onChange={(e) => updateBlock({ gaugeMax: Number(e.target.value) })} disabled={!writable}/>
                    </label>))}
                  {__ui(chosen.type === "chart" &&
                    chosen.chartType === "scatter" &&
                    selectedDataset && (<label>{__ui("散点图X指标")}<select value={chosen.xMetric || ""} onChange={(e) => updateBlock({
                        xMetric: e.target.value || undefined,
                    })} disabled={!writable}>
                          <option value="">{__ui("序号")}</option>
                          {__ui(selectedDataset.metrics.map((f) => (<option key={f.id} value={f.id}>
                              {f.name}
                            </option>)))}
                        </select>
                      </label>))}
                  {__ui(chosen.type === "chart" && (<label>{__ui("图表类型")}<select value={chosen.chartType || "bar"} onChange={(event) => updateBlock({ chartType: event.target.value })} disabled={!writable}>
                        {__ui(chartTypes.map(([key, label]) => (<option key={key} value={key}>
                            {__ui(label)}
                          </option>)))}
                      </select>
                    </label>))}
                </>) : null)}
              {__ui(chosen.type !== "divider" && (<>
                  <div className="rd-panel-heading rd-style-heading">{__ui("外观")}</div>
                  <label>{__ui("文字对齐")}<select value={chosen.align || "left"} onChange={(event) => updateBlock({
                    align: event.target.value as Block["align"],
                })} disabled={!writable}>
                      <option value="left">{__ui("左对齐")}</option>
                      <option value="center">{__ui("居中")}</option>
                      <option value="right">{__ui("右对齐")}</option>
                    </select>
                  </label>
                  <label>{__ui("字号")}<input type="number" min="10" max="40" value={chosen.fontSize ||
                    (chosen.type === "title"
                        ? 25
                        : chosen.type === "text"
                            ? 12
                            : 14)} onChange={(event) => updateBlock({ fontSize: Number(event.target.value) })} disabled={!writable}/>
                  </label>
                  <label>{__ui("文字颜色")}<input type="color" value={chosen.color || "#233b42"} onChange={(event) => updateBlock({ color: event.target.value })} disabled={!writable}/>
                  </label>
                </>))}
            </>) : (<p className="rd-muted">{__ui("选择页面中的组件，编辑文字、数据来源、统计指标及图表类型。")}</p>))}
        </aside>
      </div>
    </div>);
}
