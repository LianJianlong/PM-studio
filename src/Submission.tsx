import {reviewMode} from '../shared/record-policy';
import {useApprovalAttachments} from './ApprovalAttachments';
import {availableWorkflows} from '../shared/workflow-selection';
import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import { api, useApi, useApp, Modal, Form, Field, ErrorBox, Loading, } from "./lib";
export default function Submission({ onClose, onAccess, }: {
    onClose: () => void;
    onAccess: () => void;
}) {
    const { project, context, boot, tick, reload, notify } = useApp();
    const [kind, setKind] = useState("record"), [table, setTable] = useState(""), [record, setRecord] = useState(""), [search, setSearch] = useState("");
    const tables = useApi<any[]>(project && context.permission.write
        ? `/projects/${project.id}/tables`
        : null, tick);
    const records = useApi(table
        ? `/tables/${table}/records?status=all&search=${encodeURIComponent(search)}`
        : null, tick);
    const flows = useApi<any[]>(project ? `/projects/${project.id}/workflows` : null, tick);
    const attachments=useApprovalAttachments(project?.id||'');
    const [workflowId,setWorkflowId]=useState('');
    const applicable=availableWorkflows(flows.data||[],kind,table);
    const flow=applicable.find(w=>w.id===workflowId)||applicable[0];
    const users = (context.users || []).filter((u: any) => u.id !== boot.user.id &&
        (kind === "record"
            ? ["owner", "manager", "reviewer"]
            : ["owner", "manager"]).includes(u.role));
    return (<Modal title={__ui("提交申请")} wide onClose={onClose}>
      <Form submit="提交申请" onClose={onClose} onSubmit={async (d) => {
            if (!project)
                throw Error("请先选择项目");
            if (kind === "record" &&
                (!record || !records.data?.permissions.write))
                throw Error("请选择有提交权限的草稿记录");
            const body: any = { kind, title: d.get("title") };
            if (flow)
                body.workflow_id = flow.id;
            else
                body.approver_id = d.get("approver");
            if (kind === "record")
                body.record_id = record;
            if (kind === "stage")
                body.payload = {
                    engineering_stage: d.get("engineering_stage"),
                    business_stage: d.get("business_stage"),
                    reason: d.get("reason"),
                };
            body.attachment_ids=await attachments.upload();
            await api(`/projects/${project.id}/approvals`, "POST", body);
            reload();
            notify("申请已提交，进入审批流程");
            onClose();
        }}>
        <p className="help">{__ui("当前身份：")}{__ui(context.permission.manage
            ? "管理员 / 项目经理"
            : context.permission.write
                ? "数据录入者"
                : "只读成员")}{__ui("。这里只展示可发起的业务；审核权限由流程及当前授权决定。")}</p>
        <div className="submission-types">
          {__ui([
            ["record", "重大事项审批", !!context.permission.write],
            ["stage", "阶段变更", !!context.permission.manage],
            ["baseline", "计划基线", !!context.permission.manage],
        ].map(([key, label, allowed]) => (<button key={String(key)} type="button" disabled={!allowed || !project} className={kind === key ? "active" : ""} onClick={() => {
                setKind(String(key));
                setRecord("");
            }}>
              {__ui(label)}
            </button>)))}
          <button type="button" onClick={onAccess}>{__ui("项目权限申请")}</button>
        </div>
        {__ui(!context.permission.write ? (<p className="note">{__ui("当前账号不能提交业务数据，可选择“项目权限申请”申请授权。")}</p>) : (<>
            <Field label={__ui("申请标题")}>
              <input name="title" required maxLength={120} placeholder={__ui("说明本次申请事项")}/>
            </Field>
            {__ui(kind === "record" && (<>
                <Field label={__ui("数据表")}>
                  <select aria-label={__ui("申请数据表")} required value={table} onChange={(e) => {
                    setTable(e.target.value);
                    setRecord("");
                }}>
                    <option value="">{__ui("选择数据表")}</option>
                    {__ui(tables.data?.filter(t=>reviewMode(t)==='approval').map((t) => (<option key={t.id} value={t.id}>
                        {t.department_name} / {t.name}
                      </option>)))}
                  </select>
                </Field>
                {__ui(tables.error && <ErrorBox message={__ui(tables.error)}/>)}
                <Field label={__ui("搜索待提交记录")}>
                  <input aria-label={__ui("搜索申请记录")} value={search} onChange={(e) => {
                    setSearch(e.target.value);
                    setRecord("");
                }} maxLength={100}/>
                </Field>
                <Field label={__ui("待提交记录")} hint={__ui("展示所选表最近一页中的授权草稿和退回记录，可按标题搜索。")}>
                  <select aria-label={__ui("申请记录")} required value={record} onChange={(e) => setRecord(e.target.value)}>
                    <option value="">{__ui("选择草稿或退回记录")}</option>
                    {__ui(records.data?.rows
                    .filter((r: any) => ["draft", "rejected"].includes(r.status))
                    .map((r: any) => (<option key={r.id} value={r.id}>
                          {__ui(String(Object.values(r.data).find((v) => typeof v === "string" || typeof v === "number") ?? r.id))}
                        </option>)))}
                  </select>
                </Field>
                {__ui(records.error && <ErrorBox message={__ui(records.error)}/>)}{__ui(" ")}
                {__ui(records.data && !records.data.permissions.write && (<p className="note">{__ui("此表未授予修改 / 提交权限，请申请授权或选择其他表。")}</p>))}
              </>))}
            {__ui(kind === "stage" && (<>
                <div className="form-grid">
                  <Field label={__ui("工程阶段")}>
                    <select name="engineering_stage" defaultValue={project.engineering_stage}>
                      {__ui([
                    "定义",
                    "启动",
                    "概念",
                    "方案",
                    "技术",
                    "实施",
                    "竣工",
                ].map((s) => (<option key={s}>{__ui(s)}</option>)))}
                    </select>
                  </Field>
                  <Field label={__ui("商务阶段")}>
                    <select name="business_stage" defaultValue={project.business_stage}>
                      {__ui([
                    "投标",
                    "中标",
                    "计划",
                    "实施",
                    "控制",
                    "收尾",
                    "评价",
                ].map((s) => (<option key={s}>{__ui(s)}</option>)))}
                    </select>
                  </Field>
                </div>
                <Field label={__ui("变更原因")}>
                  <textarea name="reason" required maxLength={1000}/>
                </Field>
              </>))}
            {__ui(kind === "baseline" && (<p className="note">{__ui("提交当前计划作为基线候选；最终批准后生效，不覆盖在途申请。")}</p>))}
            {!flows.loading&&!flow&&<Field label={__ui('审批流程')} hint={__ui('当前申请类型或所选数据表没有可用的已发布流程，请在用户与权限的审批流程中发布并设置适用范围；也可选择单人审批。')}><select aria-label={__ui('审批流程')} value="" disabled><option value="">{__ui('暂无匹配的已发布流程（单人审批）')}</option></select></Field>}
            {__ui(flows.loading ? (<Loading />) : flow ? (<div><Field label={__ui("审批流程")}><select aria-label={__ui("审批流程")} required value={flow.id} onChange={e=>setWorkflowId(e.target.value)}>{applicable.map(w=><option key={w.id} value={w.id}>{w.name} · v{w.version}</option>)}</select></Field><p className="note">{__ui("使用已发布流程：")}{flow.name} · v{__ui(flow.version)} ·{__ui(" ")}
                {__ui(flow.steps.length)}{__ui("个节点。申请人不可担任本流程审批人。")}</p></div>) : (<Field label={__ui("审批人")}>
                <select name="approver" required>
                  <option value="">{__ui("选择其他审批人")}</option>
                  {__ui(users.map((u: any) => (<option key={u.id} value={u.id}>
                      {u.name} · {u.username}
                    </option>)))}
                </select>
              </Field>))}
            {attachments.field}
            {__ui(flows.error && <ErrorBox message={__ui(flows.error)}/>)}
          </>))}
      </Form>
    </Modal>);
}
