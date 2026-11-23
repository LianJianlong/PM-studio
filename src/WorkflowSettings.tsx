import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, useRef } from "react";
import { api, useApi, useApp, Field, Form, ErrorBox, Empty, Confirm, timestamp, } from "./lib";
const kinds: Record<string, string> = {
    record: "数据审核",
    stage: "阶段变更",
    baseline: "计划基线",
    resource: "资源费用变更",
    access: "权限申请",
};
export default function WorkflowSettings({ project, reload, notify, }: {
    project: any;
    reload: () => void;
    notify: (s: string) => void;
}) {
    const { tick, context } = useApp();
    // Context already excludes inactive accounts and expired project grants.
    const users: any[] = context.users || [];
    const canManageAccess = context.permission.role === "owner";
    const { data: workflows, error } = useApi<any[]>(project ? `/projects/${project.id}/workflows` : null, tick);
    const {data:tables}=useApi<any[]>(project?`/projects/${project.id}/tables`:null,tick);
    const editor=useRef<HTMLDetailsElement>(null);
    const [editing,setEditing]=useState<any>(null);
    const [scope,setScope]=useState<string[]>([]);
    const [kind, setKind] = useState("record");
    const [steps, setSteps] = useState([
        { key: crypto.randomUUID(), name: "部门复核", approver_id: "" },
        { key: crypto.randomUUID(), name: "项目复核", approver_id: "" },
    ]);
    const [disable, setDisable] = useState<any>(null);
    const candidates = users.filter((u) => {
        const role = u.role;
        return (kind === "access"
            ? ["owner"]
            : kind === "record"
                ? ["owner", "manager", "reviewer"]
                : ["owner", "manager"]).includes(role);
    });
    function move(index: number, delta: number) {
        setSteps((old) => {
            const next = [...old];
            [next[index], next[index + delta]] = [next[index + delta], next[index]];
            return next;
        });
    }
    if (!project)
        return <Empty text={__ui("请先选择项目")}/>;
    return (<div>
      <div className="permission-intro">
        <div>
          <strong>{__ui("审批链配置表")}</strong>
          <p>{__ui("按行定义 2–8 个节点。提交时按流程名称选择；只显示当前类型及适用表的已发布流程。不同名称可同时启用，同名发布新版本替换旧版；在途申请保留提交时的流程版本。每个节点一名审批人，申请人不能自审。")}</p>
        </div>
      </div>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <button type="button" onClick={()=>{setEditing(null);setKind('record');setScope([]);setSteps([{key:crypto.randomUUID(),name:'部门复核',approver_id:''},{key:crypto.randomUUID(),name:'项目复核',approver_id:''}]);if(editor.current)editor.current.open=true;}}>{__ui('新建审批流程')}</button>
      <details ref={editor} className="workflow-editor"><summary>{__ui(editing?'编辑审批流程':'＋ 新建 / 发布审批流程')}</summary>
      <Form key={editing?.id||"new"} submit={editing?"保存流程设置":"发布审批链"} onSubmit={async (d) => {
            await api(editing?`/workflows/${editing.id}`:`/projects/${project.id}/workflows`, editing?"PATCH":"POST", {
                ...(editing?{expected:{name:editing.name,version:editing.version,steps:editing.steps,table_ids:editing.table_ids,active:editing.active}}:{kind}),table_ids:kind==='record'?scope:[],
                ...(d.get('version')?{version:Number(d.get('version'))}:{}),
                name: d.get("name"),
                steps: steps.map(({ name, approver_id }) => ({
                    name,
                    approver_id,
                    mode: "one",
                })),
            });
            notify(editing?"流程设置已保存，在途申请保留原审批链":"审批链已发布，新申请开始使用该版本");
            setEditing(null);if(editor.current)editor.current.open=false;
            reload();
        }}>
        <div className="form-grid">
          <Field label={__ui("业务类型")}>
            <select disabled={!!editing} value={kind} onChange={(e) => {
            setKind(e.target.value);
            setSteps((old) => old.map((s) => ({ ...s, approver_id: "" })));
        }}>
              {__ui(Object.entries(kinds)
            .filter(([k]) => k !== "access" || canManageAccess)
            .map(([k, v]) => (<option key={k} value={k}>
                    {__ui(v)}
                  </option>)))}
            </select>
          </Field>
          <Field label={__ui("流程名称")}>
            <input name="name" defaultValue={editing?.name||""} required maxLength={120} placeholder={__ui("例如：质量审核流程")}/>
          </Field>
        </div>
        <Field label={__ui('流程版本')} hint={__ui('正整数；新建时留空自动递增。同名同类型的版本号不可重复。')}><input name="version" type="number" min="1" max="2147483647" step="1" required={!!editing} defaultValue={editing?.version||''}/></Field>
        {kind==='record'&&<Field label={__ui('适用数据表')} hint={__ui('不选择表示通用流程；选择后仅适用于这些表。')}><select multiple aria-label={__ui('适用数据表')} value={scope} onChange={e=>setScope([...e.target.selectedOptions].map(o=>o.value))}>{tables?.map(t=><option key={t.id} value={t.id}>{t.department_name} · {t.name}</option>)}</select></Field>}
        <div className="grid-scroll">
          <table className="data-grid workflow-grid">
            <thead>
              <tr>
                <th>{__ui("顺序")}</th>
                <th>{__ui("节点名称")}</th>
                <th>{__ui("审批人")}</th>
                <th>{__ui("处理方式")}</th>
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(steps.map((step, i) => (<tr key={step.key}>
                  <td>{i + 1}</td>
                  <td>
                    <input aria-label={__uiFormat("节点{0}名称", [i + 1])} required maxLength={120} value={step.name} onChange={(e) => setSteps((old) => old.map((s) => s.key === step.key
                ? { ...s, name: e.target.value }
                : s))}/>
                  </td>
                  <td>
                    <select aria-label={__uiFormat("节点{0}审批人", [i + 1])} required value={step.approver_id} onChange={(e) => setSteps((old) => old.map((s) => s.key === step.key
                ? { ...s, approver_id: e.target.value }
                : s))}>
                      <option value="">{__ui("选择审批人")}</option>
                      {__ui(candidates.map((u) => (<option key={u.id} value={u.id} disabled={steps.some((s) => s.key !== step.key && s.approver_id === u.id)}>
                          {u.name} · {u.username}
                        </option>)))}
                    </select>
                  </td>
                  <td>
                    {__ui(i === steps.length - 1 ? "通过后生效" : "通过后转交")}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" aria-label={__uiFormat("上移节点{0}", [i + 1])} disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" aria-label={__uiFormat("下移节点{0}", [i + 1])} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                      <button type="button" disabled={steps.length <= 2} onClick={() => setSteps((old) => old.filter((s) => s.key !== step.key))}>{__ui("删除")}</button>
                    </div>
                  </td>
                </tr>)))}
            </tbody>
          </table>
        </div>
        <button type="button" disabled={steps.length >= 8} onClick={() => setSteps((old) => [
            ...old,
            {
                key: crypto.randomUUID(),
                name: `第${old.length + 1}节点`,
                approver_id: "",
            },
        ])}>{__ui("＋ 添加节点")}</button>
        {__ui(candidates.length < 2 && (<p className="help">{__ui("此类型至少需要两名不同的有效审批人。权限申请仅空间所有者可审；阶段与基线由所有者或项目经理审批。")}</p>))}
      </Form>
      </details>
      <h3>{__ui("已发布流程与版本")}</h3>
      <div className="grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              <th>{__ui("名称 / 类型")}</th>
              <th>{__ui("版本")}</th>
              <th>{__ui("审批链")}</th>
              <th>{__ui("发布时间")}</th>
              <th>{__ui("启用")}</th>
              <th>{__ui("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {__ui(workflows?.map((w) => (<tr key={w.id}>
                <td>
                  {w.name}
                  <div className="help">{__ui(kinds[w.kind])} · {w.table_ids?.length?w.table_ids.map((id:string)=>tables?.find(t=>t.id===id)?.name||id).join('、'):__ui('通用流程')}</div>
                </td>
                <td>v{__ui(w.version)}</td>
                <td>
                  {__ui(w.steps
                .map((s: any) => `${s.name}（${users?.find((u) => u.id === s.approver_id)?.name || "原审批人"}）`)
                .join(" → "))}
                </td>
                <td>{__ui(timestamp(w.created_at))}</td>
                <td><label className="checkbox-label"><input type="checkbox" aria-label={__uiFormat("启用 {0} v{1}", [w.name, w.version])} checked={w.active} disabled={!context.permission.manage || (w.kind === "access" && !canManageAccess)} onChange={() => setDisable(w)}/>{__ui(w.active ? "已启用" : "历史 / 停用")}</label></td>
                <td>
                  {context.permission.manage&&(w.kind!=='access'||canManageAccess)&&<><button onClick={()=>{setEditing(w);setKind(w.kind);setScope(w.table_ids||[]);setSteps(w.steps.map((s:any)=>({...s,key:crypto.randomUUID()})));if(editor.current){editor.current.open=true;editor.current.scrollIntoView({behavior:'smooth',block:'start'});}}}>{__ui('编辑')}</button><button onClick={()=>setDisable(w)}>{__ui(w.active?'停用':'启用')}</button></>}
                  {__ui(w.kind === "access" && !canManageAccess && (<span className="help">{__ui("仅空间所有者管理")}</span>))}
                </td>
              </tr>)))}
          </tbody>
        </table>
      </div>
      {__ui(disable && (<Confirm title={__ui(disable.active?"停用审批链":"启用审批流程")} detail={__ui(disable.active?"停用后不再用于新申请，在途申请保留原审批链。":"启用后可供新申请选择；同名其他版本将停用，在途申请保留原审批链。")} onClose={() => setDisable(null)} onConfirm={async () => {
                await api(`/workflows/${disable.id}`, "PATCH", { active: !disable.active,expected:{name:disable.name,version:disable.version,steps:disable.steps,table_ids:disable.table_ids,active:disable.active} });
                setDisable(null);
                reload();
                notify(disable.active?"流程已停用":"流程已启用");
            }}/>))}
    </div>);
}
