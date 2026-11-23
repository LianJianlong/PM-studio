import BusinessActionManager from './BusinessActionManager';
import BusinessOntologyManager from './BusinessOntologyManager';
import StorageTargets from './StorageTargets';
import Connections from './Connections';
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import PanelToggle, { usePanelCollapsed } from "./PanelToggle";
import RecycleBin from "./RecycleBin";
import { FieldTypeOptions, ValueEditor, fieldOptions } from "./FieldControls";
import { inputValue, isSystemField, typeLabels } from "../shared/fields";
import { Layers, Plus, Trash2 } from "lucide-react";
import { api, useApi, useApp, PageTitle, Form, Field, Modal, Confirm, ErrorBox, Loading, Empty, today, Status, } from "./lib";
import "./object-manager.css";
const labels: Record<string, string> = {
    workspace: "空间",
    project: "项目",
    table: "表",
    column: "列",
    record: "行",
};
const states: Record<string, string> = {
    active: "活动",
    frozen: "冻结",
    disabled: "停用",
    deleted: "已删除",
};
export default function ObjectManager() {
    const [hierarchyCollapsed, toggleHierarchy] = usePanelCollapsed("object-hierarchy");
    const [connectionView,setConnectionView]=useState(false),[connectionKind,setConnectionKind]=useState<'storage'|'query'>('storage');
    const [actionView,setActionView]=useState(false);
    const [ontologyView,setOntologyView]=useState(false);
    const [design, setDesign] = useState(false);
    const [recycle, setRecycle] = useState(false);
    const { boot, workspace: appWorkspace, project: appProject, tick, reload, notify, context: appContext, } = useApp();
    const [level, setLevel] = useState("workspace"), [workspaceId, setWorkspaceId] = useState(appWorkspace?.id || ""), [projectId, setProjectId] = useState(appProject?.id || ""), [tableId, setTable] = useState(""), [columnId, setColumnId] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [modal, setModal] = useState<any>(null), [confirm, setConfirm] = useState<any>(null);
    const spaces = useApi<any[]>("/objects/workspaces", tick);
    const storageTargets=useApi<any>("/storage-targets",tick);
    const workspace = spaces.data?.find((w) => w.id === workspaceId && w.lifecycle !== "deleted");
    const projects = useApi<any[]>(workspace ? `/objects/workspaces/${workspace.id}/projects` : null, tick);
    const project = projects.data?.find((p) => p.id === projectId && p.lifecycle !== "deleted");
    const { data: tables, error: tableError } = useApi<any[]>(project ? `/objects/projects/${project.id}/tables` : null, tick);
    const departments = useApi<any[]>(project ? `/objects/projects/${project.id}/departments` : null, tick);
    const context = { ...appContext, departments: departments.data || [] };
    const table = tables?.find((t) => t.id === tableId && t.lifecycle !== "deleted"), column = table?.columns.find((f: any) => f.id === columnId);
    const url = table && column
        ? `/objects/tables/${table.id}/records?excludeDeleted=true&page=${page}&search=${encodeURIComponent(search)}&column=${encodeURIComponent(column.id)}`
        : null;
    const recordList = useApi<any>(url, tick), data = level === "workspace"
        ? spaces.data
        : level === "project"
            ? projects.data
            : recordList.data;
    const error = spaces.error || projects.error || recordList.error, loading = level === "workspace"
        ? spaces.loading
        : level === "project"
            ? projects.loading
            : level === "table" || level === "column"
                ? !tables && !tableError
                : recordList.loading;
    const rows = level === "table"
        ? tables || []
        : level === "column"
            ? table?.columns || []
            : level === "record"
                ? data?.rows || []
                : data || [];
    const filtered = level === "record"
        ? rows.filter((r: any) => r.lifecycle !== "deleted")
        : rows
            .filter((r: any) => r.lifecycle !== "deleted")
            .filter((r: any) => `${r.name} ${r.id}`.toLowerCase().includes(search.toLowerCase()));
    const version = (r: any) => level === "column"
        ? table.object_version
        : level === "record"
            ? r.version
            : r.object_version;
    const endpoint = (r: any) => level === "column"
        ? `/objects/tables/${table.id}/columns/${r.id}`
        : `/objects/${level}/${r.id}`;
    const canManageRow=(kind:string,row:any)=>kind!=="workspace"||boot.user.system_admin||row.workspace_role==="owner";
    const deletableHierarchy=(kind:string,row:any)=>["workspace","project","table"].includes(kind)&&canManageRow(kind,row);
    function requestDelete(kind:string,row:any){
        setConfirm({kind,row,state:"deleted",path:`/objects/${kind}/${row.id}`,version:row.object_version});
    }
    function clearDeletedSelection(kind:string,id:string){
        if(kind==="workspace"&&id===workspaceId){
            setWorkspaceId("");setProjectId("");setTable("");setColumnId("");setLevel("workspace");
        }else if(kind==="project"&&id===projectId){
            setProjectId("");setTable("");setColumnId("");setLevel("project");
        }else if(kind==="table"&&id===tableId){
            setTable("");setColumnId("");setDesign(false);setLevel("table");
        }
    }
    if(actionView&&(projectId||appProject?.id))return <BusinessActionManager project={projectId||appProject.id} onClose={()=>setActionView(false)}/>;
    if(ontologyView&&(projectId||appProject?.id))return <BusinessOntologyManager project={projectId||appProject.id} onClose={()=>setOntologyView(false)}/>;
    if(connectionView)return <div className="page"><PageTitle icon={Layers} title={__ui('\u5bf9\u8c61\u7ba1\u7406')+' / '+__ui('\u6570\u636e\u5e93\u8fde\u63a5')}><button onClick={()=>setConnectionView(false)}>{__ui('\u8fd4\u56de\u5bf9\u8c61\u5c42\u7ea7')}</button></PageTitle><div className="data-toolbar"><button className={connectionKind==='storage'?'active':''} onClick={()=>setConnectionKind('storage')}>{__ui('\u4e1a\u52a1\u5b58\u50a8')}</button><button className={connectionKind==='query'?'active':''} onClick={()=>setConnectionKind('query')}>{__ui('\u5916\u90e8\u53ea\u8bfb\u67e5\u8be2')}</button>{connectionKind==='query'&&<select aria-label={__ui('\u8fde\u63a5\u6240\u5c5e\u5de5\u4f5c\u7a7a\u95f4')} value={workspaceId} onChange={e=>setWorkspaceId(e.target.value)}>{spaces.data?.filter(w=>w.lifecycle!=='deleted').map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>}</div>{connectionKind==='storage'?<StorageTargets/>:workspace?<Connections key={workspace.id} workspaceOverride={{...workspace,role:workspace.workspace_role}}/>:<Empty text={__ui('\u8bf7\u5148\u9009\u62e9\u5de5\u4f5c\u7a7a\u95f4')}/>}</div>;
    if (recycle)
        return <RecycleBin onClose={() => setRecycle(false)}/>;
    return (<div className="page">
      <PageTitle icon={Layers} title={__ui("对象管理")} subtitle={__ui("空间、项目、表、列、行的状态与属性统一管理")}>
        <button disabled={!projectId&&!appProject?.id} onClick={()=>setActionView(true)}>{__ui('业务动作管理')}</button>
        <button disabled={!projectId&&!appProject?.id} onClick={()=>setOntologyView(true)}>{__ui('业务对象与关系')}</button>
        <button onClick={()=>setConnectionView(true)}>{__ui('\u6570\u636e\u5e93\u8fde\u63a5')}</button>
        <button onClick={() => setRecycle(true)}>{__ui("回收站")}</button>
        <button className="primary" disabled={level === "project"
            ? !workspace
            : level === "table"
                ? !project
                : ["column", "record"].includes(level)
                    ? !table
                    : false} onClick={() => setModal({ create: true })}>
          <Plus size={16}/>{__ui("新增")}{__ui(labels[level])}
        </button>
      </PageTitle>
      <section className="panel">
        <div className="section-heading">
          <h3>{__ui("对象层级")}</h3>
          <PanelToggle name="对象层级" controls="object-cascade-panel" collapsed={hierarchyCollapsed} onToggle={toggleHierarchy}/>
        </div>
        <div id="object-cascade-panel" className="object-cascade-scroll" hidden={hierarchyCollapsed}>
          <div className="object-cascade">
            {__ui([
            {
                key: "workspace",
                name: __ui("空间"),
                items: spaces.data || [],
                chosen: workspaceId,
                ready: true,
                pick: (id: string) => {
                    setWorkspaceId(id);
                    setProjectId("");
                    setTable("");
                    setColumnId("");
                    setLevel("project");
                },
            },
            {
                key: "project",
                name: __ui("项目"),
                items: projects.data || [],
                chosen: projectId,
                ready: !!workspace,
                pick: (id: string) => {
                    setProjectId(id);
                    setTable("");
                    setColumnId("");
                    setLevel("table");
                },
            },
            {
                key: "table",
                name: __ui("表"),
                items: tables || [],
                chosen: tableId,
                ready: !!project,
                pick: (id: string) => {
                    setTable(id);
                    setColumnId("");
                    setLevel("column");
                },
            },
            {
                key: "column",
                name: __ui("列"),
                items: table?.columns || [],
                chosen: columnId,
                ready: !!table,
                pick: (id: string) => {
                    setColumnId(id);
                    setLevel("record");
                },
            },
            {
                key: "record",
                name: __ui("行"),
                items: recordList.data?.rows || [],
                chosen: "",
                ready: !!column,
                pick: (id: string) => {
                    const r = recordList.data.rows.find((r: any) => r.id === id);
                    setLevel("record");
                    setModal({ detail: r });
                },
            },
        ].map((pane, i) => (<section key={pane.key} aria-label={__uiFormat("{0}层级", [pane.name])}>
                <button className={level === pane.key ? "active" : ""} disabled={!pane.ready} onClick={() => setLevel(pane.key)}>
                  {i + 1}. {pane.name}{__ui("管理")}</button>
                <div>
                  {__ui(pane.items
                .filter((item: any) => item.lifecycle !== "deleted")
                .map((item: any) => (<div className="object-tree-item" key={item.id}><button aria-label={__uiFormat("选择{0} {1}", [pane.name, item.name || item.id])} className={pane.chosen === item.id ? "selected" : ""} onClick={() => {
                    pane.pick(item.id);
                    setSearch("");
                    setPage(1);
                }}>
                        <strong>
                          {item.name ||
                    (column
                        ? String(item.data[column.id] ?? "空值")
                        : "行")}
                        </strong>
                        <small>
                          {__ui(states[item.lifecycle || "active"])}
                          {__ui(pane.key === "record"
                    ? " · " + item.id.slice(0, 8)
                    : "")}
                        </small>
                      </button>
                      {deletableHierarchy(pane.key,item)&&<button type="button" className="icon-button danger object-tree-delete"
                        aria-label={__uiFormat("删除{0}「{1}」",[pane.name,item.name])}
                        title={__ui("删除（可恢复）")}
                        onClick={()=>requestDelete(pane.key,item)}><Trash2 size={15}/></button>}
                    </div>)))}
                  {__ui(!pane.items.length && (<p className="help">
                      {__ui(pane.ready ? "暂无子对象" : "请先选择左侧父级")}
                    </p>))}
                </div>
              </section>)))}
          </div>
        </div>
        {__ui(design && level === "column" && table && (<div className="section-heading">
            <div>
              <h3>{__ui("表格设计 · ")}{table.name}</h3>
              <p className="help">{__ui("点击编辑调整列名与单位；新增列可选择数据类型、引用和鼠标公式。冻结、停用及删除保留服务端数据保护检查。")}</p>
            </div>
            <button onClick={() => {
                setDesign(false);
                setLevel("table");
                setSearch("");
            }}>{__ui("返回表列表")}</button>
            <button className="primary" onClick={() => setModal({ create: true })}>{__ui("新增字段")}</button>
          </div>))}
        <p className="help" hidden={hierarchyCollapsed}>{__ui("从左向右选择；更换父级会清空右侧选择。行属于表，选择列后显示该列在各行中的值。")}</p>
        <p className="help" hidden={hierarchyCollapsed}>{__ui("冻结和停用均保留查询、禁止业务写入；删除移入可恢复状态。上级非活动时，须先激活上级。审批状态与对象状态独立。")}</p>
        <div className="form-grid">
          <Field label={__ui("查找对象")}>
            <input value={search} placeholder={__ui("输入名称、标识；行管理搜索全部记录")} onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
        }}/>
          </Field>
        </div>
        {__ui((error ||
            (["table", "column", "record"].includes(level) && tableError)) && (<ErrorBox message={__ui(error || tableError || "")}/>))}
        {__ui(loading && url && !data ? (<Loading />) : (<div className="grid-scroll">
            <table className="data-grid object-grid">
              <thead>
                <tr>
                  <th>{__ui("名称 / 标识")}</th>
                  <th>{__ui("内容 / 属性")}</th>
                  <th>{__ui("对象状态")}</th>
                  <th>{__ui("版本")}</th>
                  <th>{__ui("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {__ui(filtered.map((r: any) => (<tr key={r.id}>
                    <td>
                      <strong>{r.name || r.id}</strong>{level==='workspace'&&r.storage_target_id&&<div className="help">{__ui('\u5b58\u50a8\u6570\u636e\u5e93\uff1a\u9884\u7559\u914d\u7f6e\uff08\u672a\u63a5\u5165\uff09')}</div>}
                      {__ui(r.name && <div className="help">{__ui(r.id)}</div>)}
                    </td>
                    <td>
                      {__ui(level === "record" ? (<>
                          <div className="object-preview">
                            {__ui(column
                        ? JSON.stringify(r.data[column.id] ?? null)
                        : JSON.stringify(r.data))}
                          </div>
                          <Status value={r.status}/>
                        </>) : level === "column" ? (<div className="field-design-summary">
                          <strong>
                            {__ui(typeLabels[r.type as keyof typeof typeLabels] ||
                        r.type)}{__ui(" ")}
                            · {__ui(r.required ? "必填" : "选填")} {__ui(r.unit || "")}
                          </strong>
                          {__ui(r.type === "formula" && (<code title={__ui(r.formula)}>{__ui(r.formula)}</code>))}
                        </div>) : (r.description || r.department_name || "—"))}
                    </td>
                    <td>{__ui(states[r.lifecycle || "active"])}</td>
                    <td>{__ui(version(r))}</td>
                    <td>
                      <div className="row-actions">
                        {__ui(level === "table" && (<button onClick={() => {
                        setTable(r.id);
                        setColumnId("");
                        setLevel("column");
                        setSearch("");
                        setDesign(true);
                        if (!hierarchyCollapsed)
                            toggleHierarchy();
                    }}>{__ui("表格设计")}</button>))}
                        {__ui(level !== "record" && canManageRow(level,r) && (<button onClick={() => setModal({ row: r })}>{__ui("编辑")}</button>))}
                        {__ui(level === "record" && (<button onClick={() => setModal({ detail: r })}>{__ui("查看")}</button>))}
                        {deletableHierarchy(level,r)&&<button type="button" className="danger" onClick={()=>requestDelete(level,r)}><Trash2 size={15}/>{__ui("删除（可恢复）")}</button>}
                        {__ui(canManageRow(level,r) &&
                    (["workspace","project","table"].includes(level)?["frozen","disabled","active"]:["frozen","disabled","deleted","active"])
                        .filter((s) => s !== (r.lifecycle || "active"))
                        .map((s) => (<button key={s} className={s==="deleted"?"danger":undefined} onClick={() => setConfirm({ row: r, state: s })}>
                                {__ui(s === "active"
                            ? r.lifecycle === "deleted"
                                ? "恢复"
                                : "激活"
                            : s === "deleted"
                                ? "删除（可恢复）"
                                : states[s])}
                              </button>)))}
                      </div>
                    </td>
                  </tr>)))}
              </tbody>
            </table>
          </div>))}
        {__ui(!filtered.length && (!loading || !url) && (<Empty text={__ui("当前范围没有可管理对象；空间由所有者管理，项目及数据对象由所有者或项目经理管理。")}/>))}
        {__ui(level === "record" && data && (<div className="form-actions">
            <span>{__ui("共")}{__ui(data.total)}{__ui(" 行 · 第 ")}{__ui(page)}{__ui("页")}</span>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{__ui("上一页")}</button>
            <button disabled={page * 50 >= data.total} onClick={() => setPage((p) => p + 1)}>{__ui("下一页")}</button>
          </div>))}
      </section>
      {__ui(confirm && (<Confirm title={__uiFormat("{0}{1}", [confirm.state === "deleted" ? __ui("删除") : states[confirm.state], labels[confirm.kind||level]])} detail={__uiFormat("对象：{0}。{1}{2}", [confirm.row.name || confirm.row.id, confirm.state === "deleted" ? __ui("对象将移入回收站并从日常入口隐藏。数据和历史保留，可在回收站恢复；有待审申请或受保护数据时无法删除。") : __ui("冻结/停用会限制子级写入；激活不会改变子级各自状态。"), level === "column" && (confirm.row.inverse_id || confirm.row.type === "backlink") ? __ui("此操作同时更新配对的引用列；已有引用关系时禁止删除。") : __ui("")])} onClose={() => setConfirm(null)} onConfirm={async () => {
                await api(confirm.path||endpoint(confirm.row), "PATCH", {
                    version: confirm.version??version(confirm.row),
                    lifecycle: confirm.state,
                });
                if(confirm.kind&&confirm.state==="deleted")clearDeletedSelection(confirm.kind,confirm.row.id);
                setConfirm(null);
                reload();
                notify(confirm.state==="deleted"?"已移入回收站":"对象状态已更新");
            }}/>))}
      {__ui(modal && (<Modal title={__ui(modal.detail
                ? "记录详情"
                : `${modal.create ? "新增" : "编辑"}${labels[level]}`)} onClose={() => setModal(null)} wide>
          {__ui(modal.detail ? (<>
              <p>{__ui("审批状态：")}<Status value={modal.detail.status}/>{__ui("· 对象状态：")}{__ui(states[modal.detail.lifecycle])}
              </p>
              <table className="data-grid">
                <tbody>
                  {__ui(Object.entries(modal.detail.data).map(([k, v]) => (<tr key={k}>
                      <th>
                        {table.columns.find((f: any) => f.id === k)?.name || k}
                      </th>
                      <td className="history-opinion">
                        {__ui(typeof v === "object"
                        ? JSON.stringify(v)
                        : String(v ?? "—"))}
                      </td>
                    </tr>)))}
                </tbody>
              </table>
              <p className="help">{__ui("编辑行内容请进入数据中心选择记录；待审和正式记录遵循审批锁定规则。")}</p>
            </>) : modal.create && level === "record" ? (<Form onClose={() => setModal(null)} onSubmit={async (d) => {
                    const fields = table.columns.filter((f: any) => !isSystemField(f) &&
                        f.type !== "formula" &&
                        (!f.lifecycle || f.lifecycle === "active"));
                    const values = Object.fromEntries(fields.map((f: any) => [
                        f.id,
                        f.type === "multi_select"
                            ? d.getAll(f.id).map(String)
                            : inputValue(f, String(d.get(f.id) ?? "")),
                    ]));
                    await api(`/tables/${table.id}/records`, "POST", {
                        data: values,
                    });
                    setModal(null);
                    reload();
                    notify("新行已保存到所选表");
                }}>
              <p className="help">{__ui("录入到所选项目的「")}{table.name}{__ui("」，保存为草稿。")}</p>
              {__ui(table.columns
                    .filter((f: any) => !isSystemField(f) &&
                    f.type !== "formula" &&
                    (!f.lifecycle || f.lifecycle === "active"))
                    .map((f: any) => (<Field key={f.id} label={f.name}>
                    <ValueEditor field={f} value={undefined} tableId={table.id}/>
                  </Field>)))}
            </Form>) : (<Form onClose={() => setModal(null)} onSubmit={async (d) => {
                    const body: any = { name: d.get("name") };
                    if(modal.create&&level==="workspace")body.storage_target_id=d.get("storage_target_id")||null;
                    if (["project", "table"].includes(level))
                        body.description = d.get("description") || "";
                    if (level === "project")
                        body.start_date = d.get("start_date");
                    if (level === "column") {
                        body.unit = d.get("unit") || "";
                        if (!modal.create && !["reference", "backlink"].includes(modal.row?.type))
                            body.definition = { id: modal.row.id, name: body.name, unit: body.unit, type: d.get("type"), required: d.get("required") === "on", ...fieldOptions(d) };
                    }
                    if (modal.create) {
                        let target = "/workspaces";
                        if (level === "project") {
                            if (!workspace)
                                throw Error("请先选择空间");
                            target = `/workspaces/${workspace.id}/projects`;
                        }
                        if (level === "table") {
                            if (!project)
                                throw Error("请先选择项目");
                            target = `/projects/${project.id}/tables`;
                            body.department_id = d.get("department_id");
                            body.columns = [
                                {
                                    id: "title",
                                    name: "事项",
                                    type: "text",
                                    required: true,
                                },
                            ];
                        }
                        if (level === "column") {
                            if (!table)
                                throw Error("请先选择表");
                            target = `/tables/${table.id}/columns`;
                            body.id = d.get("id");
                            body.type = d.get("type");
                            Object.assign(body, fieldOptions(d));
                            body.required = d.get("required") === "on";
                        }
                        await api(target, "POST", body);
                    }
                    else
                        await api(endpoint(modal.row), "PATCH", {
                            ...body,
                            version: version(modal.row),
                        });
                    setModal(null);
                    reload();
                    notify("对象已保存");
                }}>
              <Field label={__ui("名称")}>
                <input name="name" required maxLength={120} defaultValue={modal.row?.name || ""}/>
              </Field>
              {modal.create&&level==='workspace'&&<Field label={__ui('\u5b58\u50a8\u6570\u636e\u5e93')}><select name="storage_target_id" defaultValue=""><option value="">{__ui('\u5f53\u524d\u672c\u673a PostgreSQL')}</option>{storageTargets.data?.targets.filter((t:any)=>t.id).map((t:any)=><option key={t.id} value={t.id}>{t.name} - {__ui('\u9884\u7559\u914d\u7f6e\uff08\u672a\u63a5\u5165\uff09')}</option>)}</select><small className="help">{__ui('\u9009\u62e9\u9884\u7559\u914d\u7f6e\u4ec5\u8bb0\u5f55\u5b58\u50a8\u610f\u5411\uff1b\u672a\u63a5\u5165\u524d\u4e0d\u521b\u5efa\u9879\u76ee\u6216\u5199\u5165\u4e1a\u52a1\u6570\u636e\u3002')}</small>{storageTargets.error&&<ErrorBox message={storageTargets.error}/>}</Field>}
              {__ui(["project", "table"].includes(level) && (<Field label={__ui("描述")}>
                  <textarea name="description" maxLength={500} defaultValue={modal.row?.description || ""}/>
                </Field>))}
              {__ui(level === "project" && (<Field label={__ui("开始日期")}>
                  <input name="start_date" type="date" required defaultValue={modal.row?.start_date?.slice(0, 10) || today()}/>
                </Field>))}
              {__ui(modal.create && level === "table" && (<>
                  <Field label={__ui("所属部门")}>
                    <select name="department_id" required>
                      {__ui(context.departments.map((d: any) => (<option key={d.id} value={d.id}>
                          {d.name}
                        </option>)))}
                    </select>
                  </Field>
                  <p className="help">{__ui("初始包含“事项”文本列；创建后可在列管理中继续添加。")}</p>
                </>))}
              {__ui(level === "column" && (<>
                  <Field label={__ui("单位")}>
                    <input name="unit" maxLength={20} defaultValue={modal.row?.unit || ""}/>
                  </Field>
                  {__ui(modal.create && (<>
                      <Field label={__ui("字段标识")}>
                        <input name="id" required pattern="[a-zA-Z][a-zA-Z0-9_]{0,39}"/>
                      </Field>
                      <FieldTypeOptions fields={table?.columns || []} projectId={project?.id}/>
                    </>))}
                  {__ui(!modal.create && !["reference", "backlink"].includes(modal.row?.type) && <FieldTypeOptions initial={modal.row} fields={(table?.columns || []).filter((f: any) => f.id !== modal.row.id && f.lifecycle !== "deleted")} projectId={project?.id}/>)}
                </>))}
            </Form>))}
        </Modal>))}
    </div>);
}
