import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Eye, FilePlus2, Pencil, RotateCcw, Send, ThumbsUp, } from "lucide-react";
import { api, Empty, ErrorBox, Field, Form, Loading, Modal, PageTitle, timestamp, useApi, useApp, } from "./lib";
type Person = {
    id: string;
    name: string;
    role: string;
};
type OwnerItem = {
    id: string;
    title: string;
    content: string;
    proposer_id: string;
    proposer_name: string;
    reviewer_id: string;
    reviewer_name: string;
    approver_id: string;
    approver_name: string;
    status: string;
    version: number;
    updated_at: string;
    allowed_actions: string[];
    history?: Array<{
        id: number;
        action: string;
        from_status: string | null;
        to_status: string;
        opinion: string;
        actor_name: string;
        version: number;
        created_at: string;
    }>;
};
type Collection = {
    items: OwnerItem[];
    candidates: {
        reviewers: Person[];
        approvers: Person[];
    };
    allowed_actions: string[];
};
const statusLabels: Record<string, string> = {
    draft: "草稿",
    submitted: "待审核",
    reviewed: "待批复",
    approved: "已批复",
    rejected: "已退回",
    withdrawn: "已撤回",
};
const actionLabels: Record<string, string> = {
    create: "提出事项",
    update: "修改草稿",
    submit: "提交审核",
    review: "审核通过",
    approve: "最终批复",
    reject: "退回",
    withdraw: "撤回",
    reopen: "重新编辑",
};
const actionIcons: Record<string, typeof Send> = {
    submit: Send,
    review: CheckCircle2,
    approve: ThumbsUp,
    reject: RotateCcw,
    withdraw: RotateCcw,
    reopen: Pencil,
};
function StatusBadge({ value }: {
    value: string;
}) {
    const style = value === "submitted" || value === "reviewed" ? "pending" : value;
    return (<span className={`status ${style}`}>{__ui(statusLabels[value] || value)}</span>);
}
function ItemForm({ item, candidates, onDone, onClose, }: {
    item?: OwnerItem;
    candidates: Collection["candidates"];
    onDone: (id: string) => void;
    onClose: () => void;
}) {
    const { project } = useApp();
    return (<Modal title={__ui(item ? "修改业主事项草稿" : "提出业主事项")} onClose={onClose} wide>
      <Form submit={item ? "保存草稿" : "创建草稿"} onClose={onClose} onSubmit={async (data) => {
            const body = {
                title: data.get("title"),
                content: data.get("content"),
                reviewer_id: data.get("reviewer_id"),
                approver_id: data.get("approver_id"),
                ...(item ? { version: item.version } : {}),
            };
            const saved = await api<{
                id: string;
            }>(item
                ? `/owner-items/${item.id}`
                : `/projects/${project.id}/owner-items`, item ? "PATCH" : "POST", body);
            onDone(saved.id);
        }}>
        <Field label={__ui("事项标题")}>
          <input name="title" required maxLength={160} defaultValue={item?.title}/>
        </Field>
        <Field label={__ui("事项内容")}>
          <textarea name="content" maxLength={5000} rows={7} defaultValue={item?.content}/>
        </Field>
        <div className="form-grid">
          <Field label={__ui("指定审核人")}>
            <select name="reviewer_id" required defaultValue={item?.reviewer_id || ""}>
              <option value="" disabled>{__ui("选择审核员或项目经理")}</option>
              {__ui(candidates.reviewers.map((person) => (<option key={person.id} value={person.id}>
                  {person.name}（
                  {__ui(person.role === "manager" ? "项目经理" : "审核员")}）
                </option>)))}
            </select>
          </Field>
          <Field label={__ui("指定批复人")}>
            <select name="approver_id" required defaultValue={item?.approver_id || ""}>
              <option value="" disabled>{__ui("选择项目经理或空间所有者")}</option>
              {__ui(candidates.approvers.map((person) => (<option key={`${person.id}-${person.role}`} value={person.id}>
                  {person.name}（
                  {__ui(person.role === "owner" ? "空间所有者" : "项目经理")}）
                </option>)))}
            </select>
          </Field>
        </div>
        <p className="help">{__ui("提出人、审核人和批复人必须为三位不同人员。提交后不能修改正文或经办人。")}</p>
      </Form>
    </Modal>);
}
function ActionDialog({ item, action, onDone, onClose, }: {
    item: OwnerItem;
    action: "review" | "approve" | "reject";
    onDone: () => void;
    onClose: () => void;
}) {
    return (<Modal title={__ui(`${actionLabels[action]}：${item.title}`)} onClose={onClose}>
      <Form submit={actionLabels[action]} onClose={onClose} onSubmit={async (data) => {
            await api(`/owner-items/${item.id}/actions`, "POST", {
                action,
                version: item.version,
                opinion: data.get("opinion"),
            });
            onDone();
        }}>
        <Field label={__ui("处理意见")}>
          <textarea name="opinion" required maxLength={2000} rows={5} autoFocus/>
        </Field>
      </Form>
    </Modal>);
}
export default function OwnerItems({ initialItemId, createOnMount = false, }: {
    initialItemId?: string;
    createOnMount?: boolean;
} = {}) {
    const { project, notify, tick: appTick, notificationTarget, consumeNotificationTarget, } = useApp();
    const [tick, setTick] = useState(0);
    const [selected, setSelected] = useState(initialItemId || "");
    const [editing, setEditing] = useState<OwnerItem | null | undefined>(createOnMount ? null : undefined);
    const [action, setAction] = useState<"review" | "approve" | "reject" | "">("");
    const collection = useApi<Collection>(`/projects/${project.id}/owner-items`, tick + appTick);
    const detail = useApi<OwnerItem>(selected ? `/owner-items/${selected}` : null, tick + appTick);
    const items = collection.data?.items || [];
    useEffect(() => {
        if (!collection.data ||
            notificationTarget?.kind !== "owner_item" ||
            notificationTarget.project_id !== project.id)
            return;
        if (items.some((item) => item.id === notificationTarget.resource_id))
            setSelected(notificationTarget.resource_id);
        else
            notify("该事项已移除或不再可访问。");
        consumeNotificationTarget?.();
    }, [collection.data, notificationTarget, project.id]);
    useEffect(() => {
        if (notificationTarget?.kind === "owner_item" &&
            notificationTarget.project_id === project.id)
            return;
        if (!selected && items.length)
            setSelected(items[0].id);
        else if (selected &&
            collection.data &&
            !items.some((item) => item.id === selected))
            setSelected(items[0]?.id || "");
    }, [items, selected, collection.data, notificationTarget, project.id]);
    const refresh = (message?: string, id?: string) => {
        if (id)
            setSelected(id);
        setTick((value) => value + 1);
        if (message)
            notify(message);
    };
    const runSimple = async (item: OwnerItem, next: "submit" | "withdraw" | "reopen") => {
        try {
            await api(`/owner-items/${item.id}/actions`, "POST", {
                action: next,
                version: item.version,
                opinion: "",
            });
            refresh(next === "submit"
                ? "事项已提交审核"
                : next === "reopen"
                    ? "事项已恢复草稿，可修改后重新提交"
                    : "事项已撤回");
        }
        catch (e) {
            notify((e as Error).message);
        }
    };
    const current = detail.data;
    if (collection.loading && !collection.data)
        return <Loading />;
    if (collection.error)
        return <ErrorBox message={__ui(collection.error)}/>;
    return (<>
      <PageTitle icon={ClipboardCheck} title={__ui("业主事项")} subtitle={__ui("提出、审核与最终批复全程留痕，业务角色与空间所有者职责分开。")}>
        {__ui(collection.data?.allowed_actions.includes("create") ? (<button className="primary" onClick={() => setEditing(null)}>
            <FilePlus2 size={16}/>{__ui("提出事项")}</button>) : null)}
      </PageTitle>
      {__ui(!items.length ? (<div className="panel">
          <Empty text={__ui("暂无业主事项")}/>
        </div>) : (<div className="owner-items-layout">
          <section className="panel record-main">
            <div className="grid-scroll">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th>{__ui("事项")}</th>
                    <th>{__ui("状态")}</th>
                    <th>{__ui("提出人")}</th>
                    <th>{__ui("审核人")}</th>
                    <th>{__ui("批复人")}</th>
                    <th>{__ui("更新时间")}</th>
                    <th>{__ui("查看")}</th>
                  </tr>
                </thead>
                <tbody>
                  {__ui(items.map((item) => (<tr key={item.id} className={selected === item.id ? "selected" : ""}>
                      <td>
                        <strong>{item.title}</strong>
                      </td>
                      <td>
                        <StatusBadge value={item.status}/>
                      </td>
                      <td>{item.proposer_name}</td>
                      <td>{item.reviewer_name}</td>
                      <td>{item.approver_name}</td>
                      <td>{__ui(timestamp(item.updated_at))}</td>
                      <td>
                        <button aria-label={__uiFormat("查看{0}", [item.title])} onClick={() => setSelected(item.id)}>
                          <Eye size={15}/>
                        </button>
                      </td>
                    </tr>)))}
                </tbody>
              </table>
            </div>
          </section>
          <aside className="panel inspector">
            {__ui(detail.loading && !current ? (<Loading />) : detail.error ? (<ErrorBox message={__ui(detail.error)}/>) : current ? (<>
                <div className="section-heading">
                  <div>
                    <h3>{current.title}</h3>
                    <p className="help">{__ui("版本")}{__ui(current.version)} · {__ui(timestamp(current.updated_at))}
                    </p>
                  </div>
                  <StatusBadge value={current.status}/>
                </div>
                <p className="confirm-text">
                  {current.content || "（未填写事项内容）"}
                </p>
                <dl>
                  <dt>{__ui("提出人")}</dt>
                  <dd>{current.proposer_name}</dd>
                  <dt>{__ui("审核人")}</dt>
                  <dd>{current.reviewer_name}</dd>
                  <dt>{__ui("批复人")}</dt>
                  <dd>{current.approver_name}</dd>
                </dl>
                <div className="heading-actions">
                  {__ui(current.allowed_actions.includes("edit") ? (<button onClick={() => setEditing(current)}>
                      <Pencil size={15}/>{__ui("修改")}</button>) : null)}
                  {__ui(current.allowed_actions
                    .filter((name) => [
                    "submit",
                    "review",
                    "approve",
                    "reject",
                    "withdraw",
                    "reopen",
                ].includes(name))
                    .map((name) => {
                    const Icon = actionIcons[name];
                    return (<button key={name} className={name === "approve" || name === "review"
                            ? "primary"
                            : name === "reject"
                                ? "danger"
                                : ""} onClick={() => {
                            if (name === "submit" ||
                                name === "withdraw" ||
                                name === "reopen")
                                void runSimple(current, name);
                            else
                                setAction(name as "review" | "approve" | "reject");
                        }}>
                          <Icon size={15}/> {__ui(actionLabels[name])}
                        </button>);
                }))}
                </div>
                <div className="section-heading">
                  <h3>{__ui("流转历史")}</h3>
                </div>
                {__ui(current.history?.map((event) => (<div className="note" key={event.id}>
                    <strong>
                      {__ui(actionLabels[event.action] || event.action)}
                    </strong>{__ui(" ")}
                    · {event.actor_name}
                    <div>
                      {__ui(event.from_status
                        ? `${statusLabels[event.from_status]} → `
                        : "")}
                      {__ui(statusLabels[event.to_status])}{__ui(" · 版本 ")}{__ui(event.version)}
                    </div>
                    {__ui(event.opinion ? <p>{event.opinion}</p> : null)}
                    <small>{__ui(timestamp(event.created_at))}</small>
                  </div>)))}
              </>) : (<Empty text={__ui("选择事项查看详情")}/>))}
          </aside>
        </div>))}
      {__ui(editing !== undefined ? (<ItemForm item={editing || undefined} candidates={collection.data!.candidates} onClose={() => setEditing(undefined)} onDone={(id) => {
                setEditing(undefined);
                refresh(editing ? "草稿已保存" : "业主事项草稿已创建", id);
            }}/>) : null)}
      {__ui(action && current ? (<ActionDialog item={current} action={action} onClose={() => setAction("")} onDone={() => {
                const message = action === "review"
                    ? "审核已完成"
                    : action === "approve"
                        ? "事项已批复"
                        : "事项已退回";
                setAction("");
                refresh(message);
            }}/>) : null)}
    </>);
}
