import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import FormulaBuilder from "./FormulaBuilder";
import { ArrowUp, ArrowDown, Copy, Plus, Trash2 } from "lucide-react";
import { api, Form, Field, Modal, useApp } from "./lib";
import { fieldTypes, typeLabels, choiceTypes, isReference, isSystemField, type FieldType, } from "../shared/fields";
type ColumnDraft = {
    key: string;
    id: string;
    name: string;
    type: FieldType;
    required: boolean;
    unit: string;
    precision: number;
    scale: number;
    optionsText: string;
    target_table: string;
    display_column: string;
    bidirectional: boolean;
    inverse_name: string;
    formulaText: string;
};
function newColumn(id: string, name = "", type: FieldType = "text", required = false): ColumnDraft {
    return {
        key: crypto.randomUUID(),
        id,
        name,
        type,
        required,
        unit: "",
        precision: 38,
        scale: 2,
        optionsText: "",
        target_table: "",
        display_column: "",
        bidirectional: false,
        inverse_name: "",
        formulaText: "",
    };
}
export default function CreateTable({ tables, defaultDepartment, onClose, onCreated, }: {
    tables: any[];
    defaultDepartment?: string;
    onClose: () => void;
    onCreated: (id: string) => void;
}) {
    const { context, project } = useApp();
    const [columns, setColumns] = useState<ColumnDraft[]>(() => [
        newColumn("title", "事项名称", "text", true),
        newColumn("date", "登记日期", "date", true),
        newColumn("note", "说明"),
    ]);
    const [formulaKey, setFormulaKey] = useState<string | null>(null);
    const formulaColumn = columns.find(c => c.key === formulaKey && c.type === 'formula');
    function update(key: string, patch: Partial<ColumnDraft>) {
        setColumns((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    }
    function freshId(rows: ColumnDraft[]) {
        let n = 1;
        while (rows.some((r) => r.id === `field_${n}`))
            n++;
        return `field_${n}`;
    }
    function add(copy?: ColumnDraft) {
        setColumns((rows) => rows.length >= 50
            ? rows
            : [
                ...rows,
                copy
                    ? {
                        ...copy,
                        key: crypto.randomUUID(),
                        id: freshId(rows),
                        name: `${copy.name}副本`.slice(0, 120),
                    }
                    : newColumn(freshId(rows)),
            ]);
    }
    function move(index: number, delta: number) {
        setColumns((rows) => {
            const next = [...rows];
            [next[index], next[index + delta]] = [next[index + delta], next[index]];
            return next;
        });
    }
    return (<Modal title={__ui("创建部门数据表")} onClose={onClose} wide>
      <Form submit="创建数据表" onClose={onClose} onSubmit={async (form) => {
            const ids = columns.map((c) => c.id.trim());
            if (new Set(ids).size !== ids.length)
                throw new Error("字段标识重复，请检查结构配置表");
            const fields = columns.map((c) => ({
                id: c.id.trim(),
                name: c.name.trim(),
                type: c.type,
                required: c.required,
                unit: c.unit,
                ...(c.type === "decimal"
                    ? { precision: c.precision, scale: c.scale }
                    : {}),
                ...(c.type === "formula" ? { formula: c.formulaText.trim() } : {}),
                ...(choiceTypes.includes(c.type)
                    ? {
                        options: c.optionsText
                            .split(/\r?\n/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                    }
                    : {}),
                ...(c.type === "reference"
                    ? {
                        target_table: c.target_table,
                        display_column: c.display_column || undefined,
                        bidirectional: c.bidirectional,
                        inverse_name: c.bidirectional && c.inverse_name.trim()
                            ? c.inverse_name.trim()
                            : undefined,
                    }
                    : {}),
            }));
            const r = await api(`/projects/${project.id}/tables`, "POST", {
                name: form.get("name"),
                description: form.get("description"),
                department_id: form.get("department"),
                columns: fields,
            });
            onCreated(r.id);
        }}>
        <div className="form-grid">
          <Field label={__ui("表名称")}>
            <input name="name" required maxLength={120}/>
          </Field>
          <Field label={__ui("所属部门")}>
            <select name="department" required defaultValue={defaultDepartment || context.departments[0]?.id}>
              {__ui(context.departments.map((d: any) => (<option key={d.id} value={d.id}>
                  {d.name}
                </option>)))}
            </select>
          </Field>
        </div>
        <Field label={__ui("表说明")}>
          <input name="description" maxLength={500}/>
        </Field>
        <div className="section-heading">
          <h3>{__ui("字段结构 · ")}{__ui(columns.length)}{__ui(" / 50 列")}</h3>
          <button type="button" disabled={columns.length >= 50} onClick={() => add()}>
            <Plus size={16}/>{__ui("新增列")}</button>
        </div>
        <p className="help">{__ui("可直接修改初始三列。中文列名用于显示，英文字段标识用于导入和关联。选择类型后在该行填写类型设置；系统时间/人员自动生成，反向引用列由系统建立。")}</p>
        {__ui(formulaColumn && <section className="panel new-table-formula-editor"><div className="section-heading"><h3>{__ui("鼠标公式编辑 · ")}{formulaColumn.name || formulaColumn.id}</h3><button type="button" onClick={() => setFormulaKey(null)}>{__ui("完成公式编辑")}</button></div><FormulaBuilder key={formulaColumn.key} fields={columns.filter(f => f.key !== formulaColumn.key && f.id.trim()).map(f => ({ id: f.id.trim(), name: f.name || f.id, type: f.type })) as any} value={formulaColumn.formulaText} onChange={formulaText => update(formulaColumn.key, { formulaText })} inputName={`formula_${formulaColumn.key}`}/></section>)}
        <div className="grid-scroll">
          <table className="data-grid column-designer">
            <thead>
              <tr>
                <th>{__ui("顺序")}</th>
                <th>{__ui("列名")}</th>
                <th>{__ui("字段标识")}</th>
                <th>{__ui("数据类型")}</th>
                <th>{__ui("必填")}</th>
                <th>{__ui("单位")}</th>
                <th>{__ui("类型设置")}</th>
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(columns.map((c, index) => {
            const label = (s: string) => `第${index + 1}列 ${s}`, target = tables.find((t) => t.id === c.target_table);
            return (<tr key={c.key}>
                    <td>{index + 1}</td>
                    <td>
                      <input aria-label={__ui(label("列名"))} required maxLength={120} value={c.name} onChange={(e) => update(c.key, { name: e.target.value })} placeholder={__ui("例如：合同金额")}/>
                    </td>
                    <td>
                      <input aria-label={__ui(label("字段标识"))} required maxLength={40} pattern="[a-zA-Z][a-zA-Z0-9_]{0,39}" value={c.id} onChange={(e) => update(c.key, { id: e.target.value })}/>
                    </td>
                    <td>
                      <select aria-label={__ui(label("数据类型"))} value={c.type} onChange={(e) => {
                    const type = e.target.value as FieldType;
                    update(c.key, {
                        type,
                        required: isSystemField({ type } as any)
                            ? false
                            : c.required,
                    });
                }}>
                        {__ui(fieldTypes
                    .filter((t) => t !== "backlink")
                    .map((t) => (<option key={t} value={t}>
                              {__ui(typeLabels[t])}
                            </option>)))}
                      </select>
                      <details className="type-browser">
                        <summary>{__ui("鼠标选择数据类型")}</summary>
                        <div className="type-picker">
                          {__ui(fieldTypes
                    .filter((t) => t !== "backlink")
                    .map((t) => (<button type="button" key={t} aria-pressed={c.type === t} onClick={() => update(c.key, {
                        type: t,
                        required: isSystemField({ type: t } as any)
                            ? false
                            : c.required,
                    })}>
                                {__ui(typeLabels[t])}
                              </button>)))}
                        </div>
                      </details>
                    </td>
                    <td>
                      <input aria-label={__ui(label("必填"))} type="checkbox" disabled={isSystemField(c)} checked={c.required} onChange={(e) => update(c.key, { required: e.target.checked })}/>
                    </td>
                    <td>
                      <input aria-label={__ui(label("单位"))} maxLength={20} value={c.unit} onChange={(e) => update(c.key, { unit: e.target.value })}/>
                    </td>
                    <td>
                      {__ui(c.type === "decimal" ? (<div className="column-options">
                          <label>{__ui("总有效位数")}<input aria-label={__ui(label("总有效位数"))} type="number" required min={1} max={1000} value={c.precision} onChange={(e) => update(c.key, {
                        precision: Number(e.target.value),
                    })}/>
                          </label>
                          <label>{__ui("小数位")}<input aria-label={__ui(label("小数位"))} type="number" required min={0} max={c.precision} value={c.scale} onChange={(e) => update(c.key, { scale: Number(e.target.value) })}/>
                          </label>
                          <small>{__ui("精确存储，不自动舍入")}</small>
                        </div>) : choiceTypes.includes(c.type) ? (<textarea aria-label={__ui(label("选项，每行一个"))} rows={3} required placeholder={__ui("待处理\n处理中\n已完成")} value={c.optionsText} onChange={(e) => update(c.key, { optionsText: e.target.value })}/>) : c.type === "formula" ? (<div className="column-options">
                          <textarea aria-label={__ui(label('公式表达式'))} value={c.formulaText} onChange={e => update(c.key, { formulaText: e.target.value })} required rows={2}/>
                          <button type="button" onClick={() => { setFormulaKey(c.key); requestAnimationFrame(() => document.querySelector('.new-table-formula-editor')?.scrollIntoView({ block: 'start' })); }}>{__ui("鼠标编辑公式")}</button>
                          <small>{__ui("使用 [字段标识] 引用字段；支持 SUM、AVG、MIN、MAX、ROUND、IF、COALESCE、CONCAT 等函数。")}</small>
                        </div>) : c.type === "reference" ? (<div className="column-options">
                          <select aria-label={__ui(label("关联数据表"))} required value={c.target_table} onChange={(e) => update(c.key, {
                        target_table: e.target.value,
                        display_column: "",
                    })}>
                            <option value="">{__ui("选择关联数据表")}</option>
                            {__ui(tables
                        .filter((t) => t.lifecycle === "active")
                        .map((t) => (<option key={t.id} value={t.id}>
                                  {t.department_name} · {t.name}
                                </option>)))}
                          </select>
                          <select aria-label={__ui(label("记录显示字段"))} value={c.display_column} onChange={(e) => update(c.key, { display_column: e.target.value })}>
                            <option value="">{__ui("显示记录ID")}</option>
                            {__ui(target?.columns
                        .filter((f: any) => !isReference(f))
                        .map((f: any) => (<option key={f.id} value={f.id}>
                                  {f.name}
                                </option>)))}
                          </select>
                          <label className="checkbox-label">
                            <input type="checkbox" checked={c.bidirectional} onChange={(e) => update(c.key, {
                        bidirectional: e.target.checked,
                    })}/>{__ui("双向引用")}</label>
                          {__ui(c.bidirectional && (<input aria-label={__ui(label("反向列名称"))} placeholder={__ui("反向列名称（可留空）")} maxLength={120} value={c.inverse_name} onChange={(e) => update(c.key, { inverse_name: e.target.value })}/>))}
                        </div>) : (<small>
                          {__ui(isSystemField(c)
                        ? "自动生成，只读"
                        : ["int64", "uint64"].includes(c.type)
                            ? "以文本传输，保留精度"
                            : ["json", "array"].includes(c.type)
                                ? "标准JSON，64KB以内"
                                : c.type === "timestamptz"
                                    ? "带时区，统一保存UTC"
                                    : "无需额外设置")}
                        </small>))}
                    </td>
                    <td>
                      <div className="column-actions">
                        <button type="button" aria-label={__ui(label("上移"))} disabled={index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp size={14}/>
                        </button>
                        <button type="button" aria-label={__ui(label("下移"))} disabled={index === columns.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown size={14}/>
                        </button>
                        <button type="button" aria-label={__ui(label("复制"))} disabled={columns.length >= 50} onClick={() => add(c)}>
                          <Copy size={14}/>
                        </button>
                        <button type="button" aria-label={__ui(label("删除"))} disabled={columns.length === 1} onClick={() => setColumns((rows) => rows.filter((r) => r.key !== c.key))}>
                          <Trash2 size={14}/>
                        </button>
                      </div>
                    </td>
                  </tr>);
        }))}
            </tbody>
          </table>
        </div>
      </Form>
    </Modal>);
}
