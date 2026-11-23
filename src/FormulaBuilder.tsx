import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, useRef, useEffect } from "react";
import { Field,useApi,useApp } from "./lib";
import { typeLabels } from "../shared/fields";
import { compileFormula, tryEvaluateFormula } from "../shared/formulas";
import type { DataField } from "../shared/fields";
const functions = [
    ["SUM", "求和", "SUM()"],
    ["AVG", "平均值", "AVG()"],
    ["ROUND", "四舍五入", "ROUND(, 2)"],
    ["IF", "条件判断", "IF(, , )"],
    ["COALESCE", "空值替代", "COALESCE(, 0)"],
    ["CONCAT", "文本拼接", "CONCAT(, )"],
    ["MIN", "最小值", "MIN()"],
    ["MAX", "最大值", "MAX()"],
    ["LEN", "文本长度", "LEN()"],
    ["ABS", "绝对值", "ABS()"],
    ["FINISHDATE", "按项目日历计算完成日期", "FINISHDATE(, )"],
    ["DATEADD", "日期加减天数", "DATEADD(, )"],
];
export default function FormulaBuilder({ fields = [], value: controlledValue, onChange, inputName = "formula", }: {
    fields?: DataField[];
    value?: string;
    onChange?: (value: string) => void;
    inputName?: string;
}) {
    const [localValue, setLocalValue] = useState(""), [search, setSearch] = useState(""), [samples, setSamples] = useState<Record<string, string>>({});
    const {project,tick}=useApp();
    const {data:calendar,error:calendarError}=useApi(project?.id?`/projects/${project.id}/calendar`:null,tick);
    const input = useRef<HTMLTextAreaElement>(null);
    const value = controlledValue ?? localValue;
    const setValue = (next: string) => {
        setLocalValue(next);
        onChange?.(next);
    };
    function insert(text: string, cursorOffset = text.length) {
        const el = input.current, start = el?.selectionStart ?? value.length, end = el?.selectionEnd ?? start;
        setValue(value.slice(0, start) + text + value.slice(end));
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(start + cursorOffset, start + cursorOffset);
        });
    }
    let message = "请选择字段和运算符，也可以直接编辑表达式。", valid = false, used: string[] = [];
    try {
        const compiled = compileFormula(value, { fields: fields.map((f) => f.id) });
        used = [...compiled.dependencies];
        message = "语法检查通过";
        valid = true;
    }
    catch (e) {
        if (value)
            message = (e as Error).message;
    }
    useEffect(() => {
        input.current?.setCustomValidity(valid || !value ? "" : message);
    }, [valid, value, message]);
    const awaitingSamples=used.some(id=>!samples[id]?.trim());
    const result = valid&&!awaitingSamples&&(!project?.id||calendar?.config)
        ? tryEvaluateFormula(value, Object.fromEntries(used.map((id) => [id, samples[id] || null])), { fields: fields.map((f) => f.id),calendar:calendar?.config })
        : null;
    return (<div className="formula-builder">
      <Field label={__ui("公式表达式")}>
        <textarea ref={input} name={inputName} aria-label={__ui("公式表达式")} value={value} onChange={(e) => setValue(e.target.value)} onBlur={(e) => e.currentTarget.setCustomValidity(valid ? "" : message)} required rows={4} maxLength={4096} placeholder={__ui("点击下方字段、运算符和函数组成公式")}/>
      </Field>
      <div className="formula-readable" aria-label={__ui("公式名称预览")}>
        <strong>{__ui("名称预览")}</strong>
        <code>
          {__ui(value
            ? value.replace(/\[([^\]]+)\]/g, (token, id) => `[${fields.find((f) => f.id === id)?.name || id}]`)
            : "选择下方字段，开始构建公式")}
        </code>
      </div>
      <p className={valid ? "formula-valid" : "help"} aria-live="polite">
        {__ui(message)}
      </p>
      <div className="formula-palette">
        <section>
          <strong>{__ui("同表字段")}</strong>
          <input aria-label={__ui("搜索公式字段")} placeholder={__ui("搜索字段名称")} value={search} onChange={(e) => setSearch(e.target.value)}/>
          <div>
            {__ui(fields
            .filter((f) => f.lifecycle !== "deleted" &&
            `${f.name} ${f.id}`
                .toLowerCase()
                .includes(search.toLowerCase()))
            .map((f) => (<button type="button" key={f.id} title={__ui(`${f.name} · ${f.id} · ${typeLabels[f.type]}`)} onClick={() => insert(`[${f.id}]`)}>
                  {f.name}
                  <small>
                    {__ui(typeLabels[f.type])} · {__ui(f.id)}
                  </small>
                </button>)))}
            {__ui(!fields.length && <p className="help">{__ui("此表尚无可引用字段。")}</p>)}
          </div>
        </section>
        <section>
          <strong>{__ui("运算符与函数")}</strong>
          <div>
            {__ui([
            " + ",
            " - ",
            " * ",
            " / ",
            " = ",
            " > ",
            " < ",
            " AND ",
            " OR ",
            "(",
            ")",
            ",",
            ".",
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
        ].map((s) => (<button type="button" key={s} onClick={() => insert(s)}>
                {__ui(s.trim())}
              </button>)))}
          </div>
          <div>
            {__ui(functions.map(([key, label, template]) => (<button type="button" key={key} title={__ui(`${key} · ${template}`)} onClick={() => insert(template, template.indexOf("(") + 1)}>
                {__ui(label)}
                <small>{__ui(key)}</small>
              </button>)))}
          </div>
          <button type="button" onClick={() => setValue("")}>{__ui("清空表达式")}</button>
        </section>
      </div>
      {__ui(used.length > 0 && (<details open>
          <summary>{__ui("试算（仅预览，不写入数据）")}</summary>
          <div className="form-grid">
            {used.map(id=>{const field=fields.find(f=>f.id===id);return <Field key={id} label={field?.name||id}>
                <input type={field?.type==='date'?'date':field?.type==='timestamp'?'datetime-local':'text'} placeholder={field?.type==='timestamptz'?'2026-11-09T08:00:00+02:00':undefined} aria-label={__uiFormat("试算 {0}", [id])} value={samples[id]||""} onChange={e=>setSamples(v=>({...v,[id]:e.target.value}))}/>
              </Field>})}
          </div>
          <p aria-live="polite">{__ui("结果：")}{__ui(result?.ok
                ? String(result.value ?? "空值")
                : result
                    ? result.error.message
                    : awaitingSamples?"请先填写试算示例值":calendarError?"无法读取项目日历":"—")}
          </p>
          <p className="help">{__ui("完成日期可用 FINISHDATE([开始时间], [工期])，起始工作日计为第 1 天。DATEADD 按自然日加减。")}</p>
        </details>))}
      <p className="help">{__ui("引用以字段标识保存，显示名称可调整。试算字符串用于数值与文本；正式计算仍由服务器校验，公式列只读。")}</p>
    </div>);
}
