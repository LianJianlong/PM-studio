import {useApprovalAttachments} from './ApprovalAttachments';
import {createRequestQueue} from "../shared/request-queue";
import {selectWorkflow,availableWorkflows} from "../shared/workflow-selection";
import {interfaceLocale} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { createContext, useContext, useEffect, useState, useId, useRef, useLayoutEffect, useCallback, type ReactNode, type FormEvent, type SetStateAction, } from "react";
import { X, LoaderCircle, AlertCircle, Search, Inbox } from "lucide-react";
import {apiResult} from '../shared/http-result';
const queueRequest=createRequestQueue(4);
export async function api<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
    return queueRequest(async () => {
    const response = await fetch("/api" + url, {
        method,
        credentials: "same-origin",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const result=await apiResult<T>(response,method);
    if(method!=="GET"&&!(method==="POST"&&/\/(schedule-preview|delay-analysis|progress-periods\/preview|duration-link\/preview|constraint-trial\/preview|cost-management\/preview|actual-remaining\/preview|activity-codes\/preview|ai\/document-draft|ai\/closure|toolbox-documents\/print\/preview|toolbox-documents\/export\/word|storage-targets\/test|workspaces\/[^/]+\/connections\/test)$/.test(url)))window.dispatchEvent(new CustomEvent('studio-data-changed',{detail:{url}}));
    return result;
    });
}
export function useApi<T = any>(url: string | null, tick = 0) {
    const [result,setResult]=useState<{url:string;data:T}|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
    const requestId=useRef(0),currentUrl=useRef(url);
    const commits=useRef<{url:string;onCommit:()=>void;resolve:(data:T|undefined)=>void;reject:(error:unknown)=>void}[]>([]);
    currentUrl.current=url;
    function settled(target:string,data?:T,failure?:unknown){
        const waiting=commits.current.filter(w=>w.url===target);commits.current=commits.current.filter(w=>w.url!==target);
        for(const w of waiting){if(failure){w.reject(failure);continue}try{if(data!==undefined)w.onCommit();w.resolve(data)}catch(e){w.reject(e)}}
    }
    const refresh=useCallback(async(onCommit?:()=>void)=>{
        if(!url)return;
        const request=++requestId.current;
        // A background reload may supersede this request. Complete the editor only
        // when a current response for this same resource has actually committed.
        const completion=onCommit?new Promise<T|undefined>((resolve,reject)=>commits.current.push({url,onCommit,resolve,reject})):null;
        // Attach the rejection handler immediately while the network request runs.
        if(completion)void completion.catch(()=>{});
        try{
            const data=await api<T>(url);
            if(currentUrl.current===url&&request===requestId.current){setResult({url,data});setError("");settled(url,data);}
            if(completion)return await completion;
            if(currentUrl.current===url&&request===requestId.current)return data;
        }catch(e){settled(url,undefined,e);throw e}
        finally{if(currentUrl.current===url&&request===requestId.current)setLoading(false)}
    },[url]);
    useEffect(()=>{
        for(const target of new Set(commits.current.filter(w=>w.url!==url).map(w=>w.url)))settled(target);
        const request=++requestId.current;setError("");
        if(!url){setLoading(false);return;}
        setLoading(true);
        api<T>(url).then(data=>{if(request===requestId.current){setResult({url,data});settled(url,data)}})
        .catch(e=>{if(request===requestId.current){setResult(null);setError(e.message);settled(url,undefined,e)}})
        .finally(()=>{if(request===requestId.current)setLoading(false)});
        return()=>{requestId.current++};
    },[url,tick]);
    useEffect(()=>()=>{for(const w of commits.current)w.resolve(undefined);commits.current=[]},[]);
    return {data:result?.url===url?result.data:null,error,loading,refresh};
}
type AppState = {
    boot: any;
    workspace: any;
    project: any;
    context: any;
    tick: number;
    reload: () => void;
    notify: (message: string) => void;
    navigate: (page: string) => void;
    registerUnsaved: (id: string, dirty: boolean) => void;
    canLeave: () => Promise<boolean>;
    notificationTarget?: any;
    consumeNotificationTarget?: () => void;
    setReportFocus?: (focused: boolean) => void;
    openWorkItem?: (kind: string, id: string) => Promise<void>;
};
export const AppContext = createContext<AppState>(null!);
export const useApp = () => useContext(AppContext);
export function useRememberedState<T>(scope: string, initial: T, persistent = false): [
    T,
    (next: SetStateAction<T>) => void
] {
    const key = `project-studio:v1:${scope}`;
    const read = () => { try {
        const raw = (persistent ? localStorage : sessionStorage).getItem(key);
        if (raw === null || raw.length > 32000)
            return initial;
        const parsed = JSON.parse(raw);
        return typeof parsed === typeof initial ? parsed as T : initial;
    }
    catch {
        return initial;
    } };
    const [stored, setStored] = useState(() => ({ key, value: read() }));
    const value = stored.key === key ? stored.value : read();
    const setValue = (next: SetStateAction<T>) => setStored((previous) => {
        const current = previous.key === key ? previous.value : read();
        const updated = typeof next === "function" ? (next as (value: T) => T)(current) : next;
        try {
            (persistent ? localStorage : sessionStorage).setItem(key, JSON.stringify(updated));
        }
        catch { }
        return { key, value: updated };
    });
    return [value, setValue];
}
export function useUnsavedChanges(dirty: boolean) {
    const { registerUnsaved } = useApp();
    const key = useId();
    useEffect(() => {
        registerUnsaved(key, dirty);
        return () => registerUnsaved(key, false);
    }, [key, dirty, registerUnsaved]);
}
export const roles: Record<string, string> = {
    owner: "空间所有者",
    manager: "项目经理",
    editor: "数据录入员",
    reviewer: "审核员",
    viewer: "只读协作方",
};
export const statusNames: Record<string, string> = {
    draft: "草稿",
    pending: "待审核",
    approved: "已审核",
    rejected: "已退回",
    obsolete: "已替换",
    withdrawn: "已撤回",
};
export function Status({ value }: {
    value: string;
}) {
    return (<span className={"status " + value}>{__ui(statusNames[value] || value)}</span>);
}
export const shortDate = (v: string | undefined) => (v ? v.slice(0, 10) : "—");
export const timestamp = (v: string) => new Date(v).toLocaleString(interfaceLocale(), { hour12: false });
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const currentMonth = () => today().slice(0, 7);
export function Empty({ text = "暂无数据", children, }: {
    text?: string;
    children?: ReactNode;
}) {
    return (<div className="empty">
      <div className="empty-mark"><Inbox size={30} aria-hidden="true"/></div>
      <strong>{__ui(text)}</strong>
      <p>{__ui(/匹配|符合/.test(text) ? "可以调整筛选条件后再查看。" : "数据加载已完成。添加或获准访问相关内容后，会在这里显示。")}</p>
      {__ui(children)}
    </div>);
}
export function Loading() {
    return (<div className="loading">
      <LoaderCircle className="spin" size={20}/>{__ui("正在加载…")}</div>);
}
export function ErrorBox({ message }: {
    message: string;
}) {
    return (<div role="alert" className="error-box">
      <AlertCircle size={18}/>
      {__ui(message)}
    </div>);
}
export function PageTitle({ icon: Icon, title, subtitle, children, }: {
    icon: any;
    title: string;
    subtitle?: string;
    children?: ReactNode;
}) {
    return (<div className="page-heading">
      <div className="heading-icon">
        <Icon size={27}/>
      </div>
      <div>
        <h1>{title}</h1>
        {__ui(subtitle && <p>{subtitle}</p>)}
      </div>
      <div className="heading-actions">{__ui(children)}</div>
    </div>);
}
export function SearchBox({ value, onChange, placeholder = "搜索", }: {
    value: string;
    onChange: (s: string) => void;
    placeholder?: string;
}) {
    return (<label className="search">
      <Search size={16}/>
      <input aria-label={__ui(placeholder)} placeholder={__ui(placeholder)} value={value} onChange={(e) => onChange(e.target.value)}/>
    </label>);
}
const ModalScope = createContext<{
    close: () => void;
    register: (key: string, dirty: boolean, busy: boolean) => void;
} | null>(null);
export function Modal({ title, onClose, children, wide = false, }: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    wide?: boolean;
}) {
    const root = useRef<HTMLDivElement>(null), closeRef = useRef(onClose);
    closeRef.current = onClose;
    const guards = useRef(new Map<string, {
        dirty: boolean;
        busy: boolean;
    }>());
    const [confirmClose, setConfirmClose] = useState(false), [savingWarning, setSavingWarning] = useState(false);
    const register = useCallback((key: string, dirty: boolean, busy: boolean) => { if (!dirty && !busy)
        guards.current.delete(key);
    else
        guards.current.set(key, { dirty, busy }); }, []);
    const requestClose = useCallback(() => {
        const states = [...guards.current.values()];
        if (states.some((guard) => guard.busy)) {
            setSavingWarning(true);
            return;
        }
        setSavingWarning(false);
        if (states.some((guard) => guard.dirty)) {
            setConfirmClose(true);
            return;
        }
        closeRef.current();
    }, []);
    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if (e.key === "Escape" && [...document.querySelectorAll('[role="dialog"]')].at(-1) === root.current) {
                e.preventDefault();
                requestClose();
            }
        };
        document.addEventListener("keydown", listener);
        const before = document.activeElement as HTMLElement;
        const el = root.current;
        el?.focus();
        return () => {
            document.removeEventListener("keydown", listener);
            before?.focus();
        };
    }, [requestClose]);
    return (<ModalScope.Provider value={{ close: requestClose, register }}>
    <div className="modal-backdrop" onClick={(e) => {
            if (e.target === e.currentTarget)
                requestClose();
        }}>
      <div role="dialog" ref={root} aria-modal="true" aria-label={title} className={"modal " + (wide ? "wide" : "")} tabIndex={-1} onKeyDown={(e) => {
            if (e.key === "Tab") {
                const nodes = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]');
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        }}>
        <div className="modal-title">
          <h2>{title}</h2>
          <button className="icon-button" aria-label={__ui("关闭")} onClick={requestClose}>
            <X size={20}/>
          </button>
        </div>
        {__ui(children)}
        {__ui(savingWarning && <p role="alert" className="error-box">{__ui("正在保存，请稍候再关闭。")}</p>)}
        {__ui(confirmClose && <div role="alertdialog" aria-label={__ui("未保存的修改")} className="unsaved-confirm"><strong>{__ui("有未保存的修改")}</strong><p>{__ui("继续编辑可保留当前输入。放弃修改将关闭此窗口。")}</p><div className="form-actions"><button autoFocus onClick={() => setConfirmClose(false)}>{__ui("继续编辑")}</button><button className="danger" onClick={() => closeRef.current()}>{__ui("放弃修改")}</button></div></div>)}
      </div>
    </div>
    </ModalScope.Provider>);
}
export function Form({ onSubmit, children, submit = "保存", onClose, }: {
    onSubmit: (data: FormData) => Promise<void>;
    children: ReactNode;
    submit?: string;
    onClose?: () => void;
}) {
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [dirty, setDirty] = useState(false);
    const scope = useContext(ModalScope), app = useContext(AppContext), key = useId(), form = useRef<HTMLFormElement>(null), baseline = useRef(""), saving = useRef(false);
    const snapshot = () => JSON.stringify([...new FormData(form.current!).entries()].map(([name, value]) => [name, typeof value === "string" ? value : [value.name, value.size, value.lastModified]]));
    useLayoutEffect(() => { if (form.current)
        baseline.current = snapshot(); }, []);
    useEffect(() => { scope?.register(key, dirty, busy); return () => scope?.register(key, false, false); }, [scope?.register, key, dirty, busy]);
    useEffect(() => { if (scope)
        app?.registerUnsaved(key, dirty); return () => app?.registerUnsaved(key, false); }, [app?.registerUnsaved, key, dirty, !!scope]);
    async function send(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (saving.current)
            return;
        saving.current = true;
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
            await onSubmit(data);
            setDirty(false);
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            saving.current = false;
            setBusy(false);
        }
    }
    return (<form ref={form} onSubmit={send} onChangeCapture={() => setDirty(snapshot() !== baseline.current)} onInputCapture={() => setDirty(snapshot() !== baseline.current)}>
      {__ui(children)}
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="form-actions">
        {__ui(onClose && (<button type="button" disabled={busy} onClick={scope?.close || onClose}>{__ui("取消")}</button>))}
        <button className="primary" disabled={busy}>
          {__ui(busy ? <LoaderCircle size={16} className="spin"/> : null)}
          {__ui(busy ? "正在保存…" : submit)}
        </button>
      </div>
    </form>);
}
export function Field({ label, children, hint, group = false, }: {
    label: string;
    children: ReactNode;
    hint?: string;
    group?: boolean;
}) {
    const Wrapper = group ? "div" : "label";
    return (<Wrapper className="form-field">
      <span>{label}</span>
      {__ui(children)}
      {__ui(hint && <small>{__ui(hint)}</small>)}
    </Wrapper>);
}
export function Confirm({ title, detail, onClose, onConfirm, }: {
    title: string;
    detail: string;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}) {
    return (<Modal title={__ui(title)} onClose={onClose}>
      <p className="confirm-text">{__ui(detail)}</p>
      <Form onClose={onClose} onSubmit={onConfirm} submit="确认">
        {__ui(null)}
      </Form>
    </Modal>);
}
export function ApproveDialog({ kind, title, recordId, tableId, onClose, payload = {}, }: {
    kind: string;
    title: string;
    recordId?: string;
    tableId?:string;
    onClose: () => void;
    payload?: any;
}) {
    const { context, boot, project, reload, notify } = useApp();
    const { data: workflows, error } = useApi<any[]>(project ? `/projects/${project.id}/workflows` : null);
    const attachments=useApprovalAttachments(project?.id||'');
    const [workflowId,setWorkflowId]=useState('');
    const applicable=availableWorkflows(workflows||[],kind,tableId);
    const workflow=applicable.find(w=>w.id===workflowId)||selectWorkflow(applicable,kind,tableId);
    const candidates = context.users.filter((u: any) => u.id !== boot.user.id &&
        (["stage", "baseline", "resource"].includes(kind)
            ? ["owner", "manager"]
            : ["owner", "manager", "reviewer"]).includes(u.role));
    return (<Modal title={__ui("提交审批")} onClose={onClose}>
      {__ui(error ? (<ErrorBox message={__ui(error)}/>) : !workflows ? (<Loading />) : (<>
          <Form submit="提交申请" onClose={onClose} onSubmit={async (d) => {
                await api(`/projects/${project.id}/approvals`, "POST", {
                    kind,
                    title: String(d.get("title")),
                    record_id: recordId,
                    attachment_ids:await attachments.upload(),
                    ...(workflow
                        ? { workflow_id: workflow.id }
                        : { approver_id: String(d.get("approver")) }),
                    payload,
                });
                notify("申请已提交，等待审批");
                reload();
                onClose();
            }}>
            <Field label={__ui("申请名称")}>
              <input name="title" defaultValue={title} required maxLength={120}/>
            </Field>
            {!workflow&&<Field label={__ui('审批流程')} hint={__ui('当前申请类型或所选数据表没有可用的已发布流程，请在用户与权限的审批流程中发布并设置适用范围；也可选择单人审批。')}><select aria-label={__ui('审批流程')} value="" disabled><option value="">{__ui('暂无匹配的已发布流程（单人审批）')}</option></select></Field>}
            {attachments.field}
            {__ui(workflow ? (<Field label={__ui("审批流程")} hint={__ui("该业务已启用统一流程，最后一个节点批准后生效。申请人不能出现在任一审批节点。")}>
                <div className="note"><select aria-label={__ui("审批流程")} required value={workflow.id} onChange={e=>setWorkflowId(e.target.value)}>{applicable.map(w=><option key={w.id} value={w.id}>{w.name} · v{w.version}</option>)}</select>
                  {workflow.name} · v{__ui(workflow.version)}
                  <br />
                  {__ui(workflow.steps
                    .map((s: any) => `${s.name}（${context.users.find((u: any) => u.id === s.approver_id)?.name || "审批人"}）`)
                    .join(" → "))}
                </div>
              </Field>) : (<>
                <Field label={__ui("审批人")} hint={__ui("申请人不能审批自己的申请。请先为其他账号配置审核员或项目经理角色。")}>
                  <select name="approver" required defaultValue="">
                    <option value="" disabled>{__ui("请选择审批人")}</option>
                    {__ui(candidates.map((u: any) => (<option key={u.id} value={u.id}>
                        {u.name} · {__ui(roles[u.role])}
                      </option>)))}
                  </select>
                </Field>
                {__ui(!candidates.length && (<ErrorBox message={__ui("当前没有其他可用审批人，请到用户与权限中添加并授权。")}/>))}
              </>))}
          </Form>
        </>))}
    </Modal>);
}
