import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Plus, PenLine, Trash2, Eye } from "lucide-react";
import { api, useApp, useApi, PageTitle, Modal, Loading, ErrorBox, Confirm, } from "./lib";
import { displayValue, typeLabels as types } from "../shared/fields";
const aggregations = [
    ["none", "原值 / 分组"],
    ["count", "计数"],
    ["sum", "求和"],
    ["average", "平均值"],
    ["min", "最小值"],
    ["max", "最大值"],
];
const operators = [
    ["equals", "等于"],
    ["notEquals", "不等于"],
    ["contains", "包含"],
    ["gt", "大于"],
    ["gte", "大于等于"],
    ["lt", "小于"],
    ["lte", "小于等于"],
    ["empty", "为空"],
    ["notEmpty", "不为空"],
];
const initial = () => ({
    sources: [],
    joins: [],
    columns: [],
    filters: [],
    status: "all",
});
export default function PublicViews({ tables, selected, onSelect, headingTools, }: {
    headingTools?:ReactNode;
    tables: any[];
    selected?: string;
    onSelect: (id: string) => void;
}) {
    const { boot, project, context, tick, reload, notify } = useApp();
    const { data: folder, error } = useApi<any>(`/projects/${project.id}/public`, tick);
    const [editing, setEditing] = useState<any>(), [remove, setRemove] = useState<any>(), [columnRemove, setColumnRemove] = useState<any>();
    const [menu, setMenu] = useState(""), [sort, setSort] = useState<any>(), [group, setGroup] = useState(""), [page, setPage] = useState(1);
    const views = folder?.tables.filter((t: any) => t.is_view) || [], view = views.find((t: any) => t.id === selected) || views[0];
    useEffect(() => {
        setSort(undefined);
        setGroup("");
        setPage(1);
        setMenu("");
    }, [view?.id]);
    const { data: result, error: resultError } = useApi<any>(view
        ? `/tables/${view.id}/records?page=${page}&group=${encodeURIComponent(group)}${sort ? `&sort=${encodeURIComponent(sort.id)}&direction=${sort.direction}` : ""}`
        : null, tick);
    const canManage = (boot.user.username === "admin" || boot.user.system_admin) &&
        context.permission.manage;
    if (error)
        return <ErrorBox message={__ui(error)}/>;
    return (<section className="data-inner public-views-workbench data-workbench spreadsheet-layout">
      <div className="sheet-heading"><PageTitle icon={Eye} title={__ui("public 数据视图")} subtitle={__ui("关联源表 · 条件筛选 · 分组汇总 · 实时更新")}/>{headingTools}</div>
      <div className="view-selection data-toolbar">
        {__ui(canManage&&<button className="primary" onClick={()=>setEditing({})}><Plus size={16}/>{__ui("新建视图")}</button>)}
        <label>{__ui("当前视图")}{__ui(" ")}
          <select aria-label={__ui("当前public视图")} value={view?.id || ""} onChange={(e) => onSelect(e.target.value)}>
            <option value="">{__ui("选择视图")}</option>
            {__ui(views.map((v: any) => (<option key={v.id} value={v.id}>
                {v.name}
              </option>)))}
          </select>
        </label>
        {__ui(view && canManage && (<>
            <button onClick={() => setEditing(view)}>
              <PenLine size={16}/>{__ui("设计视图")}</button>
            <button className="danger" onClick={() => setRemove(view)}>
              <Trash2 size={16}/>{__ui("删除视图")}</button>
          </>))}
      </div>
      <p className="help">{__ui("视图保存选表、选列、关联和筛选规则，不复制数据；当前项目所有成员均可读取已生效记录的视图结果，源表仍按各自权限访问。视图只读，可供项目总览和报表使用。")}</p>
      {__ui(result?.summary && (<p className="help">{__ui("全部匹配的")}{__ui(result.summary.count)}{__ui("行：")}{__ui(result.summary.columns
                .map((x: any) => `${x.name}：${x.invalidCount ? "存在计算错误" : `和 ${x.sum}，最大 ${x.max ?? "—"}，最小 ${x.min ?? "—"}`}`)
                .join("；"))}
        </p>))}
      {__ui(resultError ? (<ErrorBox message={__ui(resultError)}/>) : view && !result ? (<Loading />) : result ? (<>
          <div className="table-scroll">
            <table className="data-grid" data-style-key={view?.id}>
              <thead>
                <tr>
                  {__ui(result.table.columns.map((c: any) => (<th data-style-column={c.id} key={c.id} style={{ position: "relative" }}>
                      <button onClick={() => setMenu(menu === c.id ? "" : c.id)}>
                        {c.name}
                        <span className="column-menu-arrow"/>
                      </button>
                      {__ui(menu === c.id && (<div className="column-menu" role="menu">
                          <button onClick={() => {
                        setSort({ id: c.id, direction: "asc" });
                        setPage(1);
                        setMenu("");
                    }}>{__ui("升序排序")}</button>
                          <button onClick={() => {
                        setSort({ id: c.id, direction: "desc" });
                        setPage(1);
                        setMenu("");
                    }}>{__ui("降序排序")}</button>
                          <button onClick={() => {
                        setGroup(c.id);
                        setSort({ id: c.id, direction: "asc" });
                        setPage(1);
                        setMenu("");
                    }}>{__ui("加入归类")}</button>
                          {__ui(canManage && (<>
                              <button onClick={() => {
                            setEditing(view);
                            setMenu("");
                        }}>{__ui("修改列")}</button>
                              <button className="danger" disabled={view.definition.columns.length === 1} onClick={() => {
                            setColumnRemove(c);
                            setMenu("");
                        }}>{__ui("删除列")}</button>
                            </>))}
                        </div>))}
                    </th>)))}
                </tr>
              </thead>
              <tbody>
                {__ui(result.rows.map((r: any, i: number) => (<Fragment key={r.id}>
                    {__ui(group &&
                    (i === 0 ||
                        String(result.rows[i - 1].data[group]) !==
                            String(r.data[group])) && (<tr className="group-row">
                          <td colSpan={result.table.columns.length}>
                            {displayValue(r.data[group]) || "未填写"}
                          </td>
                        </tr>))}
                    <tr>
                      {__ui(result.table.columns.map((c: any) => (<td key={c.id}>{displayValue(r.data[c.id])}</td>)))}
                    </tr>
                  </Fragment>)))}
              </tbody>
            </table>
          </div>
          <div className="view-selection table-footer">
            <span>{__ui("共")}{__ui(result.total)}{__ui(" 行 · 第 ")}{__ui(page)}{__ui("页 · 每页50行")}</span>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>{__ui("上一页")}</button>
            <button disabled={page * 50 >= result.total} onClick={() => setPage(page + 1)}>{__ui("下一页")}</button>
            {__ui((sort || group) && (<button onClick={() => {
                    setSort(undefined);
                    setGroup("");
                    setPage(1);
                }}>{__ui("恢复默认顺序")}</button>))}
          </div>
        </>) : (<div className="empty">{__ui("尚未创建查询视图。点击“新建视图”，选择源表和输出字段。")}</div>))}
      {__ui(editing && (<ViewDesigner tables={tables.filter((t) => !t.is_mapping && t.lifecycle === "active")} view={editing} onClose={() => setEditing(undefined)} onSaved={(id) => {
                setEditing(undefined);
                onSelect(id);
                reload();
                notify("public视图已保存，源数据变动会实时反映");
            }}/>))}
      {__ui(remove && (<Confirm title={__ui("删除public视图")} detail={__ui("删除视图会使引用该视图的图表失去数据源，源表和原始数据保留。")} onClose={() => setRemove(undefined)} onConfirm={async () => {
                await api(`/public/views/${remove.id}`, "DELETE", {});
                setRemove(undefined);
                reload();
                notify("视图已删除");
            }}/>))}
      {__ui(columnRemove && (<Confirm title={__ui("删除视图列")} detail={__uiFormat("移除输出列“{0}”，不会删除源表字段。关联该列的图表需重新配置。", [columnRemove.name])} onClose={() => setColumnRemove(undefined)} onConfirm={async () => {
                await api(`/public/views/${view.id}`, "PUT", {
                    name: view.name,
                    version: view.version,
                    definition: {
                        ...view.definition,
                        columns: view.definition.columns.filter((c: any) => c.id !== columnRemove.id),
                    },
                });
                setColumnRemove(undefined);
                reload();
                notify("视图列已移除");
            }}/>))}
    </section>);
}
function ViewDesigner({ tables, view, onClose, onSaved, }: {
    tables: any[];
    view: any;
    onClose: () => void;
    onSaved: (id: string) => void;
}) {
    const { project } = useApp(), [name, setName] = useState(view.name || ""), [d, setD] = useState<any>(view.definition || initial()), [preview, setPreview] = useState<any>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [tableSearch,setTableSearch]=useState(""),[columnSearch,setColumnSearch]=useState(""),[step,setStep]=useState(0);
    useEffect(() => {
        setPreview(undefined);
    }, [d]);
    const sources = d.sources.map((id: string) => tables.find((t) => t.id === id));
    const choices = sources.flatMap((t: any, i: number) => (t?.columns || []).filter((c:any)=>c.lifecycle!=="deleted").map((c: any) => ({
        value: `${i}:${c.id}`,
        name: `${t.name} · ${c.name}`,
    })));
    const encoded = (r: any) => (r ? `${r.source}:${r.field}` : "");
    const decode = (value: string) => {
        const [source, ...rest] = value.split(":");
        return { source: Number(source), field: rest.join(":") };
    };
    const selectField = (value: any, onChange: (v: any) => void, filter?: (v: any) => boolean, label="选择源字段") => (<select aria-label={__ui(label)} value={encoded(value)} onChange={(e) => onChange(e.target.value ? decode(e.target.value) : undefined)}>
      <option value="">{__ui("选择源字段")}</option>
      {__ui(choices
            .filter((c: any) => !filter || filter(decode(c.value)))
            .map((c: any) => (<option key={c.value} value={c.value}>
            {c.name}
          </option>)))}
    </select>);
    function updateColumn(i: number, patch: any) {
        setD({
            ...d,
            columns: d.columns.map((c: any, j: number) => i === j ? { ...c, ...patch } : c),
        });
    }
    function sourceChange(i: number, id: string) {
        if (i === 0) {
            setD({...initial(),sources:id?[id]:[],columns:[]});
            return;
        }
        const next=d.sources.slice(0,i);
        if(id)next.push(id);
        const keep=(ref:any)=>ref&&ref.source<i;
        const main=tables.find(t=>t.id===next[0]), added=tables.find(t=>t.id===id);
        const pair=(main?.columns||[]).flatMap((left:any)=>(added?.columns||[]).filter((right:any)=>(left.id===right.id||left.name===right.name)&&left.type===right.type).map((right:any)=>({left,right})))[0];
        setD({...d,sources:next,
          joins:[...d.joins.slice(0,i-1),...(id?[{kind:"left",left:{source:0,field:pair?.left.id||""},right:{source:i,field:pair?.right.id||""}}]:[])],
          columns:d.columns.filter((c:any)=>!c.field||keep(c.field)),
          filters:d.filters.filter((f:any)=>keep(f.field))});
    }
    function toggleColumn(source:number,c:any) {
        const existing=d.columns.findIndex((out:any)=>out.field?.source===source&&out.field?.field===c.id&&out.aggregation==="none");
        if(existing>=0){setD({...d,columns:d.columns.filter((_:any,i:number)=>i!==existing)});return}
        if(d.columns.length>=50)return;
        const ids=new Set(d.columns.map((x:any)=>x.id));let n=1;while(ids.has(`col_${n}`))n++;
        setD({...d,columns:[...d.columns,{id:`col_${n}`,name:c.name,field:{source,field:c.id},aggregation:"none"}]});
    }
    const filteredTables=tables.filter(t=>!tableSearch.trim()||t.name.toLowerCase().includes(tableSearch.trim().toLowerCase())||String(t.department_name||"").toLowerCase().includes(tableSearch.trim().toLowerCase()));
    const readySources=d.sources.length>0&&d.joins.length===d.sources.length-1&&d.joins.every((j:any)=>j.left?.field&&j.right?.field);
    const readyColumns=d.columns.length>0&&d.columns.every((c:any)=>c.name.trim()&&(c.field?.field||c.aggregation==="count"));
    async function run(save: boolean) {
        setBusy(true);
        setError("");
        try {
            const r = await api(save
                ? view.id
                    ? `/public/views/${view.id}`
                    : `/projects/${project.id}/public/views`
                : `/projects/${project.id}/public/views/preview`, save && view.id ? "PUT" : "POST", { name, definition: d, ...(view.id ? { version: view.version } : {}) });
            if (save)
                onSaved(r.id);
            else
                setPreview(r);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return (<Modal title={__ui(view.id ? "设计public视图" : "新建public视图")} onClose={onClose} wide>
      <div className="view-designer">
        <nav className="view-steps" aria-label={__ui("视图设计步骤")}>
          {["1 选择数据源","2 选择发布列","3 规则与预览"].map((label,i)=><button key={label} type="button" className={step===i?"active":""} aria-current={step===i?"step":undefined} disabled={(i>0&&!readySources)||(i>1&&!readyColumns)} onClick={()=>{setError("");setStep(i)}}>{__ui(label)}</button>)}
        </nav>
        <div className="view-design-summary">{name.trim()||__ui("未命名视图")}{__ui(" · ")}{d.sources.length}{__ui(" 张表 · ")}{d.columns.length}{__ui(" 个发布列 · ")}{d.filters.length}{__ui(" 个筛选条件")}</div>
        <section className="view-design-step" hidden={step!==0}>
        <label>{__ui("视图名称")}<input aria-label={__ui("视图名称")} value={name} onChange={(e) => setName(e.target.value)} placeholder={__ui("例如：各部门月度费用汇总")}/>
        </label>
        <h3>{__ui("选择主表与关联表")}</h3>
        <p className="help">{__ui("先选择主表，再按需添加最多两张关联表。更换主表会清空后续设置。")}</p>
        {d.sources.length>0&&<div className="view-chosen-sources">{sources.map((t:any,i:number)=><span key={d.sources[i]}>{i===0?__ui("主表"):__ui("关联表")}{__ui("：")}{t?.name}</span>)}</div>}
        <input aria-label={__ui("搜索源表")} placeholder={__ui("搜索表名或部门")} value={tableSearch} onChange={e=>setTableSearch(e.target.value)}/>
        <div className="view-source-picker" role="group" aria-label={__ui("选择源表")}>
          {filteredTables.map((t:any)=><button key={t.id} type="button" className={d.sources.includes(t.id)?"active":""} disabled={!d.sources.includes(t.id)&&d.sources.length>=3} onClick={()=>{const i=d.sources.indexOf(t.id);sourceChange(i>=0?i:d.sources.length,i>=0?"":t.id)}}>
            <span>{t.name}</span><small>{t.department_name||__ui("部门数据表")}</small>
          </button>)}
        </div>
        {!filteredTables.length&&<p className="help">{__ui("没有匹配的数据表，请修改搜索词。")}</p>}
        {d.sources.slice(1).map((id:string,i:number)=><div className="view-source-row" key={id}>
          <strong>{sources[i+1]?.name}</strong>
          <select aria-label={__uiFormat("关联方式{0}",[i+1])} value={d.joins[i]?.kind} onChange={e=>setD({...d,joins:d.joins.map((j:any,k:number)=>k===i?{...j,kind:e.target.value}:j)})}>
            <option value="left">{__ui("左关联（保留主表）")}</option><option value="inner">{__ui("内关联（仅匹配）")}</option>
          </select>
          {selectField(d.joins[i]?.left,v=>setD({...d,joins:d.joins.map((j:any,k:number)=>k===i?{...j,left:v}:j)}),v=>v.source<=i,"左侧关联字段")}
          <span>=</span>
          {selectField(d.joins[i]?.right,v=>setD({...d,joins:d.joins.map((j:any,k:number)=>k===i?{...j,right:v}:j)}),v=>v.source===i+1,"右侧关联字段")}
        </div>)}
        {d.sources.length>1&&<p className="help">{__ui("关联字段的值必须相等。若未自动匹配，请从左右两侧选择对应编码或唯一键。")}</p>}
        </section>
        <section className="view-design-step" hidden={step!==2}>
        <h3>{__ui("筛选源数据")}</h3>
        <p className="help">{__ui("视图只读取已确认有效的源记录。")}</p>
        {__ui(d.filters.map((f: any, i: number) => (<div className="view-rule-row" key={i}>
            {__ui(selectField(f.field, (v) => setD({
                ...d,
                filters: d.filters.map((r: any, j: number) => i === j ? { ...r, field: v } : r),
            })))}
            <select aria-label={__ui("筛选运算符")} value={f.operator} onChange={(e) => setD({
                ...d,
                filters: d.filters.map((r: any, j: number) => i === j ? { ...r, operator: e.target.value } : r),
            })}>
              {__ui(operators.map(([id, label]) => (<option key={id} value={id}>
                  {__ui(label)}
                </option>)))}
            </select>
            <input aria-label={__ui("筛选值")} value={f.value} disabled={["empty", "notEmpty"].includes(f.operator)} onChange={(e) => setD({
                ...d,
                filters: d.filters.map((r: any, j: number) => i === j ? { ...r, value: e.target.value } : r),
            })}/>
            <button aria-label={__ui("删除筛选")} onClick={() => setD({
                ...d,
                filters: d.filters.filter((_: any, j: number) => i !== j),
            })}>{__ui("删除")}</button>
          </div>)))}
        <button disabled={!d.sources.length || d.filters.length >= 20} onClick={() => setD({
            ...d,
            filters: [
                ...d.filters,
                {
                    field: { source: 0, field: sources[0]?.columns[0]?.id },
                    operator: "equals",
                    value: "",
                },
            ],
        })}>{__ui("＋添加筛选条件（全部满足）")}</button>
        </section>
        <section className="view-design-step" hidden={step!==1}>
        <h3>{__ui("选择发布列与分组汇总")}</h3>
        <p className="help">{__ui("public视图的这些输出列会向当前项目所有成员公开，请确认不含敏感字段。")}{__ui(" 已选 ")}{d.columns.length}{__ui(" 列")}</p>
        <div className="view-column-workspace"><div className="view-column-source"><input aria-label={__ui("搜索源列")} placeholder={__ui("搜索列名")} value={columnSearch} onChange={e=>setColumnSearch(e.target.value)}/>
        <div className="view-column-picker">
          {sources.map((t:any,i:number)=><section key={d.sources[i]}>
            <strong>{t?.name}</strong>
            <button type="button" className="view-select-all" onClick={()=>{
              const present=new Set(d.columns.filter((out:any)=>out.field?.source===i&&out.aggregation==="none").map((out:any)=>out.field.field));
              const visible=(t?.columns||[]).filter((c:any)=>c.lifecycle!=="deleted"&&(!columnSearch.trim()||c.name.toLowerCase().includes(columnSearch.trim().toLowerCase()))&&!present.has(c.id));
              const ids=new Set(d.columns.map((out:any)=>out.id));let n=1;
              const added=visible.slice(0,50-d.columns.length).map((c:any)=>{while(ids.has(`col_${n}`))n++;const id=`col_${n++}`;ids.add(id);return {id,name:c.name,field:{source:i,field:c.id},aggregation:"none"}});
              setD({...d,columns:[...d.columns,...added]});
            }}>{__ui("选择本表可见列")}</button>
            <div>{(t?.columns||[]).filter((c:any)=>c.lifecycle!=="deleted"&&(!columnSearch.trim()||c.name.toLowerCase().includes(columnSearch.trim().toLowerCase()))).map((c:any)=><label key={c.id}>
              <input type="checkbox" checked={d.columns.some((out:any)=>out.field?.source===i&&out.field?.field===c.id&&out.aggregation==="none")} onChange={()=>toggleColumn(i,c)}/>
              <span>{c.name}</span><small>{__ui(types[c.type as keyof typeof types]||c.type)}</small>
            </label>)}</div>
          </section>)}
        </div>
        </div><div className="view-column-output"><details className="view-advanced-options"><summary>{__ui("高级设置：多行关联汇总")}</summary><label className="checkbox-label">
          <input type="checkbox" checked={!!d.allow_duplicate_aggregation} onChange={(e) => setD({ ...d, allow_duplicate_aggregation: e.target.checked })}/>{__ui("允许按展开后的关联行汇总（可能重复计算主表金额，默认禁止）")}</label>
        <p className="help">{__ui("出现汇总列时，所有“原值 / 分组”列共同组成分组；计数可不选源字段。")}</p></details>
        <h3>{__ui("已选择的输出列")}</h3>
        {!d.columns.length&&<p className="help">{__ui("从上面的字段清单选择至少一列。")}</p>}
        <div className="table-scroll view-output-scroll">
          <table>
            <thead>
              <tr>
                <th>{__ui("输出列名")}</th>
                <th>{__ui("源字段")}</th>
                <th>{__ui("处理方式")}</th>
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(d.columns.map((c: any, i: number) => (<tr key={c.id}>
                  <td>
                    <input aria-label={__uiFormat("输出列名{0}", [i + 1])} value={c.name} onChange={(e) => updateColumn(i, { name: e.target.value })}/>
                  </td>
                  <td>
                    {__ui(selectField(c.field, (v) => updateColumn(i, { field: v })))}
                  </td>
                  <td>
                    <select aria-label={__uiFormat("汇总方式{0}", [i + 1])} value={c.aggregation} onChange={(e) => updateColumn(i, { aggregation: e.target.value })}>
                      {__ui(aggregations.map(([id, label]) => (<option key={id} value={id}>
                          {__ui(label)}
                        </option>)))}
                    </select>
                  </td>
                  <td>
                    <button aria-label={__uiFormat("删除输出列{0}", [i + 1])} onClick={() => setD({
                ...d,
                columns: d.columns.filter((_: any, j: number) => i !== j),
            })}>{__ui("删除")}</button>
                  </td>
                </tr>)))}
            </tbody>
          </table>
        </div>
        <button disabled={!d.sources.length || d.columns.length >= 50} onClick={() => setD({
            ...d,
            columns: [
                ...d.columns,
                {
                    id: `col_${Date.now().toString(36)}`,
                    name: "新增列",
                    aggregation: "none",
                    field: { source: 0, field: sources[0]?.columns[0]?.id },
                },
            ],
        })}>{__ui("＋添加输出列")}</button></div></div>
        </section>
        <section className="view-design-step view-preview-step" hidden={step!==2}>
          <h3>{__ui("结果预览")}</h3>
          <p className="help">{__ui("按已确认有效的记录计算，保存后项目成员即可读取发布列。")}</p>
        {__ui(preview && (<>
            <p>{__ui("关联筛选后")}{__ui(preview.matched)}{__ui(" 条，视图结果 ")}{__ui(preview.total)}{__ui(" ")}{__ui("行，预览前 50 行。")}</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {__ui(preview.columns.map((c: any) => (<th key={c.id}>{c.name}</th>)))}
                  </tr>
                </thead>
                <tbody>
                  {__ui(preview.rows.map((r: any) => (<tr key={r.id}>
                      {__ui(preview.columns.map((c: any) => (<td key={c.id}>{displayValue(r.data[c.id])}</td>)))}
                    </tr>)))}
                </tbody>
              </table>
            </div>
          </>))}

        </section>
        {__ui(error && <ErrorBox message={__ui(error)}/>)}
        <div className="form-actions view-design-actions">
          {step>0&&<button onClick={()=>{setError("");setStep(step-1)}}>{__ui("上一步")}</button>}
          {step<2?<button className="primary" disabled={step===0?!readySources:!readyColumns} onClick={()=>{setError("");setStep(step+1)}}>{__ui("下一步")}</button>:<>
            <button disabled={busy || !readyColumns} onClick={() => run(false)}>{__ui("预览查询结果")}</button>
            <button className="primary" disabled={busy || !name.trim() || !readyColumns || !readySources} onClick={() => run(true)}>{__ui(busy ? "处理中…" : "保存视图")}</button>
          </>}
        </div>
      </div>
    </Modal>);
}
