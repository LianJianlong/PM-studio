import { translateUiValue as __ui } from "./i18n";
import { useState } from 'react';
import { api, useApi, useApp, PageTitle, Modal, Form, Field, ErrorBox, Loading, Confirm, roles } from './lib';
import { ShieldCheck, Plus } from 'lucide-react';
const defaults = () => ({ role: 'viewer', department_id: null, table_ids: [], hidden_columns: [], row_scope: 'all', can_export: false, crud_permissions: {} });
export default function ProjectRoles() {
    const { project, tick, reload, notify } = useApp();
    const { data, error } = useApi<any[]>(project ? `/projects/${project.id}/roles` : null, tick);
    const [editing, setEditing] = useState<any>(null), [remove, setRemove] = useState<any>(null);
    if (!project)
        return <p>{__ui("请先选择项目")}</p>;
    if (error)
        return <ErrorBox message={__ui(error)}/>;
    if (!data)
        return <Loading />;
    return <>
 <PageTitle icon={ShieldCheck} title={__ui("项目角色管理")} subtitle={__ui("角色定义独立于用户账号；在用户管理中将角色分配给用户。")}><button className="primary" onClick={() => setEditing({ name: '', description: '', grant_config: defaults() })}><Plus size={16}/>{__ui("创建项目角色")}</button></PageTitle>
 <p className="help">{__ui("内置角色提供基础能力，自定义角色可组合操作权限和数据范围。修改角色会同步到已分配用户；不会修改用户账号和空间身份。")}</p>
 <div className="grid-scroll"><table className="data-grid"><thead><tr>{__ui(['角色名称', '类型', '基础能力', '说明', '已分配用户', '操作'].map(v => <th key={v}>{__ui(v)}</th>))}</tr></thead><tbody>
 {__ui(['viewer', 'editor', 'reviewer', 'manager'].map(v => <tr key={v}><td>{__ui(roles[v])}</td><td>{__ui("内置角色")}</td><td>{__ui(roles[v])}</td><td>{__ui(v === 'manager' ? '管理整个项目' : v === 'editor' ? '录入和编辑数据' : v === 'reviewer' ? '审核提交的数据' : '查看已授权数据')}</td><td>—</td><td>{__ui("系统内置")}</td></tr>))}
 {__ui(data.map(r => <tr key={r.id}><td>{r.name}</td><td>{__ui("自定义角色")}</td><td>{__ui(roles[r.grant_config.role])}</td><td>{r.description || '—'}</td><td>{__ui(r.assigned_count)}</td><td><button onClick={() => setEditing(r)}>{__ui("编辑")}</button> <button disabled={r.assigned_count > 0} title={__ui(r.assigned_count ? '请先解除用户分配' : '删除角色')} onClick={() => setRemove(r)}>{__ui("删除")}</button></td></tr>))}
 </tbody></table></div>
 {__ui(editing && <RoleEditor key={editing.id || 'new'} value={editing} onClose={() => setEditing(null)} onSave={async (body) => { await api(`/projects/${project.id}/roles${editing.id ? '/' + editing.id : ''}`, editing.id ? 'PUT' : 'POST', { ...body, expected_revision: editing.revision }); setEditing(null); reload(); notify('项目角色已保存'); }}/>)}
 {__ui(remove && <Confirm title={__ui("删除项目角色")} detail={remove.name} onClose={() => setRemove(null)} onConfirm={async () => { await api(`/projects/${project.id}/roles/${remove.id}`, 'DELETE', { expected_revision: remove.revision }); setRemove(null); reload(); notify('项目角色已删除'); }}/>)}
 </>;
}
function RoleEditor({ value, onClose, onSave }: {
    value: any;
    onClose: () => void;
    onSave: (body: any) => Promise<void>;
}) {
    const { context } = useApp();
    const [g, setG] = useState<any>(value.grant_config), [roleName, setRoleName] = useState(value.name), [description, setDescription] = useState(value.description);
    return <Modal title={__ui(value.id ? '编辑项目角色' : '创建项目角色')} onClose={onClose}><Form onClose={onClose} onSubmit={async () => onSave({ name: roleName, description, grant: g })}>
 <Field label={__ui("角色名称")}><input name="role_name" required maxLength={120} value={roleName} onChange={e => setRoleName(e.target.value)}/></Field>
 <Field label={__ui("说明")}><textarea name="description" maxLength={1000} value={description} onChange={e => setDescription(e.target.value)}/></Field>
 <Field label={__ui("基础能力")}><select name="base_role" value={g.role} onChange={e => setG({ ...g, role: e.target.value })}>{__ui(['viewer', 'editor', 'reviewer', 'manager'].map(v => <option key={v} value={v}>{__ui(roles[v])}</option>))}</select></Field>
 {__ui(g.role === 'manager' ? <p className="help">{__ui("经理角色管理整个项目，不受数据范围限制。")}</p> : <>
 <Field label={__ui("部门范围")}><select name="department_id" value={g.department_id || ''} onChange={e => setG({ ...g, department_id: e.target.value || null })}><option value="">{__ui("全部部门")}</option>{__ui(context.departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>))}</select></Field>
 <Field label={__ui("记录范围")}><select name="row_scope" value={g.row_scope} onChange={e => setG({ ...g, row_scope: e.target.value })}><option value="all">{__ui("全部授权记录")}</option><option value="own">{__ui("仅本人录入")}</option></select></Field>
 {__ui(['$data', '$files'].map(scope => <fieldset key={scope}><legend>{__ui(scope === '$data' ? '业务数据权限' : '文件操作权限')}</legend>{__ui((['read', 'create', 'update', 'delete'] as const).map(action => { const writable = g.role === 'editor'; return <label className="checkbox-label" key={action}><input name={`${scope}_${action}`} type="checkbox" disabled={!writable && action !== 'read'} checked={g.crud_permissions[scope]?.[action] ?? (action === 'read' || writable)} onChange={e => setG({ ...g, crud_permissions: { ...g.crud_permissions, [scope]: { read: true, create: writable, update: writable, delete: writable, ...g.crud_permissions[scope], [action]: e.target.checked } } })}/>{__ui({ read: '查看', create: '新增', update: '修改', delete: '删除' }[action])}</label>; }))}</fieldset>))}
 <label className="checkbox-label"><input name="can_export" type="checkbox" checked={g.can_export} onChange={e => setG({ ...g, can_export: e.target.checked })}/>{__ui("允许导出和报表")}</label>
 </>)}
 <p className="help">{__ui("保存后，已分配该角色的用户会立即使用更新后的权限。")}</p>
 </Form></Modal>;
}
