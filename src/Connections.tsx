import DatabaseConnectionForm from './DatabaseConnectionForm';
import { translateUiValue as __ui } from "./i18n";
import { useState, type ReactNode } from "react";
import QueryLibrary from "./QueryLibrary";
import { Database, Plus, Play, Plug, Trash2, ShieldCheck } from "lucide-react";
import { api, useApi, useApp, PageTitle, ErrorBox, Empty, Confirm, } from "./lib";
export default function Connections({headingTools,workspaceOverride}:{headingTools?:ReactNode;workspaceOverride?:any}) {
    const app=useApp(),{tick,reload,notify}=app,workspace=workspaceOverride||app.workspace, { data, error } = useApi<any[]>(workspace.role === "owner"
        ? `/workspaces/${workspace.id}/connections`
        : null, tick), [selected, setSelected] = useState(""), [modal, setModal] = useState(""), [sql, setSql] = useState("SELECT 1 AS connection_ok"), [result, setResult] = useState<any>(null), [busy, setBusy] = useState(false), [queryError, setQueryError] = useState("");
    const [libraryRevision, setLibraryRevision] = useState(0);
    function exportCsv() {
        if (!result?.columns?.length)
            return;
        const cell = (value: unknown) => {
            const text = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
            return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const csv = [
            result.columns,
            ...result.rows.map((row: any) => result.columns.map((column: string) => row[column])),
        ]
            .map((row) => row.map(cell).join(","))
            .join("\r\n");
        const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `query-result-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        notify(`已导出 ${result.rows.length} 行 CSV`);
    }
    const con = data?.find((c) => c.id === selected) || data?.[0];
    async function query(test = false) {
        setBusy(true);
        setQueryError("");
        setResult(null);
        try {
            setResult(await api(`/connections/${con.id}/query`, "POST", test ? {} : { sql }));
        }
        catch (e) {
            setQueryError((e as Error).message);
        }
        finally {
            setBusy(false);
            setLibraryRevision((v) => v + 1);
        }
    }
    if (workspace.role !== "owner")
        return (<div className="data-inner data-workbench"><div className="sheet-heading"><PageTitle icon={Database} title={__ui("数据库工作台")}/>{headingTools}</div><Empty text={__ui("数据库工作台仅对工作空间所有者开放")}>
        <p>{__ui("普通成员请通过授权的数据表查看和录入数据。")}</p>
      </Empty></div>);
    return (<div className="data-inner data-workbench">
      <div className="sheet-heading"><PageTitle icon={Database} title={__ui("数据库工作台")} subtitle={__ui("MySQL / PostgreSQL · 对象浏览与只读查询")}/>{headingTools}</div>
      <div className="data-toolbar"><button className="primary" disabled={modal==="create"} onClick={() => setModal("create")}><Plus size={16}/>{__ui("添加连接")}</button></div>
      {modal==='create'&&<DatabaseConnectionForm onCancel={()=>setModal('')} onTest={body=>api(`/workspaces/${workspace.id}/connections/test`,'POST',body)} onSave={async body=>{
        const result=await api(`/workspaces/${workspace.id}/connections`,'POST',body);setSelected(result.id);setModal('');reload();notify(__ui('\u8fde\u63a5\u5df2\u4fdd\u5b58\uff0c\u53ef\u6d4b\u8bd5\u8fde\u901a\u6027'));
      }}/>}
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="connection-selector">
        {__ui(data?.map((c) => (<button key={c.id} disabled={busy} className={c.id === con?.id ? "active" : ""} onClick={() => {
                setSelected(c.id);
                setResult(null);
                setQueryError("");
                setSql("SELECT 1 AS connection_ok");
            }}>
            <Database size={17}/>
            {c.name}
            <small>{__ui(c.engine)}</small>
          </button>)))}
      </div>
      {__ui(modal!=='create'&&(!con ? (<Empty text={__ui("连接你的第一个数据库")}>
          <p>{__ui("凭据加密存储在服务器中，浏览器不会收到已保存的密码。")}</p>
        </Empty>) : (<>
          <div className="sql-toolbar">
            <span>
              <ShieldCheck size={16}/>{__ui("只读事务 · 最多500行")}</span>
            <button disabled={busy} onClick={() => void query(true)}>
              <Plug size={15}/>{__ui("测试连接 / 对象")}</button>
            <button disabled={busy} className="primary" onClick={() => void query()}>
              <Play size={15}/>
              {__ui(busy ? "执行中…" : "执行查询")}
            </button>
            <button className="icon-button danger" aria-label={__ui("删除连接")} disabled={busy} onClick={() => setModal("delete")}>
              <Trash2 size={16}/>
            </button>
          </div>
          <textarea className="sql-editor" aria-label={__ui("SQL编辑器")} spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)}/>
          {__ui(queryError && <ErrorBox message={__ui(queryError)}/>)}
          <div className="query-result">
            {__ui(result ? (<>
                <div className="section-heading">
                  <h3>{__ui("查询结果")}</h3>
                  <small>
                    {__ui(result.rows.length)}{__ui(" 行 · ")}{__ui(result.duration_ms)} ms{__ui(" ")}
                    {__ui(result.truncated ? "· 结果已截断" : "")}
                  </small>
                  <button onClick={exportCsv}>{__ui("导出 CSV")}</button>
                </div>
                <div className="grid-scroll">
                  <table className="data-grid">
                    <thead>
                      <tr>
                        {__ui(result.columns.map((c: string) => (<th key={c}>{__ui(c)}</th>)))}
                      </tr>
                    </thead>
                    <tbody>
                      {__ui(result.rows.map((r: any, i: number) => (<tr key={i}>
                          {__ui(result.columns.map((c: string) => (<td key={c}>
                              {__ui(typeof r[c] === "object"
                            ? JSON.stringify(r[c])
                            : String(r[c] ?? "NULL"))}
                            </td>)))}
                        </tr>)))}
                    </tbody>
                  </table>
                </div>
              </>) : (<Empty text={__ui("执行查询后在这里查看结果")}/>))}
          </div>
          <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
            <QueryLibrary key={con.id} connection={con.id} sql={sql} revision={libraryRevision} onLoad={(value) => {
                setSql(value);
                setResult(null);
                setQueryError("");
            }}/>
          </fieldset>
        </>)))}
      {__ui(modal === "delete" && (<Confirm title={__ui("移除连接")} detail={__ui("只移除本平台保存的连接，不删除外部数据库。")} onClose={() => setModal("")} onConfirm={async () => {
                await api(`/connections/${con.id}`, "DELETE", {});
                setModal("");
                setSelected("");
                setResult(null);
                reload();
            }}/>))}
    </div>);
}
