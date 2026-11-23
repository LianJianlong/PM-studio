import {copyTableSource} from "./table-transfer-clipboard";
import TransferTable from "./TransferTable";
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Star } from "lucide-react";
import { api, useApp, Modal, Form, Field, Confirm, today } from "./lib";
import CatalogMenu from "./CatalogMenu";
import MoveTable from "./MoveTable";
export default function CatalogActions({ kind, object, onCreateTable, }: {
    kind: "workspace" | "project" | "department" | "table";
    object: any;
    onCreateTable?: () => void;
}) {
    const { boot, workspace, project, context, reload, notify } = useApp();
    const key = `project-studio:star:v1:${boot.user.id}:${kind}:${object.id}`;
    const [starred, setStarred] = useState(() => {
        try {
            return localStorage.getItem(key) === "1";
        }
        catch {
            return false;
        }
    });
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);
    const [edit, setEdit] = useState<any>(null);
    const [remove, setRemove] = useState<any>(null);
    const [create, setCreate] = useState(false);
    const [createDepartment, setCreateDepartment] = useState(false);
    const [busy, setBusy] = useState(false);
    const [transfer,setTransfer]=useState(false);
    const [move, setMove] = useState(false);
    const canManage = kind === "workspace"
        ? workspace.role === "owner"
        : context.permission.manage;
    async function current(action: "rename" | "delete") {
        setBusy(true);
        try {
            const path = kind === "workspace"
                ? "/objects/workspaces"
                : kind === "project"
                    ? `/objects/workspaces/${workspace.id}/projects`
                    : kind === "department"
                        ? `/projects/${project.id}/departments`
                        : `/objects/projects/${project.id}/tables`;
            const rows = await api<any[]>(path);
            const row = rows.find((r) => r.id === object.id);
            if (!row)
                throw Error("对象已不可管理，请刷新目录");
            setMenu(null);
            if (action === "rename")
                setEdit(row);
            else
                setRemove(row);
        }
        catch (e) {
            notify((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return (<span className="catalog-actions" onClick={(e) => e.stopPropagation()}>
      {__ui(starred && (<Star size={12} className="catalog-star" aria-label={__ui("已星标")}/>))}
      <button type="button" className="icon-button" aria-label={__uiFormat("{0} 操作", [object.name])} aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => {
            e.preventDefault();
            setMenu(e.currentTarget);
        }}>
        <MoreHorizontal size={17}/>
      </button>
      {__ui(createPortal(<>
          {__ui(menu && (<CatalogMenu name={object.name} anchor={menu} onClose={closeMenu}>
              <div className="catalog-action-list">
                {__ui(kind === "table" && canManage && (<button role="menuitem" onClick={() => {
                        setMenu(null);
                        setMove(true);
                    }}>{__ui("移动到其他部门")}</button>))}
                {kind==="table"&&canManage&&!object.is_view&&!object.is_mapping&&<>
                  <button role="menuitem" onClick={()=>{copyTableSource(boot.user.id,object);setMenu(null);notify(__ui("已复制表，可切换项目后在数据目录粘贴"))}}>{__ui("复制数据表")}</button>
                  <button role="menuitem" onClick={()=>{setMenu(null);setTransfer(true)}}>{__ui("跨项目复制或移动数据表")}</button>
                </>}
                <button role="menuitem" onClick={() => {
                    const next = !starred;
                    try {
                        if (next)
                            localStorage.setItem(key, "1");
                        else
                            localStorage.removeItem(key);
                        window.dispatchEvent(new CustomEvent("project-studio:stars"));
                    }
                    catch {
                        notify("浏览器无法保存偏好，本次星标仅在当前页面有效");
                    }
                    setStarred(next);
                    setMenu(null);
                }}>
                  {__ui(starred ? "取消星标" : "添加星标")}
                </button>
                {__ui(kind === "workspace" && canManage && (<button role="menuitem" onClick={() => {
                        setMenu(null);
                        setCreate(true);
                    }}>{__ui("新增下级项目")}</button>))}
                {__ui(onCreateTable && canManage && (<button role="menuitem" onClick={() => {
                        setMenu(null);
                        onCreateTable();
                    }}>{__ui("新增下级数据表")}</button>))}
                {__ui(kind === "project" && canManage && (<button role="menuitem" onClick={() => {
                        setMenu(null);
                        setCreateDepartment(true);
                    }}>{__ui("新增下级部门")}</button>))}
                {__ui(canManage && (<>
                    <button role="menuitem" disabled={busy} onClick={() => current("rename")}>{__ui("重命名")}</button>
                    {__ui(kind !== "department" && (<button role="menuitem" disabled={busy} onClick={() => current("delete")}>{__ui("删除（可恢复）")}</button>))}
                  </>))}
              </div>
              <p className="help">{__ui("星标只保存于当前账号的本机浏览器。")}{__ui(kind === "department"
                    ? "部门删除和移动尚未开放。"
                    : "删除的对象可在对象管理中恢复。")}
              </p>
            </CatalogMenu>))}
          {__ui(edit && (<Modal title={__uiFormat("重命名：{0}", [edit.name])} onClose={() => setEdit(null)}>
              <Form onClose={() => setEdit(null)} onSubmit={async (d) => {
                    await api(kind === "department"
                        ? `/departments/${object.id}`
                        : `/objects/${kind}/${object.id}`, "PATCH", {
                        name: d.get("name"),
                        version: edit.object_version,
                    });
                    setEdit(null);
                    reload();
                    notify("名称已更新");
                }}>
                <Field label={__ui("新名称")}>
                  <input name="name" required maxLength={120} defaultValue={edit.name}/>
                </Field>
              </Form>
            </Modal>))}
          {transfer&&<TransferTable table={object} onClose={()=>setTransfer(false)}/>}
          {__ui(move && <MoveTable table={object} onClose={() => setMove(false)}/>)}
          {__ui(createDepartment && (<Modal title={__ui("新增下级部门")} onClose={() => setCreateDepartment(false)}>
              <Form onClose={() => setCreateDepartment(false)} onSubmit={async (d) => {
                    await api(`/projects/${object.id}/departments`, "POST", {
                        name: d.get("name"),
                    });
                    setCreateDepartment(false);
                    reload();
                    notify("部门已创建，可在部门目录下新增数据表");
                }}>
                <Field label={__ui("部门名称")}>
                  <input name="name" required maxLength={120}/>
                </Field>
                <p className="help">{__ui("同一项目内部门名称不能重复。新部门沿用项目访问规则，按部门授权的成员需另行配置。")}</p>
              </Form>
            </Modal>))}
          {__ui(remove && (<Confirm title={__uiFormat("删除：{0}", [remove.name])} detail={__ui("对象及其下级将从活动目录隐藏，数据和历史保留，可在对象管理中恢复。有待审申请时服务器会拒绝删除。")} onClose={() => setRemove(null)} onConfirm={async () => {
                    await api(`/objects/${kind}/${object.id}`, "PATCH", {
                        lifecycle: "deleted",
                        version: remove.object_version,
                    });
                    setRemove(null);
                    reload();
                    notify("对象已移入可恢复状态");
                }}/>))}
          {__ui(create && (<Modal title={__ui("新增下级项目")} onClose={() => setCreate(false)}>
              <Form onClose={() => setCreate(false)} onSubmit={async (d) => {
                    await api(`/workspaces/${workspace.id}/projects`, "POST", {
                        name: d.get("name"),
                        description: d.get("description"),
                        start_date: d.get("start_date"),
                    });
                    setCreate(false);
                    reload();
                    notify("项目已创建，可从顶部项目列表选择");
                }}>
                <Field label={__ui("项目名称")}>
                  <input name="name" required maxLength={120}/>
                </Field>
                <Field label={__ui("开始日期")}>
                  <input name="start_date" type="date" required defaultValue={today()}/>
                </Field>
                <Field label={__ui("项目说明")}>
                  <textarea name="description" maxLength={500}/>
                </Field>
              </Form>
            </Modal>))}
        </>, document.body))}
    </span>);
}
