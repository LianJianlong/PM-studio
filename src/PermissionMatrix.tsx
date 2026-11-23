import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import PermissionHierarchy, { CrudChecks } from "./PermissionHierarchy";
import { useState } from "react";
import { api, useApi, useApp, ErrorBox, Loading, Empty, Confirm, roles, timestamp, useUnsavedChanges, } from "./lib";
type Grant = {
    project_role_id: string | null;
    crud_permissions: Record<string, {
        read: boolean;
        create: boolean;
        update: boolean;
        delete: boolean;
    }>;
    role: string;
    department_id: string | null;
    table_ids: string[];
    hidden_columns: string[];
    row_scope: string;
    can_export: boolean;
    expires_at: string | null;
};
type Member = {
    user_id: string;
    name: string;
    username: string;
    active: boolean;
    workspace_role: string;
    grant: (Grant & {
        revision: string;
    }) | null;
};
type Draft = {
    expected_revision: string | null;
    before: Grant | null;
    grant: Grant | null;
};
function clean(grant?: Partial<Grant> | null): Grant {
    return {
        project_role_id: grant?.project_role_id ?? null,
        crud_permissions: grant?.crud_permissions ?? {},
        role: grant?.role || "viewer",
        department_id: grant?.department_id ?? null,
        table_ids: grant?.table_ids ?? [],
        hidden_columns: grant?.hidden_columns ?? [],
        row_scope: grant?.row_scope ?? "all",
        can_export: grant?.can_export ?? false,
        expires_at: grant?.expires_at ?? null,
    };
}
function localDate(value: string | null) {
    if (!value)
        return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19);
}
function MultiScope({ label, values, options, disabled, onChange, emptyText, }: {
    label: string;
    values: string[];
    options: {
        id: string;
        label: string;
    }[];
    disabled: boolean;
    onChange: (v: string[]) => void;
    emptyText: string;
}) {
    const ids = new Set(options.map((o) => o.id));
    const allOptions = [
        ...options,
        ...values
            .filter((v) => !ids.has(v))
            .map((id) => ({ id, label: `${id}（当前列表之外）` })),
    ];
    return (<details className="scope-picker">
      <summary aria-label={__ui(label)}>
        {__ui(values.length ? `已选 ${values.length} 项` : emptyText)}
      </summary>
      <div>
        <p className="help">{__ui(emptyText)}</p>
        {__ui(allOptions.map((option) => (<label key={option.id} className="checkbox-label">
            <input type="checkbox" checked={values.includes(option.id)} disabled={disabled} onChange={(e) => onChange(e.target.checked
                ? [...values, option.id]
                : values.filter((v) => v !== option.id))}/>
            {__ui(option.label)}
          </label>)))}
        {__ui(!allOptions.length && <small>{__ui("暂无可选项")}</small>)}
      </div>
    </details>);
}
export default function PermissionMatrix({ project, tables, initialUser = "", }: {
    project: any;
    tables: any[];
    initialUser?: string;
}) {
    const { context, tick, reload, notify } = useApp();
    const { data, error, loading } = useApi<{
        rows: Member[];
    }>(`/projects/${project.id}/permission-matrix`, tick);
    const { data: roleDefinitions } = useApi<any[]>(`/projects/${project.id}/roles`, tick);
    const [drafts, setDrafts] = useState<Record<string, Draft>>({}), [search, setSearch] = useState(""), [userFilter, setUserFilter] = useState(initialUser), [advanced, setAdvanced] = useState(false), [hierarchyUser, setHierarchyUser] = useState(initialUser), [review, setReview] = useState(false), [discard, setDiscard] = useState(false), [failure, setFailure] = useState("");
    const count = Object.keys(drafts).length;
    useUnsavedChanges(count > 0);
    if (error)
        return <ErrorBox message={__ui(error)}/>;
    if (!data)
        return <Loading />;
    const rows = data.rows.filter((u) => (!userFilter || u.user_id === userFilter) &&
        `${u.name} ${u.username}`.toLowerCase().includes(search.toLowerCase()));
    const columnOptions = [
        ...new Set<string>(tables.flatMap((t) => t.columns.map((f: any) => f.id))),
    ]
        .sort()
        .map((id) => {
        const sources = tables.filter((t) => t.columns.some((f: any) => f.id === id));
        const f = sources[0].columns.find((f: any) => f.id === id);
        return { id, label: `${f.name} · ${id}（${sources.length}张表）` };
    });
    function edit(u: Member, change: (g: Grant | null) => Grant | null) {
        setDrafts((previous) => {
            const original = previous[u.user_id] ?? {
                expected_revision: u.grant?.revision ?? null,
                before: u.grant ? clean(u.grant) : null,
                grant: u.grant ? clean(u.grant) : null,
            };
            const grant = change(original.grant), next = { ...previous };
            if (JSON.stringify(grant) === JSON.stringify(original.before))
                delete next[u.user_id];
            else
                next[u.user_id] = { ...original, grant };
            return next;
        });
        setFailure("");
    }
    const update = (u: Member, patch: Partial<Grant>) => edit(u, (g) => ({ ...clean(g), ...patch }));
    const summary = Object.entries(drafts)
        .map(([id, d]) => {
        const user = data.rows.find((r) => r.user_id === id);
        const g = d.grant;
        const who = `${user?.name || id}（${user?.username || id}）`;
        if (!g)
            return __uiFormat("{0}：撤销项目访问权限", [who]);
        const department = context.departments.find((v: any) => v.id === g.department_id)?.name ||
            g.department_id ||
            __ui("全部部门");
        const tableNames = g.table_ids
            .map((id) => tables.find((t) => t.id === id)?.name || id)
            .join("、") || __ui("部门内全部表");
        const scope = g.role === "manager"
            ? __ui("整个项目管理权限")
            : __uiFormat("{0}；表：{1}；隐藏列：{2}；{3}；{4}导出", [department, tableNames, g.hidden_columns.join("、") || __ui("无"), __ui(g.row_scope === "own" ? "本人记录" : "全部授权记录"), __ui(g.can_export ? "允许" : "禁止")]);
        return __uiFormat("{0}：{1}；{2}；操作权限：{3}；{4}", [who, __ui(roles[g.role]), scope, JSON.stringify(g.crud_permissions), g.expires_at ? __ui("到期 ") + timestamp(g.expires_at) : __ui("长期有效")]);
    })
        .join("\n");
    return (<>
      <div className="permission-intro">
        <div>
          <strong>{__ui("项目权限配置表")}</strong>
          <p>{__ui("直接编辑单元格后统一保存；任一成员冲突或校验失败，整批不生效。空间所有者的权限由空间身份继承。")}</p>
        </div>
      </div>
      <div className="matrix-toolbar">
        <input aria-label={__ui("搜索授权成员")} placeholder={__ui("按姓名或账号搜索")} value={search} onChange={(e) => setSearch(e.target.value)}/>
        {__ui(userFilter && (<button onClick={() => setUserFilter("")}>{__ui("显示全部成员")}</button>))}
        <button onClick={() => setAdvanced(v => !v)}>{__ui(advanced ? "收起范围设置" : "部门 / 表 / 记录范围")}</button>
        <span>
          {__ui(count
            ? `${count}名成员有未保存修改（包括筛选外成员）`
            : "暂无未保存修改")}
        </span>
        <button className="primary" disabled={!count || count > 100 || loading} onClick={() => setReview(true)}>{__ui("检查并保存修改")}</button>
        <button disabled={!count} onClick={() => setDiscard(true)}>{__ui("放弃修改并刷新")}</button>
      </div>
      {__ui(failure && <ErrorBox message={__ui(failure)}/>)}
      <div className={`grid-scroll ${advanced ? "" : "matrix-compact"}`}>
        <table className="data-grid permission-grid">
          <thead>
            <tr>
              {__ui([
            "成员",
            "项目角色",
            "增", "删", "改", "查", "层级范围",
            "部门",
            "数据表",
            "隐藏列标识",
            "记录范围",
            "导出 / 报表",
            "授权到期（本地时间）",
            "配置状态",
        ].map((s) => (<th key={s}>{__ui(s)}</th>)))}
            </tr>
          </thead>
          <tbody>
            {__ui(rows.map((u) => {
            const draft = drafts[u.user_id], g = draft ? draft.grant : u.grant;
            const owner = u.workspace_role === "owner", manager = g?.role === "manager", disabled = owner || !g || !!manager || !!g.project_role_id;
            const stale = !!draft &&
                draft.expected_revision !== (u.grant?.revision ?? null);
            const label = (s: string) => `${u.username} ${s}`;
            return (<tr key={u.user_id} className={draft ? "matrix-dirty" : ""}>
                  <td>
                    <strong>{u.name}</strong>
                    <small>
                      {u.username}
                      {__ui(!u.active ? " · 账号已停用" : "")}
                    </small>
                  </td>
                  <td>
                    <select aria-label={__ui(label("项目角色"))} disabled={owner} value={owner ? "owner" : g?.project_role_id || g?.role || ""} onChange={(e) => edit(u, (old) => e.target.value
                    ? roleDefinitions?.some(r => r.id === e.target.value)
                        ? { ...clean(roleDefinitions.find(r => r.id === e.target.value).grant_config), project_role_id: e.target.value, expires_at: old?.expires_at ?? null }
                        : { ...clean(old), role: e.target.value, project_role_id: null }
                    : null)}>
                      {__ui(owner ? (<option value="owner">{__ui("空间所有者（继承）")}</option>) : (<>
                          <option value="">{__ui("未加入 / 撤销")}</option>
                          {__ui(roleDefinitions?.map(r => <option key={r.id} value={r.id}>{r.name}</option>))}
                          {__ui(["viewer", "editor", "reviewer", "manager"].map((r) => (<option key={r} value={r}>
                                {__ui(roles[r])}
                              </option>)))}
                        </>))}
                    </select>
                  </td>
                  <CrudChecks grant={owner ? { role: 'owner' } : g} scope="$data" label={u.username + __ui(' 项目数据')} disabled={disabled} onChange={patch => update(u, patch)}/>
                  <td><button disabled={!g && !owner} onClick={() => setHierarchyUser(hierarchyUser === u.user_id ? '' : u.user_id)}>{__ui("层级权限")}</button></td>
                  <td>
                    <select aria-label={__ui(label("部门范围"))} disabled={disabled} value={g?.department_id || ""} onChange={(e) => update(u, { department_id: e.target.value || null })}>
                      <option value="">{__ui("全部部门")}</option>
                      {__ui(context.departments.map((d: any) => (<option key={d.id} value={d.id}>
                          {d.name}
                        </option>)))}
                    </select>
                  </td>
                  <td>
                    <MultiScope label={__ui(label("数据表范围"))} disabled={disabled} values={g?.table_ids || []} options={tables.map((t) => ({
                    id: t.id,
                    label: `${t.department_name} · ${t.name}`,
                }))} emptyText={__ui("未选即全部授权表")} onChange={(table_ids) => update(u, { table_ids })}/>
                  </td>
                  <td>
                    <MultiScope label={__ui(label("隐藏列标识"))} disabled={disabled} values={g?.hidden_columns || []} options={columnOptions} emptyText={__ui("未选即不隐藏")} onChange={(hidden_columns) => update(u, { hidden_columns })}/>
                  </td>
                  <td>
                    <select aria-label={__ui(label("记录范围"))} disabled={disabled} value={g?.row_scope || "all"} onChange={(e) => update(u, { row_scope: e.target.value })}>
                      <option value="all">{__ui("全部授权记录")}</option>
                      <option value="own">{__ui("仅本人录入")}</option>
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" aria-label={__ui(label("允许导出和报表"))} disabled={disabled} checked={owner || manager || !!g?.can_export} onChange={(e) => update(u, { can_export: e.target.checked })}/>
                  </td>
                  <td>
                    <input type="datetime-local" step="1" aria-label={__ui(label("授权到期"))} disabled={owner || !g} value={localDate(g?.expires_at ?? null)} onChange={(e) => update(u, {
                    expires_at: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : null,
                })}/>
                  </td>
                  <td>
                    {__ui(owner
                    ? "由空间身份继承"
                    : stale
                        ? "版本已变化，请刷新核对"
                        : draft
                            ? "待保存"
                            : g?.expires_at &&
                                Date.parse(g.expires_at) <= Date.now()
                                ? "已到期"
                                : g
                                    ? "已授权"
                                    : "未授权")}
                    {__ui(draft && (<button className="text-button" onClick={() => setDrafts((prev) => {
                        const next = { ...prev };
                        delete next[u.user_id];
                        return next;
                    })}>{__ui("撤销本行编辑")}</button>))}
                  </td>
                </tr>);
        }))}
          </tbody>
        </table>
      </div>
      {__ui(hierarchyUser && data.rows.find(u => u.user_id === hierarchyUser) && (() => { const u = data.rows.find(u => u.user_id === hierarchyUser)!; const g = drafts[u.user_id] ? drafts[u.user_id].grant : u.grant; return <PermissionHierarchy key={u.user_id} project={project} tables={tables} user={u} grant={u.workspace_role === 'owner' ? clean({ role: 'owner' }) : g} disabled={u.workspace_role === 'owner' || !g || g.role === 'manager' || !!g.project_role_id} onChange={patch => update(u, patch)}/>; })())}
      {__ui(!rows.length && <Empty text={__ui("没有匹配的成员")}/>)}
      <p className="help">{__ui("自定义角色的权限在项目角色管理中维护，用户分配时可设置授权到期时间。")}</p>
      <p className="help">{__ui("经理角色拥有整个项目的管理权限，部门、表、隐藏列和记录范围不限制经理。普通角色的数据表范围与部门取交集；隐藏列按标识作用于项目内同名字段。到期留空为长期有效。切换项目、模块或关闭页面前请保存修改。")}</p>
      {__ui(review && (<Confirm title={__ui("保存项目权限表")} detail={__ui(summary)} onClose={() => setReview(false)} onConfirm={async () => {
                try {
                    await api(`/projects/${project.id}/permission-matrix`, "PUT", {
                        changes: Object.entries(drafts).map(([user_id, d]) => ({
                            user_id,
                            expected_revision: d.expected_revision,
                            grant: d.grant,
                        })),
                    });
                    setDrafts({});
                    setReview(false);
                    setFailure("");
                    reload();
                    notify(`已保存${count}名成员的权限`);
                }
                catch (e) {
                    setReview(false);
                    setFailure((e as Error).message);
                }
            }}/>))}
      {__ui(discard && (<Confirm title={__ui("放弃未保存的权限修改")} detail={__ui("本页所有未保存修改将被清除，并重新获取服务器上的最新授权。")} onClose={() => setDiscard(false)} onConfirm={async () => {
                setDrafts({});
                setFailure("");
                setDiscard(false);
                reload();
            }}/>))}
    </>);
}
