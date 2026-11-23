import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import "./query-library.css";
import { api, useApi, useApp, Modal, Form, Field, ErrorBox, Confirm, } from "./lib";
type SavedQuery = {
    id: string;
    name: string;
    sql: string;
    version: number;
    archived: boolean;
};
type History = {
    id: string;
    sql: string;
    succeeded: boolean;
    duration_ms: number;
    row_count: number | null;
    truncated: boolean;
    created_at: string;
};
export default function QueryLibrary({ connection, sql, revision, onLoad, }: {
    connection: string;
    sql: string;
    revision: number;
    onLoad: (sql: string) => void;
}) {
    const { notify } = useApp();
    const [refresh, setRefresh] = useState(0), [tab, setTab] = useState("saved"), [search, setSearch] = useState("");
    const [editing, setEditing] = useState<SavedQuery | "new" | null>(null), [archive, setArchive] = useState<SavedQuery | null>(null), [load, setLoad] = useState<string | null>(null);
    const { data, error } = useApi<{
        saved: SavedQuery[];
        history: History[];
    }>(`/connections/${connection}/query-library`, revision + refresh);
    const needle = search.trim().toLocaleLowerCase();
    const matches = (value: string) => value.toLocaleLowerCase().includes(needle);
    const saved = data?.saved.filter((q) => q.archived === (tab === "archive") && matches(q.name + " " + q.sql)) ?? [];
    return (<section className="query-library" aria-label={__ui("个人SQL查询库")}>
      <div className="section-heading">
        <h3>{__ui("我的查询库")}</h3>
        <button disabled={!sql.trim()} onClick={() => setEditing("new")}>{__ui("保存编辑器查询")}</button>
      </div>
      <p className="help">{__ui("仅当前账号可见，按连接保存；历史保留最近100次执行，不保存结果数据。移除连接会同时移除查询库。")}</p>
      <div className="sql-toolbar">
        {__ui([
            ["saved", "已保存"],
            ["history", "执行历史"],
            ["archive", "已归档"],
        ].map(([value, label]) => (<button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
            {__ui(label)}
          </button>)))}
        <input aria-label={__ui("搜索查询库")} placeholder={__ui("搜索名称或 SQL")} value={search} onChange={(e) => setSearch(e.target.value)}/>
      </div>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="query-library-list">
        {__ui(tab === "history"
            ? data?.history
                .filter((q) => matches(q.sql))
                .map((q) => (<article key={q.id} className="query-library-item">
                  <div>
                    <strong>{__ui(q.succeeded ? "执行成功" : "执行失败")}</strong>
                    <small>
                      {__ui(" ")}
                      {__ui(new Date(q.created_at).toLocaleString())} ·{__ui(" ")}
                      {__ui(q.duration_ms)} ms
                      {__ui(q.row_count !== null
                    ? ` · ${q.row_count} 行${q.truncated ? "（已截断）" : ""}`
                    : "")}
                    </small>
                    <pre>{__ui(q.sql)}</pre>
                  </div>
                  <button onClick={() => setLoad(q.sql)}>{__ui("载入编辑器")}</button>
                </article>))
            : saved.map((q) => (<article key={q.id} className="query-library-item">
                <div>
                  <strong>{q.name}</strong>
                  <small> · v{__ui(q.version)}</small>
                  <pre>{__ui(q.sql)}</pre>
                </div>
                <div className="query-library-actions">
                  <button onClick={() => setLoad(q.sql)}>{__ui("载入编辑器")}</button>
                  {__ui(!q.archived && (<button onClick={() => setEditing(q)}>{__ui("编辑")}</button>))}
                  <button onClick={() => setArchive(q)}>
                    {__ui(q.archived ? "恢复" : "归档")}
                  </button>
                </div>
              </article>)))}
        {__ui(data &&
            (tab === "history"
                ? !data.history.some((q) => matches(q.sql))
                : !saved.length) && <p className="help">{__ui("暂无符合条件的查询")}</p>)}
      </div>
      {__ui(editing && (<Modal title={__ui(editing === "new" ? "保存查询" : "编辑保存的查询")} onClose={() => setEditing(null)}>
          <Form onClose={() => setEditing(null)} onSubmit={async (d) => {
                const body = { name: d.get("name"), sql: d.get("sql") };
                await api(`/connections/${connection}/saved-queries${editing === "new" ? "" : `/${editing.id}`}`, editing === "new" ? "POST" : "PATCH", editing === "new"
                    ? body
                    : { ...body, version: editing.version });
                setEditing(null);
                setRefresh((v) => v + 1);
                notify("查询已保存");
            }}>
            <Field label={__ui("查询名称")}>
              <input name="name" required maxLength={120} defaultValue={editing === "new" ? "" : editing.name}/>
            </Field>
            <Field label={__ui("查询SQL")}>
              <textarea name="sql" required maxLength={20000} rows={8} defaultValue={editing === "new" ? sql : editing.sql}/>
            </Field>
          </Form>
        </Modal>))}
      {__ui(archive && (<Confirm title={__ui(archive.archived ? "恢复查询" : "归档查询")} detail={__ui(archive.archived
                ? "恢复后重新显示在已保存列表。"
                : "归档后仍可在已归档列表中恢复。")} onClose={() => setArchive(null)} onConfirm={async () => {
                await api(`/connections/${connection}/saved-queries/${archive.id}`, "PATCH", { version: archive.version, archived: !archive.archived });
                setArchive(null);
                setRefresh((v) => v + 1);
            }}/>))}
      {__ui(load !== null && (<Confirm title={__ui("载入查询")} detail={__ui("将替换编辑器当前内容；载入后需要点击执行查询才会运行。")} onClose={() => setLoad(null)} onConfirm={async () => {
                onLoad(load);
                setLoad(null);
            }}/>))}
    </section>);
}
