import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import { api, useApp, Modal, Field, ErrorBox } from "./lib";
export default function MoveTable({ table, onClose, }: {
    table: any;
    onClose: () => void;
}) {
    const { context, reload, notify } = useApp();
    const [department, setDepartment] = useState("");
    const [preview, setPreview] = useState<any>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    return (<Modal title={__uiFormat("移动数据表：{0}", [table.name])} onClose={() => {
            if (!busy)
                onClose();
        }} wide>
      <p className="help">{__ui("在当前项目内移动整张表。表标识、记录及引用关系保持；部门范围权限随归属变化，正式统计的部门分类也会变化。待审记录必须先处理。")}</p>
      <Field label={__ui("目标部门")}>
        <select value={department} disabled={busy} onChange={(e) => {
            setDepartment(e.target.value);
            setPreview(null);
            setError("");
        }}>
          <option value="">{__ui("请选择目标部门")}</option>
          {__ui(context.departments
            .filter((d: any) => d.id !== table.department_id)
            .map((d: any) => (<option key={d.id} value={d.id}>
                {d.name}
              </option>)))}
        </select>
      </Field>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      {__ui(preview && (<>
          <p>{__ui("目标：")}{preview.target.name}{__ui(" · 待审记录：")}{__ui(preview.pending)}{__ui("· 权限变化：")}{__ui(preview.changes.length)}{__ui("人")}</p>
          <table className="data-grid">
            <thead>
              <tr>
                <th>{__ui("成员")}</th>
                <th>{__ui("移动前")}</th>
                <th>{__ui("移动后")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(preview.changes.map((r: any) => (<tr key={r.user_id}>
                  <td>
                    {r.name}（{r.username}）
                  </td>
                  <td>{__ui(r.before ? "可访问" : "不可访问")}</td>
                  <td>{__ui(r.after ? "可访问" : "不可访问")}</td>
                </tr>)))}
            </tbody>
          </table>
          <p className="help">{__ui("列隐藏、本人行、导出和到期限制继续适用。表中只列当前有效成员的表访问变化；已有报表快照不会重新计算。")}</p>
        </>))}
      <div className="form-actions">
        <button disabled={busy} onClick={onClose}>{__ui("取消")}</button>
        <button disabled={busy || !department} onClick={async () => {
            setBusy(true);
            setError("");
            setPreview(null);
            try {
                setPreview(await api(`/tables/${table.id}/move-preview?department=${encodeURIComponent(department)}`));
            }
            catch (e) {
                setError((e as Error).message);
            }
            finally {
                setBusy(false);
            }
        }}>{__ui("预览移动影响")}</button>
        <button className="primary" disabled={busy || !preview || preview.pending > 0} onClick={async () => {
            setBusy(true);
            setError("");
            try {
                await api(`/tables/${table.id}/move`, "POST", {
                    department_id: department,
                    version: preview.version,
                    fingerprint: preview.fingerprint,
                });
                reload();
                notify("数据表已移动");
                onClose();
            }
            catch (e) {
                setError((e as Error).message);
                setPreview(null);
            }
            finally {
                setBusy(false);
            }
        }}>{__ui("确认移动")}</button>
      </div>
    </Modal>);
}
