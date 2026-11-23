import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { api, useApp, Modal, Field, ErrorBox } from "./lib";
import { isSystemField } from "../shared/fields";
type Sheet = {
    name: string;
    headers: string[];
    rows: unknown[][];
};
export default function ImportWizard({ table, onClose, }: {
    table: any;
    onClose: () => void;
}) {
    const { reload, notify } = useApp();
    const [sheets, setSheets] = useState<Sheet[]>([]), [index, setIndex] = useState(0), [mapping, setMapping] = useState<Record<string, number>>({}), [preview, setPreview] = useState<any>(null), [requestKey, setRequestKey] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [filename, setFilename] = useState("");
    const sheet = sheets[index];
    const columns = table.columns.filter((f: any) => !isSystemField(f));
    function selectSheet(next: number, source = sheets) {
        setIndex(next);
        setPreview(null);
        setMapping(Object.fromEntries(columns.flatMap((f: any) => {
            const index = source[next]?.headers.findIndex((header) => header.trim() === f.name || header.trim() === f.id) ?? -1;
            return index >= 0 ? [[f.id, index]] : [];
        })));
    }
    async function run(action: () => Promise<void>) {
        setError("");
        setBusy(true);
        try {
            await action();
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    return (<Modal title={__ui("导入 Excel / CSV")} onClose={onClose} wide>
      <p className="help">{__ui("选择文件 → 对应字段 → 校验预览 → 保存草稿。每批最多1000行；第一行为列名。日期使用 YYYY-MM-DD，公式请先粘贴为值。")}</p>
      {__ui(columns.some((f: any) => f.type === "backlink") && (<p className="help">{__ui("本表包含反向引用。导入该列会同步更新关联源草稿的引用；已审批或无权修改的源记录会使整批导入失败。若只新增本表记录，请将反向列设为“不导入此字段”。")}</p>))}
      <Field label={__ui("选择文件（.xlsx / UTF-8 .csv，最大1MB）")}>
        <input type="file" accept=".xlsx,.csv" disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            setSheets([]);
            setPreview(null);
            void run(async () => {
                if (file.size > 1024 * 1024)
                    throw Error("文件超过1MB，请拆分后导入");
                const content = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(",")[1]);
                    reader.onerror = () => reject(Error("读取文件失败"));
                    reader.readAsDataURL(file);
                });
                const result = await api<{
                    sheets: Sheet[];
                }>(`/tables/${table.id}/import-file`, "POST", { filename: file.name, content });
                if (!result.sheets.length)
                    throw Error("文件没有可导入的数据");
                setSheets(result.sheets);
                setFilename(file.name);
                selectSheet(0, result.sheets);
            });
        }}/>
      </Field>
      {__ui(sheet && (<>
          <Field label={__ui("工作表")}>
            <select disabled={busy} value={index} onChange={(e) => selectSheet(Number(e.target.value))}>
              {__ui(sheets.map((s, i) => (<option key={i} value={i}>
                  {s.name} · {__ui(s.rows.length)}{__ui("行")}</option>)))}
            </select>
          </Field>
          <div className="import-mapping">
            {__ui(columns.map((f: any) => (<Field key={f.id} label={f.name + (f.required ? " *" : "")}>
                <select disabled={busy} value={mapping[f.id] ?? ""} onChange={(e) => {
                    setMapping((prev) => {
                        const next = { ...prev };
                        if (e.target.value === "")
                            delete next[f.id];
                        else
                            next[f.id] = Number(e.target.value);
                        return next;
                    });
                    setPreview(null);
                }}>
                  <option value="">{__ui("不导入此字段")}</option>
                  {__ui(sheet.headers.map((h, i) => (<option key={i} value={i}>
                      {i + 1}. {__ui(h || "（空列名）")}
                    </option>)))}
                </select>
              </Field>)))}
          </div>
          <p className="help">{__ui("文件：")}{__ui(filename)}{__ui("· 未对应的文件列将忽略；必填字段必须对应。仅新增草稿，不覆盖已有记录。")}</p>
          {__ui(preview?.errors.length > 0 && (<div className="import-errors" role="alert">
              <strong>
                {__ui(preview.errors.length)}{__ui("行未通过校验，尚未写入数据")}</strong>
              {__ui(preview.errors.slice(0, 30).map((e: any) => (<p key={e.row}>{__ui("第")}{__ui(e.row)}{__ui(" 行：")}{__ui(e.message)}
                </p>)))}
              {__ui(preview.errors.length > 30 && (<p>{__ui("仅显示前30项，请修正源文件后重新选择。")}</p>))}
            </div>))}
          {__ui(preview && !preview.errors.length && (<div className="import-success">
              <CheckCircle2 size={18}/> {__ui(preview.total)}{__ui(" ")}{__ui("行全部通过检查，可以保存。")}</div>))}
          <div className="import-preview">
            <table className="data-grid">
              <thead>
                <tr>
                  <th>{__ui("文件行")}</th>
                  {__ui(columns.map((f: any) => (<th key={f.id}>{f.name}</th>)))}
                </tr>
              </thead>
              <tbody>
                {__ui(sheet.rows.slice(0, 5).map((row, r) => (<tr key={r}>
                    <td>{r + 2}</td>
                    {__ui(columns.map((f: any) => (<td key={f.id}>{__ui(String(row[mapping[f.id]] ?? "—"))}</td>)))}
                  </tr>)))}
              </tbody>
            </table>
          </div>
          <small className="muted">{__ui("预览前5行。校验和保存均检查整批数据及当前访问权限。")}</small>
        </>))}
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="form-actions">
        <button disabled={busy} onClick={onClose}>{__ui("取消")}</button>
        {__ui(sheet && (<button disabled={busy || !sheet.rows.length} onClick={() => void run(async () => {
                setPreview(await api(`/tables/${table.id}/import-preview`, "POST", {
                    rows: sheet.rows,
                    mapping,
                }));
                setRequestKey(crypto.randomUUID());
            })}>
            {__ui(busy ? "正在处理…" : "校验数据")}
          </button>))}
        {__ui(preview && !preview.errors.length && (<button className="primary" disabled={busy} onClick={() => void run(async () => {
                const result = await api(`/tables/${table.id}/import`, "POST", {
                    rows: preview.rows,
                    request_key: requestKey,
                });
                notify(`已导入 ${result.count} 条草稿`);
                reload();
                onClose();
            })}>
            <Upload size={16}/>{__ui(" 确认导入 ")}{__ui(preview.total)}{__ui("行")}</button>))}
      </div>
    </Modal>);
}
