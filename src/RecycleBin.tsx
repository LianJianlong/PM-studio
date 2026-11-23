import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api, useApp, useApi, PageTitle, ErrorBox, Loading, Confirm, Empty, } from "./lib";
const names: Record<string, string> = {
    workspace: "空间",
    project: "项目",
    table: "表",
    column: "列",
    record: "行",
};
export default function RecycleBin({ onClose }: {
    onClose: () => void;
}) {
    const { tick, reload, notify } = useApp();
    const [kind, setKind] = useState("all"), [search, setSearch] = useState(""), [page, setPage] = useState(1), [restore, setRestore] = useState<any>(null);
    const { data, error } = useApi<any>(`/objects/recycle-bin?kind=${kind}&page=${page}&search=${encodeURIComponent(search)}`, tick);
    return (<div className="page">
      <PageTitle icon={Trash2} title={__ui("回收站")} subtitle={__ui("已删除的空间、项目、表、列与行；保留原数据与恢复保护")}>
        <button onClick={onClose}>{__ui("返回对象管理")}</button>
      </PageTitle>
      <div className="agenda-toolbar">
        <input aria-label={__ui("搜索回收站")} value={search} placeholder={__ui("搜索名称或所属路径")} onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
        }}/>
        <select aria-label={__ui("回收站对象类型")} value={kind} onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
        }}>
          <option value="all">{__ui("全部类型")}</option>
          {__ui(Object.entries(names).map(([key, name]) => (<option key={key} value={key}>
              {__ui(name)}
            </option>)))}
        </select>
        <span>{__ui("共 ")}{__ui(data?.total || 0)}{__ui(" 项")}</span>
      </div>
      <p className="help">{__ui("先恢复上级，再恢复子对象。删除上级不会清空子数据；上级恢复后，未单独删除的子对象重新可见。回收站仅显示您有管理权限的对象。")}</p>
      {__ui(error ? (<ErrorBox message={__ui(error)}/>) : !data ? (<Loading />) : !data.rows.length ? (<Empty text={__ui("回收站没有符合条件的对象")}/>) : (<div className="grid-scroll">
          <table className="data-grid">
            <thead>
              <tr>
                <th>{__ui("类型")}</th>
                <th>{__ui("名称 / 内容")}</th>
                <th>{__ui("所属路径")}</th>
                <th>{__ui("版本")}</th>
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(data.rows.map((r: any) => (<tr key={r.kind + ":" + (r.table_id || "") + ":" + r.id}>
                  <td>{__ui(names[r.kind])}</td>
                  <td>{r.name}</td>
                  <td>{__ui(r.path || "—")}</td>
                  <td>{__ui(r.version)}</td>
                  <td>
                    <button onClick={() => setRestore(r)}>{__ui("恢复")}</button>
                  </td>
                </tr>)))}
            </tbody>
          </table>
        </div>))}
      <div className="table-footer">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{__ui("上一页")}</button>
        <span>{__ui("第 ")}{__ui(page)}{__ui(" 页")}</span>
        <button disabled={page * 50 >= (data?.total || 0)} onClick={() => setPage((p) => p + 1)}>{__ui("下一页")}</button>
      </div>
      {__ui(restore && (<Confirm title={__ui("恢复对象")} detail={__uiFormat("恢复{0}「{1}」？如果上级仍非活动状态，需要先恢复或激活上级。", [names[restore.kind], restore.name])} onClose={() => setRestore(null)} onConfirm={async () => {
                await api(restore.kind === "column"
                    ? `/objects/tables/${restore.table_id}/columns/${restore.id}`
                    : `/objects/${restore.kind}/${restore.id}`, "PATCH", { version: restore.version, lifecycle: "active" });
                setRestore(null);
                reload();
                notify("对象已恢复");
            }}/>))}
    </div>);
}
