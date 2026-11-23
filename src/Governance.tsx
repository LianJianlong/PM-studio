import {durationText,durationSummary} from '../shared/duration-summary';
import StartupDefaults from './StartupDefaults';
import { translateUiValue as __ui } from "./i18n";
import ProjectRoles from "./ProjectRoles";
import Submission from "./Submission";
import ReleaseReadiness from './ReleaseReadiness';
import { RecordEvidence } from "./RecordLinks";
import PermissionExplanation from "./PermissionExplanation";
import { useState, useEffect } from "react";
import WorkflowSettings from "./WorkflowSettings";
import PermissionMatrix from "./PermissionMatrix";
import AccountRow from "./AccountRow";
import { displayValue } from "../shared/fields";
import { Users, ShieldCheck, ClipboardCheck, Plus, KeyRound, UserX, UserCheck, Send, History, Check, CornerDownLeft, Eye, } from "lucide-react";
import { api, useApi, useApp, useRememberedState, PageTitle, Modal, Form, Field, ErrorBox, Empty, Loading, Status, roles, timestamp, Confirm, SearchBox, } from "./lib";
export default function Governance({ section }: {
    section: string;
}) {
    return (<div className="page">
      {__ui(section === "settings" ? <Settings /> : <Approvals />)}
    </div>);
}
function Settings() {
    const { workspace, project, context, boot, tick, reload, notify, canLeave } = useApp(), [savedTab, setTab] = useRememberedState(`settings-tab:${boot.user.id}:${workspace?.id}`,"users"), [modal, setModal] = useState(""), [selected, setSelected] = useState<any>(null), [matrixUser, setMatrixUser] = useState(""), [userSearch, setUserSearch] = useState("");
    const tab=!boot.user.system_admin&&["startup","release"].includes(savedTab)?"users":savedTab;
    const owner = workspace?.role === "owner";
    const { data: projectRoles } = useApi<any[]>(project && owner ? `/projects/${project.id}/roles` : null, tick);
    const { data: users, error } = useApi<any[]>(owner ? `/workspaces/${workspace.id}/users` : null, tick), { data: members } = useApi<any[]>(project && owner ? `/projects/${project.id}/members` : null, tick), { data: tables } = useApi<any[]>(project && owner ? `/projects/${project.id}/tables` : null, tick);
    if (!owner)
        return (<>
        <PageTitle icon={ShieldCheck} title={__ui("我的权限")} subtitle={__ui("权限由工作空间所有者配置，或通过申请获得")}/>
        <PermissionExplanation />
        <section className="panel">
          <dl>
            <dt>{__ui("当前角色")}</dt>
            <dd>{context.permission.project_role_name || __ui(roles[context.permission.role] || "空间成员")}</dd>
            <dt>{__ui("编辑数据")}</dt>
            <dd>{__ui(context.permission.write ? "允许" : "不允许")}</dd>
            <dt>{__ui("导出数据")}</dt>
            <dd>{__ui(context.permission.export ? "允许" : "不允许")}</dd>
            <dt>{__ui("授权到期")}</dt>
            <dd>
              {__ui(context.permission.expires_at
                ? timestamp(context.permission.expires_at)
                : "未设置到期时间")}
            </dd>
          </dl>
        </section>
        {__ui(project && context.permission.manage && (<section className="panel">
            <h2>{__ui("项目审批流程")}</h2>
            <p className="help">{__ui("项目经理可配置数据审核、阶段变更和计划基线流程。权限申请流程由工作空间所有者管理。")}</p>
            <WorkflowSettings project={project} reload={reload} notify={notify}/>
          </section>))}
      </>);
    return (<>
      <PageTitle icon={ShieldCheck} title={__ui("用户与权限")} subtitle={__ui("用户账号与项目角色独立管理，在用户管理中分配项目角色")}>
        <button className="primary" onClick={() => setModal("user")}>
          <Plus size={16}/>{__ui("创建用户")}</button>
      </PageTitle>
      {__ui(project && <PermissionExplanation />)}
      <div className="local-tabs">
        {__ui([
            ["users", "用户管理"],
            ["roles", "项目角色管理"],
            ["workflows", "审批流程"],
            ...(boot.user.system_admin ? [['startup', '默认入口'],['release', '发布检查']] : []),
        ].map(([id, label]) => (<button key={id} className={tab === id ? "active" : ""} onClick={async () => {
                if (id === tab || !(await canLeave()))
                    return;
                setMatrixUser("");
                setTab(id);
            }}>
            {__ui(label)}
          </button>)))}
      </div>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <section className="panel">
        {__ui(tab === 'startup' ? <StartupDefaults/> : tab === 'release' ? <ReleaseReadiness /> : tab === "workflows" ? (<WorkflowSettings project={project} reload={reload} notify={notify}/>) : tab === "roles" ? (<ProjectRoles />) : !users ? (<Loading />) : (<div className="account-list">
            <SearchBox value={userSearch} onChange={async (value) => {
                if (await canLeave())
                    setUserSearch(value);
            }} placeholder={__ui("搜索用户姓名或账号")}/>
            <p className="help">{__ui("共 ")}{__ui(users.filter((user) => `${user.name} ${user.username}`.toLowerCase().includes(userSearch.toLowerCase().trim())).length)}{__ui(" 位用户")}</p>
          <div className="grid-scroll">
            <table className="data-grid account-table">
              <thead>
                <tr>
                  <th>{__ui("用户")}</th>
                  <th>{__ui("账号")}</th>
                  <th>{__ui("空间身份")}</th>
                  <th>{__ui("项目角色")}</th>
                  <th>{__ui("状态")}</th>
                  <th>{__ui("创建时间")}</th>
                  <th>{__ui("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {__ui(users.filter((user) => `${user.name} ${user.username}`.toLowerCase().includes(userSearch.toLowerCase().trim())).map((u) => (<AccountRow key={u.id} projectRole={u.role === 'owner' ? __ui('空间所有者（继承）') : (() => { const m = members?.find(m => m.user_id === u.id); return m?.project_role_id ? projectRoles?.find(r => r.id === m.project_role_id)?.name || __ui('自定义角色') : m ? __ui(roles[m.role]) : __ui('未授权'); })()} user={u} workspaceId={workspace.id} currentUserId={boot.user.id} onSaved={() => {
                    reload();
                    notify("账号信息已更新");
                }} onReset={() => {
                    setSelected(u);
                    setModal("reset");
                }} onGrant={project
                    ? () => {
                        setMatrixUser(u.id);
                        setModal("grant");
                    }
                    : undefined}/>)))}
              </tbody>
            </table>
          </div>
          </div>))}
      </section>
      {__ui(modal === "grant" && project && (<Modal wide title={__ui("分配项目角色")} onClose={() => setModal("")}>
          <p className="help">{__ui("当前项目：")}{project.name}{__ui("。用户账号独立于项目角色，同一用户可在不同项目中承担不同角色。")}</p>
          <PermissionMatrix key={project.id + matrixUser} project={project} tables={tables || []} initialUser={matrixUser}/>
        </Modal>))}
      {__ui(modal === "user" && (<Modal title={__ui("创建用户账号")} onClose={() => setModal("")}>
          <Form onClose={() => setModal("")} onSubmit={async (d) => {
                await api(`/workspaces/${workspace.id}/users`, "POST", {
                    username: d.get("username"),
                    name: d.get("name"),
                    password: d.get("password"),
                });
                setModal("");
                reload();
                notify("账号已创建，请配置项目授权");
            }}>
            <Field label={__ui("姓名")}>
              <input name="name" required maxLength={120}/>
            </Field>
            <Field label={__ui("账号")} hint={__ui("3–40位字母、数字、点、下划线或连字符。")}>
              <input name="username" required pattern="[a-zA-Z0-9_.\-]{3,40}" autoComplete="off"/>
            </Field>
            <Field label={__ui("初始密码（首次登录必须修改）")}>
              <input name="password" type="password" minLength={12} defaultValue="" maxLength={128} required autoComplete="new-password"/>
            </Field>
            <p className="help">{__ui("账号创建后默认没有项目数据权限，请通过安全渠道将初始密码告知用户。")}</p>
          </Form>
        </Modal>))}
      {__ui(modal === "reset" && (<Modal title={__ui("重置密码 · ") + selected.name} onClose={() => setModal("")}>
          <Form onClose={() => setModal("")} onSubmit={async (d) => {
                await api(`/workspaces/${workspace.id}/users/${selected.id}`, "PATCH", {
                    password: d.get("password"),
                    expected_revision: selected.revision,
                });
                setModal("");
                reload();
                notify("密码已重置，原会话已失效");
            }}>
            <Field label={__ui("新密码")}>
              <input name="password" type="password" minLength={12} defaultValue="" maxLength={128} required/>
            </Field>
          </Form>
        </Modal>))}
    </>);
}
function ApprovalHistory({ approvalId }: {
    approvalId: string;
}) {
    const { tick } = useApp();
    const { data, error } = useApi<any>(`/approvals/${approvalId}/history`, tick);
    if (error)
        return <ErrorBox message={__ui(error)}/>;
    if (!data)
        return <Loading />;
    const labels: Record<string, string> = {
        submit: "提交",
        approve: "通过",
        reject: "退回",
        withdraw: "撤回",
    };
    return (<section className="approval-history">
      <h3>{__ui("审批链与处理历史")}</h3>
      {__ui(data.flow && (<p className="help">
          {data.flow.name} · v{__ui(data.flow.version)} ·{__ui(" ")}
          {__ui(data.flow.steps
                .map((s: any, i: number) => `${i + 1}. ${s.name}${data.status === "pending" && i === data.flow.index ? "（当前）" : ""}`)
                .join(" → "))}
        </p>))}
      <div className="grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              <th>{__ui("节点")}</th>
              <th>{__ui("操作人")}</th>
              <th>{__ui("动作")}</th>
              <th>{__ui("意见")}</th>
              <th>{__ui("时间")}</th>
            </tr>
          </thead>
          <tbody>
            {__ui(data.events.map((e: any) => (<tr key={e.id}>
                <td>
                  {e.node_index + 1}. {e.node_name}
                </td>
                <td>{e.actor_name}</td>
                <td>{__ui(labels[e.action])}</td>
                <td className="history-opinion">{e.opinion || "—"}</td>
                <td>{__ui(timestamp(e.created_at))}</td>
              </tr>)))}
          </tbody>
        </table>
      </div>
      {__ui(!data.events.length && (<p className="help">{__ui("该申请创建于节点历史功能上线之前，未记录历史事件。")}</p>))}
    </section>);
}
function GrantForm({ member, tables = [], allowManager = false, onSubmit, onClose, }: {
    member?: any;
    tables?: any[];
    allowManager?: boolean;
    onSubmit: (body: any) => Promise<void>;
    onClose: () => void;
}) {
    const { context } = useApp(), [role, setRole] = useState(member?.role || "viewer");
    return (<Form onClose={onClose} onSubmit={async (d) => {
            const expires = String(d.get("expires") || "");
            await onSubmit({
                role,
                department_id: d.get("department") || null,
                table_ids: d.getAll("tables"),
                hidden_columns: String(d.get("hidden") || "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                row_scope: d.get("row_scope") || "all",
                can_export: d.get("export") === "on",
                expires_at: expires ? new Date(expires).toISOString() : null,
            });
        }}>
      <Field label={__ui("角色")}>
        <select name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {__ui([
            "viewer",
            "editor",
            "reviewer",
            ...(allowManager ? ["manager"] : []),
        ].map((r) => (<option key={r} value={r}>
              {__ui(roles[r])}
            </option>)))}
        </select>
      </Field>
      {__ui(role === "manager" ? (<p className="help">{__ui("经理可管理整个项目，部门、表、列限制不适用。")}</p>) : (<>
          <div className="form-grid">
            <Field label={__ui("部门范围")}>
              <select name="department" defaultValue={member?.department_id || ""}>
                <option value="">{__ui("全部部门")}</option>
                {__ui(context.departments.map((d: any) => (<option key={d.id} value={d.id}>
                    {d.name}
                  </option>)))}
              </select>
            </Field>
            <Field label={__ui("记录范围")}>
              <select name="row_scope" defaultValue={member?.row_scope || "all"}>
                <option value="all">{__ui("全部授权记录")}</option>
                <option value="own">{__ui("仅本人录入")}</option>
              </select>
            </Field>
          </div>
          {__ui(tables.length > 0 && (<Field label={__ui("数据表范围")} hint={__ui("不选择表示所选部门内全部表；按住 Ctrl 可选择多张表。")}>
              <select name="tables" multiple defaultValue={member?.table_ids || []}>
                {__ui(tables.map((t) => (<option key={t.id} value={t.id}>
                    {t.name}
                  </option>)))}
              </select>
            </Field>))}
          <Field label={__ui("隐藏列标识")} hint={__ui("以英文逗号分隔，例如 amount,salary。隐藏列不会出现在数据接口、统计或导出中。")}>
            <input name="hidden" defaultValue={member?.hidden_columns?.join(",") || ""}/>
          </Field>
          <label className="checkbox-label">
            <input name="export" type="checkbox" defaultChecked={member?.can_export}/>{__ui("允许导出和生成个人报表")}</label>
        </>))}
      <Field label={__ui("授权到期")} hint={__ui("留空为长期授权；到期后访问自动被拒绝。")}>
        <input name="expires" type="datetime-local" defaultValue={member?.expires_at
            ? new Date(new Date(member.expires_at).getTime() -
                new Date().getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16)
            : ""}/>
      </Field>
      <p className="help">{__ui("保存或批准后，将替换该成员在此项目的现有授权配置。")}</p>
    </Form>);
}
function Approvals() {
    const { notificationTarget, consumeNotificationTarget, notify: targetNotify } = useApp();
    const { workspace, project, context, boot, tick, reload, notify } = useApp(), [tab, setTab] = useRememberedState(`approvals-tab:${boot.user.id}:${project?.id}`,context.permission.manage || context.permission.role === "reviewer" ? "pending" : "mine"), [modal, setModal] = useState(""), [selected, setSelected] = useState<any>(null), [requestProject, setRequestProject] = useState(""), [decision, setDecision] = useState("");
    const { data: approvals, error } = useApi<any[]>(project ? `/projects/${project.id}/approvals` : null, tick), { data: mine } = useApi<any[]>(project ? `/approvals/mine?project_id=${project.id}&workspace_id=${workspace.id}` : null, tick), { data: directory } = useApi<any[]>(`/workspaces/${workspace.id}/project-directory`, tick);
    useEffect(() => {
        if (!approvals || notificationTarget?.kind !== "approval" || notificationTarget.project_id !== project?.id)
            return;
        const item = approvals.find((entry) => entry.id === notificationTarget.resource_id);
        if (item) {
            setSelected(item);
            setModal("detail");
            setTab("all");
        }
        else
            targetNotify("该审批已移除或不再可访问。");
        consumeNotificationTarget?.();
    }, [approvals, notificationTarget, project?.id]);
    const list = tab === "mine"
        ? mine || []
        : (approvals || []).filter((a) => tab !== "pending" ||
            (a.status === "pending" && a.approver_id === boot.user.id));
    const kinds: Record<string, string> = {
        record: "数据审核",
        access: "权限申请",
        stage: "阶段变更",
        baseline: "计划基线",
        resource: "资源费用变更",
    };
    return (<>
      <PageTitle icon={ClipboardCheck} title={__ui("申请与审批")} subtitle={__ui("申请、审批和生效结果有迹可循")}>
        <button className="primary" onClick={() => {
            setRequestProject(project?.id || directory?.[0]?.id || "");
            setModal("request-project");
        }}>
          <Plus size={16}/>{__ui("申请项目权限")}</button>
        <button className="primary" onClick={() => setModal("submit")}><Send size={16}/>{__ui("提交申请")}</button>
      </PageTitle>
      <div className="local-tabs">
        <button className={tab === "pending" ? "active" : ""} onClick={() => setTab("pending")}>{__ui("待我审批")}{__ui(" ")}
          <span className="count-badge">
            {__ui(approvals?.filter((a) => a.status === "pending" && a.approver_id === boot.user.id).length || 0)}
          </span>
        </button>
        <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>{__ui("我的申请")}</button>
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>{__ui("项目审批记录")}</button>
      </div>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <section className="panel">
        {__ui(!list.length ? (<Empty text={__ui(tab === "pending" ? "当前没有待你审批的申请" : "暂无申请记录")}/>) : (<div className="grid-scroll">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>{__ui("申请名称")}</th>
                  <th>{__ui("类型")}</th>
                  <th>{__ui(tab === "mine" ? "审批人" : "申请人")}</th>
                  <th>{__ui("状态")}</th>
                  <th>{__ui("提交时间")}</th>
                  <th>{__ui("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {__ui(list.map((a) => (<tr key={a.id}>
                    <td>
                      <strong>{a.title}</strong>
                      {__ui(a.project_name && (<small className="block">{a.project_name}</small>))}
                    </td>
                    <td>{__ui(kinds[a.kind])}</td>
                    <td>
                      {__ui(tab === "mine" ? a.approver_name : a.requester_name)}
                    </td>
                    <td>
                      <Status value={a.status}/>
                    </td>
                    <td>{__ui(timestamp(a.created_at))}</td>
                    <td>
                      <button className="text-button" onClick={() => {
                    setSelected(approvals?.find(item=>item.id===a.id)||a);
                    setModal("detail");
                }}>{__ui("详情")}</button>
                      {__ui(a.status === "pending" &&
                    (a.requester_id === boot.user.id || tab === "mine") && (<button className="text-button" onClick={() => {
                        setSelected(approvals?.find(item=>item.id===a.id)||a);
                        setDecision("withdraw");
                    }}>{__ui("撤回")}</button>))}
                    </td>
                  </tr>)))}
              </tbody>
            </table>
          </div>))}
      </section>
      {__ui(modal === "detail" && selected && (<Modal title={__ui("审批详情")} onClose={() => setModal("")} wide>
          <div className="approval-heading">
            <div>
              <h2>{selected.title}</h2>
              <p>
                {__ui(kinds[selected.kind])} · {__ui(timestamp(selected.created_at))}
              </p>
            </div>
            <Status value={selected.status}/>
          </div>
          {!!selected.payload?._attachments?.length&&<section><h3>{__ui('申请附件')}</h3>{selected.payload._attachments.map((f:any)=><p key={f.version_id}><a href={`/api/files/${f.file_id}/download?version=${f.version}`} download>{f.name}</a> · v{f.version} · {(Number(f.size_bytes)/1024).toFixed(1)} KB</p>)}</section>}
          {__ui(selected.record_data && selected.record_id && <RecordEvidence approvalId={selected.id}/>)}
          {__ui(selected.record_data ? (<table className="data-grid">
              <tbody>
                {__ui(selected.columns.map((f: any) => (<tr key={f.id}>
                    <th>{f.name}</th>
                    <td>
                      {__ui(selected.record_references?.[f.id]
                        ? selected.record_references[f.id].items
                            .map((v: any) => v.label)
                            .join("；") +
                            (selected.record_references[f.id].restricted
                                ? "（部分关联不可见）"
                                : "")
                        : selected.record_data[f.id] == null
                            ? "—"
                            : displayValue(selected.record_data[f.id]))}
                    </td>
                  </tr>)))}
              </tbody>
            </table>) : selected.payload ? (<div className="approval-payload">
              {__ui(selected.kind === "access" ? (<dl>
                  <dt>{__ui("申请角色")}</dt>
                  <dd>{__ui(roles[selected.payload.role])}</dd>
                  <dt>{__ui("部门范围")}</dt>
                  <dd>
                    {__ui(selected.payload.department_id
                        ? context.departments.find((d: any) => d.id === selected.payload.department_id)?.name || selected.payload.department_id
                        : "全部部门")}
                  </dd>
                  <dt>{__ui("导出权限")}</dt>
                  <dd>{__ui(selected.payload.can_export ? "允许" : "不允许")}</dd>
                  <dt>{__ui("记录范围")}</dt>
                  <dd>
                    {__ui(selected.payload.row_scope === "own"
                        ? "本人记录"
                        : "全部授权记录")}
                  </dd>
                  <dt>{__ui("隐藏列")}</dt>
                  <dd>{__ui(selected.payload.hidden_columns?.join(",") || "无")}</dd>
                  <dt>{__ui("授权到期")}</dt>
                  <dd>
                    {__ui(selected.payload.expires_at
                        ? timestamp(selected.payload.expires_at)
                        : "长期")}
                  </dd>
                </dl>) : selected.kind === "resource" ? (<><dl><dt>{__ui("作业")}</dt><dd>{selected.payload.activity_name}</dd><dt>{__ui("资源")}</dt><dd>{selected.payload.resource_name}</dd><dt>{__ui("变更说明")}</dt><dd>{__ui(selected.payload.reason)}</dd><dt>{__ui("动作 / 原版本")}</dt><dd>{__ui(selected.payload.action === 'delete' ? '删除分配' : '调整分配')} · v{__ui(selected.payload.version)}</dd></dl><table><thead><tr><th>{__ui("项目")}</th><th>{__ui("原值")}</th><th>{__ui("申请值")}</th></tr></thead><tbody>{__ui([['quantity', '数量'], ['planned_cost', '计划费用'], ['actual_cost', '实际费用']].map(([key, label]) => <tr key={key}><td>{__ui(label)}</td><td>{__ui(selected.payload.before?.[key] ?? '—')}</td><td>{__ui(selected.payload.action === 'delete' ? '删除' : selected.payload[key])}</td></tr>))}</tbody></table></>) : selected.kind === "stage" ? (<dl>
                  <dt>{__ui("工程阶段")}</dt>
                  <dd>{__ui(selected.payload.engineering_stage)}</dd>
                  <dt>{__ui("经营阶段")}</dt>
                  <dd>{__ui(selected.payload.business_stage)}</dd>
                  <dt>{__ui("变更依据")}</dt>
                  <dd>{__ui(selected.payload.reason)}</dd>
                </dl>) : (<dl>
                  <dt>{__ui("基线作业数")}</dt>
                  <dd>{__ui(selected.payload.activities?.length)}</dd>
                  <dt>{__ui("计划工期")}</dt>
                  <dd>{__ui(durationText(selected.payload.duration_summary?.work_span??durationSummary(selected.payload.activities||[],selected.payload.calendar_config?.hours_per_day||8).work_span,selected.payload.calendar_config?.hours_per_day||8))}</dd>
                  <dt>{__ui("开始日期")}</dt>
                  <dd>{__ui(selected.payload.start_date?.slice(0, 10))}</dd>
                </dl>))}
            </div>) : null)}
          {__ui(selected.opinion && (<div className="note">{__ui("审批意见：")}{selected.opinion}</div>))}
          <ApprovalHistory approvalId={selected.id}/>
          {__ui(selected.status === "pending" &&
                selected.approver_id === boot.user.id && (<div className="form-actions">
                <button onClick={() => setDecision("reject")}>
                  <CornerDownLeft size={16}/>{__ui("退回")}</button>
                <button className="primary" onClick={() => setDecision("approve")}>
                  <Check size={16}/>
                  {__ui(selected.payload?._workflow &&
                    selected.payload._workflow.index <
                        selected.payload._workflow.steps.length - 1
                    ? "通过并转交"
                    : "批准并生效")}
                </button>
              </div>))}
        </Modal>))}
      {__ui(decision && (<Modal title={__ui(decision === "approve"
                ? "批准申请"
                : decision === "reject"
                    ? "退回申请"
                    : "撤回申请")} onClose={() => setDecision("")}>
          <Form submit="确认" onClose={() => setDecision("")} onSubmit={async (d) => {
                const result = await api(`/approvals/${selected.id}/decide`, "POST", {
                    action: decision,
                    opinion: d.get("opinion"),
                });
                setDecision("");
                setModal("");
                reload();
                notify(result.status === "pending"
                    ? `已转交${result.next_node}，尚未最终生效`
                    : "申请状态已更新");
            }}>
            <p className="help">{selected.title}</p>
            <Field label={__ui(decision === "reject" ? "退回原因（必填）" : "处理意见")}>
              <textarea name="opinion" required={decision === "reject"} maxLength={2000}/>
            </Field>
          </Form>
        </Modal>))}
      {__ui(modal === "submit" && <Submission onClose={() => setModal("")} onAccess={() => { setRequestProject(project?.id || directory?.[0]?.id || ""); setModal("request-project"); }}/>)}
      {__ui(modal === "request-project" && (<Modal title={__ui("申请项目权限")} onClose={() => setModal("")}>
          <Form submit="填写授权范围" onClose={() => setModal("")} onSubmit={async () => {
                if (!requestProject)
                    throw Error("请选择项目");
                setModal("request");
            }}>
            <Field label={__ui("项目")}>
              <select value={requestProject} onChange={(e) => setRequestProject(e.target.value)} required>
                <option value="">{__ui("请选择项目")}</option>
                {__ui(directory?.map((p) => (<option key={p.id} value={p.id}>
                    {p.name}
                  </option>)))}
              </select>
            </Field>
            <p className="help">{__ui("申请由其他空间所有者审批。尚未加入项目时，只能看到项目目录，不能查看业务数据。")}</p>
          </Form>
        </Modal>))}
      {__ui(modal === "request" && (<Modal title={__ui("申请授权范围")} onClose={() => setModal("")}>
          <GrantForm onClose={() => setModal("")} onSubmit={async (body) => {
                await api(`/projects/${requestProject}/approvals`, "POST", {
                    kind: "access",
                    title: "申请项目访问权限",
                    payload: body,
                });
                setModal("");
                reload();
                notify("权限申请已提交");
            }}/>
        </Modal>))}
    </>);
}
