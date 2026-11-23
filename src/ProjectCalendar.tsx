import {hourPeriodText as text,parseHourPeriods as parse} from '../shared/calendar-input';
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useState } from "react";
import { api, useApi, useApp, Field, ErrorBox, Loading, useUnsavedChanges, } from "./lib";
import { naturalCalendar, calendarTemplate, calendarHours, calendarPeriods, validateCalendar, type ProjectCalendar as Config, type Period, } from "../shared/project-calendar";
const weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export default function ProjectCalendar() {
    const { project, tick, reload, notify } = useApp(), s = useApi<any>(`/projects/${project.id}/calendar`, tick), [draft, setDraft] = useState<Config | null>(null), [week, setWeek] = useState<string[]>([]), [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)), [selected, setSelected] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const [invalidException,setInvalidException]=useState(false);
    useEffect(()=>setInvalidException(false),[selected,draft?.exceptions]);
    useEffect(() => {
        if (s.data) {
            setDraft(structuredClone(s.data.config));
            setWeek(s.data.config.week.map(text));
        }
    }, [s.data]);
    if (s.error)
        return <ErrorBox message={__ui(s.error)}/>;
    if (!s.data || !draft)
        return <Loading />;
    const write = s.data.can_manage;
    const start = new Date(month + "-01T00:00:00Z"), days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    function template(kind: string) {
        const c = calendarTemplate(kind as "natural" | "five" | "six");
        setDraft(c);
        setWeek(c.week.map(text));
    }
    return (<section className="panel project-calendar">
      <div className="section-heading">
        <h3>{__ui("项目工作日历")}</h3>
        <button className="primary" disabled={!write || busy || invalidException} onClick={async () => {
            setBusy(true);
            setError("");
            try {
                const c = { ...draft!, week: week.map(parse) };
                validateCalendar(c);
                await api(`/projects/${project.id}/calendar`, "PUT", {
                    config: c,
                    version: s.data.version,
                });
                await s.refresh();
                notify("项目日历已保存，排程和资源负荷已更新");
            }
            catch (e) {
                setError((e as Error).message);
            }
            finally {
                setBusy(false);
            }
        }}>
          {__ui(busy ? "保存中" : "保存项目日历")}
        </button>
      </div>
      <p className="help">{__ui("最小时间单位为整小时，不设置分钟；小时换算必须为正整数。项目排程按工作周、整点时段与日期例外计算，非工作时段不计入工期。")}</p>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="calendar-settings-grid">
        <div>
          <Field label={__ui("日历名称")}>
            <input aria-label={__ui("日历名称")} disabled={!write || busy} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/>
          </Field>
          <div className="row-actions">
            {__ui([
            ["natural", "自然日模板"],
            ["five", "五天工作周模板"],
            ["six", "六天工作周模板"],
        ].map(([k, n]) => (<button disabled={!write || busy} key={k} onClick={() => template(k)}>
                {__ui(n)}
              </button>)))}
          </div>
          <h4>{__ui("标准工作周")}</h4>
          <p className="help">{__ui("空白表示非工作日；仅支持整小时，例如8-12; 13-17。")}</p>
          <table className="data-grid">
            <thead>
              <tr>
                <th>{__ui("日期")}</th>
                <th>{__ui("工作时段")}</th>
              </tr>
            </thead>
            <tbody>
              {__ui(weekNames.map((name, i) => (<tr key={i}>
                  <td>{__ui(name)}</td>
                  <td>
                    <input aria-label={__uiFormat("{0}工作时段", [name])} disabled={!write || busy} value={week[i]} onChange={(e) => setWeek((v) => v.map((s, j) => (j === i ? e.target.value : s)))}/>
                  </td>
                </tr>)))}
            </tbody>
          </table>
          <h4>{__ui("时间单位换算")}</h4>
          <p className="help">{__ui("月、年为工期单位换算系数，不是指定月份、年份的实际工时。工作周模板按52周/年，月换算小时按年小时÷12取整；自然日按365日/年。实际工时按下方月份、工作时段及例外日期统计。")}</p>
          <div className="form-grid">
            {__ui([
            ["hours_per_day", "小时/日"],
            ["hours_per_week", "小时/周"],
            ["hours_per_month", "小时/月"],
            ["hours_per_year", "小时/年"],
        ].map(([key, label]) => (<Field key={key} label={__ui(label)}>
                <input aria-label={__ui(label)} disabled={!write || busy} type="number" min={1} max={key==='hours_per_day'?24:key==='hours_per_week'?168:key==='hours_per_month'?744:8784} step="1" value={(draft as any)[key]||''} onChange={(e) => {if(/^\d*$/.test(e.target.value))setDraft({ ...draft, [key]: Number(e.target.value) })}}/>
              </Field>)))}
          </div>
        </div>
        <div>
          <Field label={__ui("例外日期月份")}>
            <input aria-label={__ui("例外日期月份")} type="month" value={month} onChange={(e) => {
            if (e.target.value)
                setMonth(e.target.value);
        }}/>
          </Field>
          <p className="help" aria-label={__ui("实际日历工时")}>
            {__ui((() => {
            try {
                const c = validateCalendar({ ...draft, week: week.map(parse) });
                const year = start.getUTCFullYear();
                const nextMonth = new Date(Date.UTC(year, start.getUTCMonth() + 1, 1))
                    .toISOString()
                    .slice(0, 10);
                return `${month} 实际工时：${calendarHours(c, month + "-01", nextMonth)} 小时；${year} 年实际工时：${calendarHours(c, year + "-01-01", year + 1 + "-01-01")} 小时（含例外日期）`;
            }
            catch {
                return "工作时段有效后显示实际月、年工时";
            }
        })())}
          </p>
          <div className="work-calendar-grid">
            {__ui(weekNames.map((n) => (<strong key={n}>{__ui(n)}</strong>)))}
            {__ui(Array.from({ length: start.getUTCDay() }, (_, i) => (<span key={"empty" + i}/>)))}
            {__ui(Array.from({ length: days }, (_, i) => {
            const date = month + "-" + String(i + 1).padStart(2, "0"), exception = Object.hasOwn(draft.exceptions, date), work = calendarPeriods({
                ...draft,
                week: week.map((s) => {
                    try {
                        return parse(s);
                    }
                    catch {
                        return [];
                    }
                }),
            }, date).length > 0;
            return (<button aria-label={__uiFormat("日历日期 {0}", [date])} key={date} className={`${work ? "workday" : "nonwork"} ${exception ? "exception" : ""} ${selected === date ? "selected" : ""}`} onClick={() => setSelected(date)}>
                  {i + 1}
                </button>);
        }))}
          </div>
          <p className="help">{__ui("浅绿：工作日 · 灰：非工作日 · 橙框：例外日期")}</p>
          {__ui(selected && (<div className="calendar-exception">
              <h4>{__ui(selected)}</h4>
              <div className="row-actions">
                <button disabled={!write || busy} onClick={() => setDraft({
                ...draft,
                exceptions: {
                    ...draft.exceptions,
                    [selected]: [
                        ["08:00", "12:00"],
                        ["13:00", "17:00"],
                    ],
                },
            })}>{__ui("设为工作日")}</button>
                <button disabled={!write || busy} onClick={() => setDraft({
                ...draft,
                exceptions: { ...draft.exceptions, [selected]: [] },
            })}>{__ui("设为非工作日")}</button>
                <button disabled={!write || busy} onClick={() => {
                const exceptions = { ...draft.exceptions };
                delete exceptions[selected];
                setDraft({ ...draft, exceptions });
            }}>{__ui("恢复标准")}</button>
              </div>
              {__ui(Object.hasOwn(draft.exceptions, selected) && (<Field label={__ui("例外工作时段")}>
                  <input aria-label={__ui("例外工作时段")} key={selected + JSON.stringify(draft.exceptions[selected])} disabled={!write || busy} defaultValue={text(draft.exceptions[selected])} onChange={e=>{try{parse(e.target.value);if(invalidException)setError('');setInvalidException(false)}catch(error){setInvalidException(true);setError((error as Error).message)}}} onBlur={(e) => {
                    try {
                        const exceptions = {
                            ...draft.exceptions,
                            [selected]: parse(e.target.value),
                        };
                        setDraft({ ...draft, exceptions });
                    }
                    catch (error) {
                        setInvalidException(true);setError((error as Error).message);
                    }
                }}/>
                </Field>))}
            </div>))}
          <h4>{__ui("已设例外")}</h4>
          <div className="calendar-exception-list">
            {__ui(Object.entries(draft.exceptions)
            .sort()
            .map(([date, p]) => (<button key={date} onClick={() => {
                setMonth(date.slice(0, 7));
                setSelected(date);
            }}>
                  {__ui(date)} · {__ui(p.length ? text(p) : "非工作日")}
                </button>)))}
          </div>
        </div>
      </div>
    </section>);
}
