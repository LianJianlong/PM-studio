import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, useEffect } from "react";
import { api, Confirm, ErrorBox, Modal, Form, Field, useApp, timestamp, useUnsavedChanges } from "./lib";
export default function AccountRow({ user, workspaceId, currentUserId, onSaved, onReset, onGrant, projectRole, }: {
    user: any;
    workspaceId: string;
    currentUserId: string;
    onSaved: () => void;
    onReset: () => void;
    onGrant?: () => void;
    projectRole: string;
}) {
    const {boot}=useApp();
    const [reveal,setReveal]=useState(false),[visiblePassword,setVisiblePassword]=useState<string|null>(null);
    useEffect(()=>{if(visiblePassword===null)return;const timer=setTimeout(()=>{setVisiblePassword(null);setReveal(false)},60000);return()=>clearTimeout(timer)},[visiblePassword]);
    const [draft, setDraft] = useState<{
        name: string;
        active: boolean;
        expected_revision: string;
    } | null>(null), [confirm, setConfirm] = useState(false), [error, setError] = useState("");
    useUnsavedChanges(!!draft && (draft.name !== user.name || draft.active !== user.active));
    const editable = user.id !== currentUserId && user.role !== "owner";
    return (<tr>
      <td data-label={__ui("姓名")}>
        {__ui(draft ? (<input aria-label={__uiFormat("{0} 姓名", [user.username])} maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/>) : (<div className="user-cell">
            <span className="mini-avatar">{user.name[0]}</span>
            <strong>{user.name}</strong>
          </div>))}
      </td>
      <td data-label={__ui("账号")}>{user.username}</td>
      <td data-label={__ui("空间身份")}>{__ui(user.role === "owner" ? "空间所有者" : "空间成员")}</td>
      <td data-label={__ui("项目角色")}>{projectRole}</td>
      <td data-label={__ui("状态")}>
        {__ui(draft ? (<select aria-label={__uiFormat("{0} 账号状态", [user.username])} value={draft.active ? "active" : "disabled"} onChange={(e) => setDraft({ ...draft, active: e.target.value === "active" })}>
            <option value="active">{__ui("正常")}</option>
            <option value="disabled">{__ui("停用")}</option>
          </select>) : (<span className={"status " + (user.active ? "approved" : "rejected")}>
            {__ui(user.active ? (user.must_change_password ? "待首次改密" : "正常") : "已停用")}
          </span>))}
      </td>
      <td data-label={__ui("创建时间")}>{__ui(timestamp(user.created_at))}</td>
      <td data-label={__ui("操作")}>
        {boot.user.system_admin&&<button onClick={()=>{setVisiblePassword(null);setReveal(true)}}>{__ui("查看密码")}</button>}
        {reveal&&<Modal title={__ui("查看用户密码")+' · '+user.username} onClose={()=>{setVisiblePassword(null);setReveal(false)}}>{visiblePassword===null?<Form submit="验证并查看" onSubmit={async d=>{const value=await api(`/system/users/${user.id}/reveal-password`,'POST',{admin_password:d.get('admin_password')});setVisiblePassword(value.password||'尚无可查看的新密码，请先重置');}}><Field label={__ui("请输入管理员自身密码")}><input name="admin_password" type="password" required autoComplete="current-password"/></Field></Form>:<Field label={__ui("当前密码")}><input readOnly value={visiblePassword} autoComplete="off"/></Field>}</Modal>}

        {__ui(editable && (<div className="inline-actions">
            {__ui(draft ? (<>
                <button className="primary" disabled={!draft.name.trim()} onClick={() => setConfirm(true)}>{__ui("保存本行")}</button>
                <button onClick={() => {
                    setDraft(null);
                    setError("");
                }}>{__ui("取消编辑")}</button>
              </>) : (<>
                <button aria-label={__uiFormat("编辑账号 {0}", [user.username])} onClick={() => {
                    setDraft({
                        name: user.name,
                        active: user.active,
                        expected_revision: user.revision,
                    });
                    setError("");
                }}>{__ui("编辑")}</button>
                <button aria-label={__uiFormat("重置密码 {0}", [user.name])} onClick={onReset}>{__ui("重置密码")}</button>
                {__ui(onGrant && <button onClick={onGrant}>{__ui("分配项目角色")}</button>)}
              </>))}
          </div>))}
        {__ui(error && <ErrorBox message={__ui(error)}/>)}
        {__ui(draft && confirm && (<Confirm title={__ui("保存账号修改")} detail={__uiFormat("{0}：姓名“{1}”，状态{2}。{3}修改账号信息需有该账号所有所属空间的管理权限。", [user.username, draft.name, draft.active ? __ui("正常") : __ui("停用"), draft.active !== user.active ? __ui("状态修改会撤销该账号现有登录会话。") : __ui("")])} onClose={() => setConfirm(false)} onConfirm={async () => {
                try {
                    await api(`/workspaces/${workspaceId}/users/${user.id}`, "PATCH", {
                        expected_revision: draft.expected_revision,
                        name: draft.name,
                        ...(draft.active !== user.active
                            ? { active: draft.active }
                            : {}),
                    });
                    setDraft(null);
                    setConfirm(false);
                    setError("");
                    onSaved();
                }
                catch (e) {
                    setConfirm(false);
                    setError((e as Error).message);
                }
            }}/>))}
      </td>
    </tr>);
}
