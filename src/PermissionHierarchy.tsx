import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, Fragment } from "react";
import { useApi, useApp, ErrorBox } from "./lib";
import { typeLabels } from "../shared/fields";
const types: Record<string, string> = typeLabels;
const actions = ["create", "delete", "update", "read"] as const, labels = { create: "增", delete: "删", update: "改", read: "查" };
export function defaultCrud(g: any, key: string) {
    if (!g)
        return { read: false, create: false, update: false, delete: false };
    const writable = ["editor", "manager", "owner"].includes(g.role);
    if (["owner", "manager"].includes(g.role))
        return { read: true, create: true, update: true, delete: true };
    const rule = g.crud_permissions?.[key] ??
        (key !== "$files" ? g.crud_permissions?.$data : undefined) ?? {
        read: true,
        create: writable,
        update: writable,
        delete: writable,
    };
    return {
        ...rule,
        create: writable && rule.create,
        update: writable && rule.update,
        delete: writable && rule.delete,
    };
}
export function CrudChecks({ grant, scope, label, disabled, onChange, }: {
    grant: any;
    scope: string;
    label: string;
    disabled: boolean;
    onChange: (patch: any) => void;
}) {
    const value = defaultCrud(grant, scope);
    const writable = grant && ["editor", "manager", "owner"].includes(grant.role);
    return (<>
      {__ui(actions.map((action) => (<td key={action} className="crud-cell">
          <input type="checkbox" aria-label={`${label} ${__ui(labels[action])}`} checked={!!value[action]} disabled={disabled || (action !== "read" && !writable)} onChange={(e) => {
                const next = { ...value, [action]: e.target.checked };
                if (action === "read" && !e.target.checked) {
                    next.create = false;
                    next.update = false;
                    next.delete = false;
                }
                if (action !== "read" && e.target.checked)
                    next.read = true;
                onChange({
                    crud_permissions: { ...grant.crud_permissions, [scope]: next },
                });
            }}/>
        </td>)))}
    </>);
}
export default function PermissionHierarchy({ project, tables, user, grant, disabled, onChange, }: {
    project: any;
    tables: any[];
    user: any;
    grant: any;
    disabled: boolean;
    onChange: (patch: any) => void;
}) {
    const { context, workspace } = useApp(), [collapsed, setCollapsed] = useState<string[]>([]), [showEmpty, setShowEmpty] = useState(false);
    const tree = useApi(`/projects/${project.id}/permission-tree`);
    const toggle = (key: string) => setCollapsed((old) => old.includes(key) ? old.filter((k) => k !== key) : [...old, key]);
    function row(key: string, name: string, level: number, scope: string, children: boolean, note: string, fixed = false) {
        const t = tables.find((t) => t.id === scope);
        const departmentId = scope.startsWith("department:")
            ? scope.slice(11)
            : null;
        const outside = !disabled &&
            ((!!t &&
                ((grant?.department_id && grant.department_id !== t.department_id) ||
                    (grant?.table_ids.length && !grant.table_ids.includes(t.id)))) ||
                (departmentId &&
                    grant?.department_id &&
                    grant.department_id !== departmentId));
        const inherited = t && !grant?.crud_permissions?.[scope]
            ? grant?.crud_permissions?.[`department:${t.department_id}`]
            : null;
        const baseGrant = inherited
            ? {
                ...grant,
                crud_permissions: { ...grant.crud_permissions, [scope]: inherited },
            }
            : grant;
        const displayGrant = outside
            ? {
                ...grant,
                crud_permissions: {
                    ...grant.crud_permissions,
                    [scope]: {
                        read: false,
                        create: false,
                        update: false,
                        delete: false,
                    },
                },
            }
            : baseGrant;
        return (<tr key={key}>
        <td style={{ paddingLeft: 12 + level * 20 }}>
          {__ui(children && (<button type="button" className="text-button" aria-label={__uiFormat("{0} {1}", [collapsed.includes(key) ? __ui("展开") : __ui("折叠"), name])} onClick={() => toggle(key)}>
              {__ui(collapsed.includes(key) ? "▸" : "▾")}
            </button>))}
          <strong>{name}</strong>
        </td>
        <CrudChecks grant={displayGrant} scope={scope} label={__ui(`${user.username} ${name}`)} disabled={disabled || fixed || !!outside} onChange={onChange}/>
        <td className="help">
          {__ui(outside ? "不在部门 / 表授权范围内" : note)}
          {__ui(!disabled && t && grant?.crud_permissions?.[scope] && (<button type="button" className="text-button" aria-label={__uiFormat("恢复继承 {0}", [t.name])} onClick={() => {
                    const rules = { ...grant.crud_permissions };
                    delete rules[scope];
                    onChange({ crud_permissions: rules });
                }}>{__ui("恢复继承")}</button>))}
        </td>
      </tr>);
    }
    function tableReadable(t: any) {
        if (disabled && ["manager", "owner"].includes(grant?.role))
            return true;
        const scoped = (!grant?.department_id || grant.department_id === t.department_id) &&
            (!grant?.table_ids.length || grant.table_ids.includes(t.id));
        return (scoped &&
            !!(grant?.crud_permissions?.[t.id] ??
                grant?.crud_permissions?.[`department:${t.department_id}`] ??
                defaultCrud(grant, "$data")).read);
    }
    function files(parent: string | null, depth: number, path = new Set<string>()): any {
        return (tree.data?.files || [])
            .filter((f: any) => f.parent_id === parent)
            .map((f: any) => {
            if (path.has(f.id) || depth > 40)
                return null;
            const next = new Set(path);
            next.add(f.id);
            return (<Fragment key={f.id}>
            {__ui(row(f.id, `${f.kind === "folder" ? "📁" : "📄"} ${f.name}`, depth, "$files", f.kind === "folder", "继承文件库操作权限", true))}
            {__ui(!collapsed.includes(f.id) && files(f.id, depth + 1, next))}
          </Fragment>);
        });
    }
    return (<section className="hierarchy-panel">
      <h3>{__ui("层级权限 ·")}{user.name}（{user.username}）
      </h3>
      <p className="help">{__ui("项目默认权限向下继承；表可单独覆盖。部门和表范围继续取交集。列只控制查看，编辑随表；公式和系统列始终只读。文件夹及文件继承文件库操作权限。 空间所有者和项目经理拥有项目内管理权限，细粒度勾选不降低该角色权限；需要限制操作范围时请使用录入员、审核员或只读角色。")}</p>
      {__ui(tree.error && <ErrorBox message={__ui(tree.error)}/>)}
      <label className="checkbox-label">
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)}/>{__ui("显示空部门")}</label>
      <div className="grid-scroll">
        <table className="data-grid hierarchy-grid">
          <thead>
            <tr>
              <th>{__ui("对象层级")}</th>
              {__ui(actions.map((a) => (<th key={a}>{__ui(labels[a])}</th>)))}
              <th>{__ui("权限来源 / 说明")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>{workspace.name}{__ui(" · 工作空间")}</strong>
              </td>
              <td colSpan={4}>{__ui("空间管理由所有者身份控制")}</td>
              <td>{__ui("项目授权不改变空间身份")}</td>
            </tr>
            {__ui(row("$data", project.name + __ui(" · 项目数据"), 1, "$data", true, "项目默认数据操作"))}
            {__ui(!collapsed.includes("$data") &&
            context.departments
                .filter((d: any) => showEmpty || tables.some((t) => t.department_id === d.id))
                .map((d: any) => (<Fragment key={d.id}>
                    {__ui(row(d.id, d.name + __ui(" · 部门"), 2, `department:${d.id}`, true, grant?.department_id && grant.department_id !== d.id
                    ? "当前部门范围之外"
                    : grant?.crud_permissions?.[`department:${d.id}`]
                        ? "部门单独授权"
                        : "继承项目默认操作；部门范围另行限制"))}
                    {__ui(!collapsed.includes(d.id) &&
                    tables
                        .filter((t) => t.department_id === d.id)
                        .map((t) => (<Fragment key={t.id}>
                            {__ui(row(t.id, t.name + __ui(" · 表"), 3, t.id, true, grant?.crud_permissions?.[t.id]
                            ? "单独授权"
                            : grant?.crud_permissions?.[`department:${d.id}`]
                                ? "继承部门操作"
                                : "继承项目默认操作"))}
                            {__ui(!collapsed.includes(t.id) &&
                            t.columns
                                .filter((f: any) => f.lifecycle !== "deleted")
                                .map((f: any) => (<tr key={f.id}>
                                    <td style={{ paddingLeft: 92 }}>
                                      {f.name} · {__ui(types[f.type] || f.type)}
                                    </td>
                                    <td colSpan={3}>
                                      {__ui(f.type === "formula" ||
                                    [
                                        "created_user",
                                        "modified_user",
                                        "created_time",
                                        "modified_time",
                                    ].includes(f.type)
                                    ? "系统维护 / 只读"
                                    : "随表操作权限")}
                                    </td>
                                    <td className="crud-cell">
                                      <input type="checkbox" aria-label={__uiFormat("{0} {1} {2} 查", [user.username, t.name, f.name])} checked={tableReadable(t) &&
                                    !grant?.hidden_columns.includes(f.id)} disabled={disabled || !tableReadable(t)} onChange={(e) => onChange({
                                    hidden_columns: e.target.checked
                                        ? grant.hidden_columns.filter((id: string) => id !== f.id)
                                        : [...grant.hidden_columns, f.id],
                                })}/>
                                    </td>
                                    <td className="help">{__ui("同名列标识在项目内统一生效")}</td>
                                  </tr>)))}
                          </Fragment>)))}
                  </Fragment>)))}
            {__ui(row("$files", "项目文件库", 1, "$files", true, "文件库独立操作授权；附件证据按记录权限读取"))}
            {__ui(!collapsed.includes("$files") && files(null, 2))}
          </tbody>
        </table>
      </div>
      {__ui(tree.data?.truncated && (<p className="note">{__ui("文件架构仅展示前2000项，文件库权限仍适用于全部文件。")}</p>))}
    </section>);
}
