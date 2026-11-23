import PhotoEditor from "./PhotoEditor";
import { translateUiValue as __ui } from "./i18n";
import FormulaBuilder from "./FormulaBuilder";
import { useState } from "react";
import { Field, useApi, useApp } from "./lib";
import ReferencePicker from "./ReferencePicker";
import { typeLabels, fieldTypes, integerTypes, displayValue, type DataField, type FieldType, isSystemField, choiceTypes, isReference, } from "../shared/fields";
export function fieldOptions(form: FormData) {
    const type = String(form.get("type"));
    if(type==="text"&&form.get("image_upload")==="on")return {image_upload:true};
    if(type==='text' && form.get('auto_code')==='on') return {auto_code:true,code_prefix:String(form.get('code_prefix')||''),code_start:String(form.get('code_start')||'1'),code_step:String(form.get('code_step')||'1'),code_width:Number(form.get('code_width')||3),code_fill_gaps:form.get('code_fill_gaps')==='on'};
    if(integerTypes.includes(type)) return {auto_increment:form.get("auto_increment")==="on",...(form.get("auto_increment")==="on"?{auto_increment_step:String(form.get("auto_increment_step")||"1"),auto_increment_start:String(form.get("auto_increment_start")||"1")}:{})};
    if (type === "reference")
        return {
            target_table: form.get("target_table"),
            display_column: form.get("display_column") || undefined,
            bidirectional: form.get("bidirectional") === "on",
            ...(form.get("bidirectional") === "on" && form.get("inverse_name")
                ? { inverse_name: form.get("inverse_name") }
                : {}),
        };
    return type === "decimal"
        ? {
            precision: Number(form.get("precision")),
            scale: Number(form.get("scale")),
        }
        : choiceTypes.includes(type)
            ? {
                options: String(form.get("options") || "")
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
            }
            : type === "formula"
                ? { formula: String(form.get("formula") || "").trim() }
                : {};
}
export function FieldTypeOptions({ fields = [], projectId, initial, }: {
    fields?: DataField[];
    projectId?: string;
    initial?: DataField;
} = {}) {
    const [type, setType] = useState<FieldType>(initial?.type || "text");
    const [autoIncrement,setAutoIncrement]=useState(!!initial?.auto_increment);
    const [autoCode,setAutoCode]=useState(!!initial?.auto_code);
    const [formula, setFormula] = useState(initial?.formula || "");
    const { project, tick } = useApp();
    const [target, setTarget] = useState(initial?.target_table || "");
    const { data: tables, error } = useApi<any[]>(type === "reference" && project
        ? `/projects/${projectId || project.id}/tables`
        : null, tick);
    const targetTable = tables?.find((t) => t.id === target);
    return (<>
      <Field label={__ui("数据类型")}>
        <select name="type" aria-label={__ui("数据类型")} value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {__ui(fieldTypes
            .filter((t) => t !== "backlink" && (!initial || t !== "reference"))
            .map((t) => (<option key={t} value={t}>
                {__ui(typeLabels[t])}
              </option>)))}
        </select>
      </Field>
      <section className="type-browser" aria-label={__ui("鼠标选择数据类型")}>
        <p className="help">{__ui("点击选择类型 · 当前：")}{__ui(typeLabels[type])}</p>
        <div className="type-picker">
          {__ui(fieldTypes
            .filter((t) => t !== "backlink" && (!initial || t !== "reference"))
            .map((t) => (<button type="button" aria-pressed={type === t} className={type === t ? "active" : ""} key={t} onClick={() => setType(t)}>
                {__ui(typeLabels[t])}
              </button>)))}
        </div>
      </section>
      {__ui(type === "reference" && (<>
          <Field label={__ui("关联数据表")}>
            <select name="target_table" required value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{__ui("选择同项目数据表")}</option>
              {__ui(tables?.map((t) => (<option key={t.id} value={t.id} disabled={t.lifecycle !== "active"}>
                  {t.department_name} · {t.name}
                </option>)))}
            </select>
          </Field>
          <Field label={__ui("记录显示字段")}>
            <select name="display_column" key={target} defaultValue={initial?.display_column || ""}>
              <option value="">{__ui("显示记录ID")}</option>
              {__ui(targetTable?.columns
                .filter((f: DataField) => !isReference(f))
                .map((f: DataField) => (<option key={f.id} value={f.id}>
                    {f.name}
                  </option>)))}
            </select>
          </Field>
          <label className="checkbox-label">
            <input type="checkbox" name="bidirectional" defaultChecked={initial?.bidirectional}/>{__ui("双向引用（自动在目标表建立反向列）")}</label>
          <Field label={__ui("反向列名称（双向时使用，可留空）")}>
            <input name="inverse_name" maxLength={120} defaultValue={initial?.inverse_name}/>
          </Field>
          <p className="help">{__ui("关联同项目内的数据记录，支持从两侧维护双向关系。源记录已审核或待审核时，仍需按原审批规则处理。")}</p>
          {__ui(error && <p role="alert">{__ui(error)}</p>)}
        </>))}
      {integerTypes.includes(type)&&<section className="form-grid"><label className="checkbox-label"><input type="checkbox" name="auto_increment" checked={autoIncrement} onChange={e=>setAutoIncrement(e.target.checked)}/>{__ui("自增")}</label>{autoIncrement&&<><Field label={__ui("起始值")}><input aria-label={__ui("起始值")} name="auto_increment_start" inputMode="numeric" pattern="-?[0-9]+" required defaultValue={initial?.auto_increment_start||"1"}/></Field><Field label={__ui("自增间隔")}><input aria-label={__ui("自增间隔")} name="auto_increment_step" inputMode="numeric" pattern="[1-9][0-9]*" required defaultValue={initial?.auto_increment_step||"1"}/><small>{__ui("从起始值或已用最大值继续递增，由系统生成，不需手工填写。")}</small></Field></>}</section>}
      {type==='text'&&<label className="checkbox-label"><input type="checkbox" name="image_upload" defaultChecked={initial?.image_upload} disabled={autoCode}/>{__ui('照片上传（单元格内上传及预览）')}</label>}
      {type==='text'&&<section className="form-grid"><label className="checkbox-label"><input type="checkbox" name="auto_code" checked={autoCode} onChange={e=>setAutoCode(e.target.checked)}/>{__ui('组合编码自动生成')}</label>{autoCode&&<><Field label={__ui('编码前缀')}><input name="code_prefix" maxLength={20} pattern="[A-Za-z0-9._-]*" defaultValue={initial?.code_prefix||''} placeholder="WBS-"/></Field><Field label={__ui('起始数字')}><input name="code_start" inputMode="numeric" pattern="[1-9][0-9]{0,11}" required defaultValue={initial?.code_start||'1'}/></Field><Field label={__ui('自增间隔')}><input name="code_step" inputMode="numeric" pattern="[1-9][0-9]{0,6}" required defaultValue={initial?.code_step||'1'}/></Field><Field label={__ui('数字最少位数')}><input name="code_width" type="number" min={1} max={12} required defaultValue={initial?.code_width||3}/></Field><label className="checkbox-label"><input name="code_fill_gaps" type="checkbox" defaultChecked={initial?.code_fill_gaps||false}/>{__ui('优先填补未使用的空号')}</label><small>{__ui('留空时自动生成；也可手工输入或插入自定义编码，例如WBS-001A。编码仅在当前表内递增。')}</small></>}</section>}
      {__ui(type === "decimal" && (<div className="form-grid">
          <Field label={__ui("总有效位数（1–1000）")}>
            <input name="precision" type="number" min={1} max={1000} required defaultValue={initial?.precision ?? 38}/>
          </Field>
          <Field label={__ui("小数位数（不大于总位数）")}>
            <input name="scale" type="number" min={0} max={1000} required defaultValue={initial?.scale ?? 2}/>
          </Field>
        </div>))}
      {__ui(choiceTypes.includes(type) && (<Field label={__ui("选项（每行一个，不重复）")}>
          <textarea name="options" required rows={5} placeholder={__ui("待处理\n处理中\n已完成")} defaultValue={initial?.options?.join("\n")}/>
        </Field>))}
      {__ui(type === "formula" && (<FormulaBuilder fields={fields} value={formula} onChange={setFormula}/>))}
      {__ui(["int64", "uint64", "decimal"].includes(type) && (<p className="help">{__ui("精确存储和统计；导入Excel时请将此列设置为文本。超范围或超小数位会拒绝保存，不自动舍入。")}</p>))}
      {__ui(["json", "array"].includes(type) && (<p className="help">{__ui("使用标准JSON，最多64KB、32层；大整数放在引号内，避免JSON数值精度损失。")}</p>))}
      {__ui(type === "timestamptz" && (<p className="help">{__ui("录入必须带Z或±HH:mm时区，统一保存UTC，保留最多6位小数秒。")}</p>))}
      {__ui(type === "binary" && (<p className="help">{__ui("使用Base64字符串，最多64KB。文件上传与版本管理另设专用模块。")}</p>))}
      {__ui(isSystemField({ type }) && (<p className="help">{__ui("由服务器记录时间或操作人ID；无需填写，不能导入覆盖。新增到已有表时可读取历史创建信息，历史修改人未知则留空。")}</p>))}
      {((!initial&&!isSystemField({type}))||(initial&&initial.type!=='formula'&&type==='formula'))&&<>
        <label className="checkbox-label"><input name="preserve_existing" type="checkbox" defaultChecked/>{__ui('已有记录不影响')}</label>
        {initial&&<p className="help">{__ui('保留旧行原值，公式只计算之后新增的记录。')}</p>}
      </>}
      {__ui(!isSystemField({ type }) && (<label className="checkbox-label">
          <input name="required" type="checkbox" defaultChecked={initial?.required}/>{__ui("必填")}</label>))}
    </>);
}
export function ValueEditor({ field, value, tableId, reference, }: {
    field: DataField;
    value: unknown;
    tableId?: string;
    reference?: any;
}) {
    const disabled = !!field.lifecycle && field.lifecycle !== "active";
    const props = { name: field.id, disabled, required: field.required, "aria-label": field.name };
    if(field.image_upload)return <PhotoEditor field={field} value={value} disabled={disabled}/>;
    if(field.auto_increment)return <input disabled readOnly aria-label={field.name} value={value===null||value===undefined?"":String(value)} placeholder={__ui("保存后自动生成")}/>;
    if (isReference(field))
        return (<ReferencePicker field={field} tableId={tableId!} value={value} reference={reference} disabled={disabled}/>);
    if (isSystemField(field) || field.type === "formula")
        return (<input disabled value={displayValue(value) ||
                (field.type === "formula" ? "保存后计算" : "保存后由系统生成")} readOnly/>);
    if (field.type === "multi_select")
        return (<fieldset className="choice-options" disabled={disabled} aria-label={field.name}>
        <legend>{__ui(field.required ? "至少选择一项" : "可选择多项")}</legend>
        {__ui(field.options?.map((option) => (<label className="checkbox-label" key={option}>
            <input type="checkbox" name={field.id} value={option} defaultChecked={Array.isArray(value) && value.includes(option)}/>
            {__ui(option)}
          </label>)))}
      </fieldset>);
    if (field.type === "boolean")
        return (<select {...props} defaultValue={value === null || value === undefined ? "" : String(value)}>
        <option value="">{__ui("请选择")}</option>
        <option value="true">{__ui("是")}</option>
        <option value="false">{__ui("否")}</option>
      </select>);
    if (field.type === "enum" || field.type === "single_select")
        return (<select {...props} defaultValue={String(value ?? "")}>
        <option value="">{__ui("请选择")}</option>
        {__ui(field.options?.map((s) => (<option key={s} value={s}>
            {__ui(s)}
          </option>)))}
      </select>);
    if (["json", "array", "binary"].includes(field.type))
        return (<textarea {...props} rows={4} defaultValue={displayValue(value)} placeholder={__ui(field.type === "array"
                ? '["条目1", "条目2"]'
                : field.type === "json"
                    ? '{"key":"value"}'
                    : "Base64内容")}/>);
    const type = field.type === "date"
        ? "date"
        : field.type === "time"
            ? "time"
            : field.type === "timestamp"
                ? "datetime-local"
                : [
                    "number",
                    "float32",
                    "float64",
                    "int8",
                    "int16",
                    "int24",
                    "int32",
                ].includes(field.type)
                    ? "number"
                    : "text";
    return (<input {...props} required={field.auto_code?false:props.required} type={type} step={type === "number" || type === "time" || type === "datetime-local"
            ? "any"
            : undefined} defaultValue={String(value ?? "")} placeholder={__ui(field.type === "timestamptz"
            ? "2026-09-23T15:30:00.123456+08:00"
            : field.type === "decimal"
                ? `精确小数 · ${field.precision ?? 38}位/${field.scale ?? 2}小数`
                : field.auto_code ? '留空自动生成，或输入自定义编码' : undefined)}/>);
}
