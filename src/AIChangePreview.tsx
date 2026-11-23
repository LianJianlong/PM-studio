import {displayAIText} from '../shared/ai-reference-labels';
import { useEffect, useMemo, useState, useRef } from "react";
import { api, Modal, Loading, ErrorBox } from "./lib";
import { translateUiValue as ui, formatUiTemplate as fmt } from "./i18n";
import { previewRows, type PreviewCell } from "./ai-preview";
function Value({ value }: { value: any }) {
  return (
    <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {value === undefined || value === null
        ? "—"
        : typeof value === "boolean"
          ? ui(value ? "是" : "否")
          : typeof value === "object"
            ? JSON.stringify(value, null, 2)
            : String(value)}
    </span>
  );
}
function Diff({ rows }: { rows: PreviewCell[] }) {
  const [page, setPage] = useState(0);
  return (
    <>
      <div className="grid-scroll ai-answer">
        <table className="data-grid ai-diff">
          <thead>
            <tr>
              <th>{ui("记录 / 对象")}</th>
              <th>{ui("字段")}</th>
              <th>{ui("修改前")}</th>
              <th>{ui("拟写入值")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(page * 50, page * 50 + 50).map((r, i) => (
              <tr key={i}>
                <td>{r.record}</td>
                <td>{ui(r.field)}</td>
                <td>
                  <Value value={r.before} />
                </td>
                <td className="ai-new-value">
                  <Value value={r.after} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 50 && (
        <div className="heading-actions">
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            {ui("上一页")}
          </button>
          <span>
            {fmt("第 {0} 页，共 {1} 项差异", [page + 1, rows.length])}
          </span>
          <button
            disabled={(page + 1) * 50 >= rows.length}
            onClick={() => setPage((p) => p + 1)}
          >
            {ui("下一页")}
          </button>
        </div>
      )}
    </>
  );
}
export default function AIChangePreview({
  project,
  change,
  onClose,
  onWritten,
}: {
  project: string;
  change: any;
  onClose: () => void;
  onWritten: (r: any) => void;
}) {
  const savingRef=useRef(false);
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),[expandAll,setExpandAll]=useState<boolean|null>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError("");
    api(`/projects/${project}/ai/changes/${change.id}/preview`, "POST", {})
      .then((r) => {
        if (active) setPreview(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [project, change.id]);
  const operations = useMemo(
    () =>
      preview?.operations.map((op: any) => ({
        ...op,
        diff: previewRows(op, preview),
      })) || [],
    [preview],
  );
  return (
    <Modal
      wide
      title={ui("修改结果预览")}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <div className="ai-review-summary"><p>{ui("方案步骤")}：{preview?.summary?.steps||0} · {ui("影响记录")}：{preview?.summary?.changed_records||0} · {ui("失败整批回滚")}</p>
        <strong>{displayAIText(change.body?.summary || ui("AI数据操作"))}</strong>
        <p>
          {ui(
            "以下内容尚未写入。请核对原值与拟写入值，确认后一次执行整个方案。",
          )}
        </p>
        {preview?.data.destinations?.map((d: any) => (
          <p key={d.table_id}>
            {d.project_name} → {d.module_path} → <strong>{d.table_name}</strong>
          </p>
        ))}
      </div>
      {!!preview?.data.action_checks?.length&&<section className="panel"><strong>{ui('动作前置条件已核验')}</strong>{preview.data.action_checks.map((c:any,i:number)=><div key={i}><p>{c.table} · {c.name} · {ui('版本')} {c.version} · {ui('记录变更次数')} {c.checked_records}</p><ul>{c.conditions.map((x:any,j:number)=><li key={j}>{ui(x.basis==='current'?'原记录':'修改结果')}：{x.description}</li>)}</ul></div>)}</section>}
      {error && <ErrorBox message={error} />}{" "}
      {!preview && !error && <Loading />}
      {operations.length>3&&<div className="heading-actions"><button type="button" onClick={()=>setExpandAll(true)}>{ui("展开所有步骤")}</button><button type="button" onClick={()=>setExpandAll(false)}>{ui("收起所有步骤")}</button></div>}
      {operations.map((op: any, i: number) => {
        const remove =
          op.method === "DELETE" ||
          op.body?.lifecycle === "deleted" ||
          op.path.endsWith("/batch-delete");
        const change=preview.data.changes?.find((c:any)=>c.step===op.key);
        const tables=[...new Set([...(change?.before||[]),...(change?.after||[])].map((r:any)=>r.table||r.name).filter(Boolean))].join("、")||op.body?.name||"";
        return (
          <details key={op.key} className="panel ai-operation-preview" open={expandAll??(operations.length<=3||remove)}>
            <summary><strong>
              {i + 1}.{" "}
              {ui(
                remove
                  ? "删除"
                  : op.path.endsWith("/batch-update") ||
                      ["PUT", "PATCH"].includes(op.method)
                    ? "修改"
                    : "新增",
              )}{" "}
              · {tables} · {fmt("{0} 项差异", [op.diff.length])}
            </strong></summary>
            {op.diff.length ? (
              <Diff rows={op.diff} />
            ) : (
              <p>{ui("业务校验通过，内容未变化。")}</p>
            )}

          </details>
        );
      })}
      <p className="help">
        {ui(
          "AI拟定的说明或工作范围是建议草案；正式记录的修改会生成变更草稿，业务审批规则继续适用。写入时再次检查权限和版本，冲突整批回滚。",
        )}
      </p>
      <div className="form-actions ai-confirm-footer">
        <button type="button" disabled={saving} onClick={onClose}>
          {ui("返回")}
        </button>
        <button
          className="primary"
          disabled={!preview || !!error || saving}
          onClick={async () => {
            if(savingRef.current)return;savingRef.current=true;setSaving(true);
            setError("");
            try {
              const r = await api(
                `/projects/${project}/ai/changes/${change.id}/confirm`,
                "POST",
                { confirm: true,preview_digest:preview.preview_digest },
              );
              onWritten(r);
            } catch (e) {
              setError((e as Error).message);
              setPreview(null);
            } finally {
              setSaving(false);savingRef.current=false;
            }
          }}
        >
          {ui(saving ? "正在写入" : "确认写入")}
        </button>
      </div>
    </Modal>
  );
}
