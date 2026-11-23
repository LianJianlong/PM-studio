import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useState } from "react";
import { Bell, CheckCheck, ArrowUpRight } from "lucide-react";
import { api, useApi, useApp, Modal, Empty, ErrorBox, timestamp } from "./lib";
export default function Notifications({ onNavigate, }: {
    onNavigate: (item: any) => void;
}) {
    const { tick, notify } = useApp();
    const [open, setOpen] = useState(false), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
    const { data, error } = useApi("/notifications", tick + revision);
    const [kind, setKind] = useState("all"), [project, setProject] = useState("all"), [unreadOnly, setUnreadOnly] = useState(false);
    const visible = (data?.items || []).filter((item: any) => (kind === "all" || item.kind === kind) && (project === "all" || item.project_id === project) && (!unreadOnly || !item.read_at));
    const projects = [...new Map<string, string>((data?.items || []).map((item: any) => [item.project_id, item.project_name])).entries()];
    useEffect(() => {
        const timer = setInterval(() => {
            if (!document.hidden)
                setRevision((v) => v + 1);
        }, 30000);
        const focus = () => setRevision((v) => v + 1);
        window.addEventListener("focus", focus);
        return () => {
            clearInterval(timer);
            window.removeEventListener("focus", focus);
        };
    }, []);
    async function mark(item?: any) {
        setBusy(true);
        try {
            await api(item ? `/notifications/${item.id}` : "/notifications/read-all", item ? "PATCH" : "POST", {});
            setRevision((v) => v + 1);
            if (item) {
                setOpen(false);
                onNavigate(item);
            }
        }
        catch (e) {
            notify((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return (<>
      <button className="icon-button notification-bell" aria-label={__uiFormat("消息中心{0}", [data?.unread ? __uiFormat("，{0}条未读", [data.unread]) : __ui("")])} onClick={() => {
            setOpen(true);
            setRevision((v) => v + 1);
        }}>
        <Bell size={20}/>
        {__ui(data?.unread > 0 && (<span>{__ui(data.unread > 99 ? "99+" : data.unread)}</span>))}
      </button>
      {__ui(open && (<Modal title={__ui("消息中心")} onClose={() => setOpen(false)}>
          <div className="notification-heading">
            <p className="help">{__ui("审批、指派与到期待办提醒 · 最近100条")}</p>
            <button disabled={busy || !data?.unread} onClick={() => void mark()}>
              <CheckCheck size={15}/>{__ui("全部已读")}</button>
          </div>
          <div className="notification-filters"><label>{__ui("消息类型")}<select aria-label={__ui("消息类型")} value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">{__ui("所有类型")}</option><option value="approval">{__ui("审批")}</option><option value="todo">{__ui("待办")}</option><option value="owner_item">{__ui("业主事项")}</option></select></label><label>{__ui("所属项目")}<select aria-label={__ui("消息项目")} value={project} onChange={(e) => setProject(e.target.value)}><option value="all">{__ui("所有项目")}</option>{__ui(projects.map(([id, name]) => <option key={id} value={id}>{__ui(name)}</option>))}</select></label><label className="checkbox-label"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)}/>{__ui("仅未读")}</label></div>
          <p className="help">{__ui("当前显示 ")}{__ui(visible.length)}{__ui(" 条。全部已读会处理所有当前有权访问的消息。")}</p>
          {__ui(error && <ErrorBox message={__ui(error)}/>)}
          {__ui(data && visible.length === 0 && <Empty text={__ui("没有符合筛选条件的消息")}/>)}
          <div className="notification-list">
            {__ui(visible.map((item: any) => (<button disabled={busy} className={item.read_at ? "read" : "unread"} key={item.id} onClick={() => void mark(item)}>
                <span className="notification-dot"/>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.project_name}</p>
                  <small>{__ui(({ approval: "审批", todo: "待办", owner_item: "业主事项" } as any)[item.kind])}{__ui(item.due_date ? ` · 到期 ${item.due_date} · ${item.owner_name || "本人"}` : "")}</small>
                  <small>{__ui(timestamp(item.created_at))}</small>
                </div>
                <ArrowUpRight size={17}/>
              </button>)))}
          </div>
        </Modal>))}
    </>);
}
