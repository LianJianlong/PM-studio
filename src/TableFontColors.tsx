import {saveSyncedPreference} from './view-preference-sync';
import {tableHeadingTools} from "./table-heading-tools";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Palette } from "lucide-react";
import { Modal, Field, ErrorBox } from "./lib";
import { translateUiValue as ui } from "./i18n";
import "./table-font-colors.css";

type Settings = { all?: string; columns?: Record<string, string> };
const valid = (value: unknown): value is string =>
  typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value);
const palette = [
  "#20334c",
  "#dc2626",
  "#ea580c",
  "#a16207",
  "#15803d",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#be185d",
  "#64748b",
];
function headers(table: HTMLTableElement) {
  return Array.from(table.tHead?.rows[0]?.cells || []).map((cell, index) => ({
    key: cell.dataset.styleColumn || `${index}:${cell.textContent?.trim()}`,
    name: cell.textContent?.trim() || String(index + 1),
  }));
}
function identity(table: HTMLTableElement) {
  return (
    table.dataset.styleKey ||
    [
      table.closest("section")?.querySelector("h1,h2,h3")?.textContent || "",
      headers(table)
        .map((h) => h.name)
        .join("|"),
    ].join(":")
  );
}
function read(key: string): Settings {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      all: valid(value?.all) ? value.all : undefined,
      columns: Object.fromEntries(
        Object.entries(value?.columns || {}).filter(([key, value]) =>
          valid(value),
        ),
      ) as Record<string, string>,
    };
  } catch {
    return {};
  }
}
let nextFontTable = 0;
function apply(
  table: HTMLTableElement,
  settings: Settings,
  sheets: Map<HTMLTableElement, HTMLStyleElement>,
) {
  const cols = headers(table),
    all = valid(settings.all) ? settings.all : null;
  const selected = cols
    .map((h, index) => ({ index, color: settings.columns?.[h.key] }))
    .filter((item) => valid(item.color));
  let sheet = sheets.get(table);
  if (!all && !selected.length) {
    sheet?.remove();
    sheets.delete(table);
    delete table.dataset.personalFontTable;
    return;
  }
  if (!sheet) {
    sheet = document.createElement("style");
    document.head.append(sheet);
    sheets.set(table, sheet);
    table.dataset.personalFontTable = "font" + ++nextFontTable;
  }
  const cells = `table[data-personal-font-table="${table.dataset.personalFontTable}"] > :is(thead,tbody,tfoot) > tr > :is(td,th):not(.plan-critical-name):not(.plan-near-critical-name)`;
  const css =
    (all ? `${cells}{color:${all}}` : "") +
    selected
      .map(
        (item) => `${cells}:nth-child(${item.index + 1}){color:${item.color}}`,
      )
      .join("");
  if (sheet.textContent !== css) sheet.textContent = css;
}
export default function TableFontColors({
  scope,
  page,
}: {
  scope: string;
  page: string;
}) {
  const [tables, setTables] = useState<{table:HTMLTableElement;host:HTMLElement}[]>([]),
    [editing, setEditing] = useState<HTMLTableElement | null>(null),
    [target, setTarget] = useState("all"),
    [color, setColor] = useState("#2563eb"),
    [error, setError] = useState("");
  const store = useRef(new Map<string, Settings>()),
    sheets = useRef(new Map<HTMLTableElement, HTMLStyleElement>());
  const key = (table: HTMLTableElement) =>
    `project-studio:table-font:v1:${scope}:${table.dataset.styleKey || page + ":" + identity(table)}`;
  const settings = (table: HTMLTableElement) => {
    const k = key(table);
    if (!store.current.has(k)) store.current.set(k, read(k));
    return store.current.get(k)!;
  };
  useEffect(() => {
    let frame = 0;
    const scan = () => {
      const next = Array.from(
        document.querySelectorAll<HTMLTableElement>("main table,.modal table"),
      ).filter(table=>!table.closest('.word-tool'));
      const targets=next.filter(table=>!table.closest('.ai-answer')).map(table=>({table,host:tableHeadingTools(table)}));
      setTables(previous=>targets.length===previous.length&&targets.every((target,i)=>target.table===previous[i].table&&target.host===previous[i].host)?previous:targets);
      for (const [table, sheet] of sheets.current)
        if (!next.includes(table)) {
          sheet.remove();
          sheets.current.delete(table);
          delete table.dataset.personalFontTable;
        }
      for (const table of next) apply(table, settings(table), sheets.current);
    };
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    };
    scan();
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const [table, sheet] of sheets.current) {
        sheet.remove();
        delete table.dataset.personalFontTable;
      }
      sheets.current.clear();
    };
  }, [scope]);
  function save(reset = false, all = false) {
    if (!editing) return;
    const old = settings(editing);
    const next: Settings = all ? {} : { ...old, columns: { ...old.columns } };
    if (!all) {
      if (target === "all") {
        if (reset) delete next.all;
        else next.all = color;
      } else if (reset) delete next.columns![target];
      else next.columns![target] = color;
    }
    try {
      saveSyncedPreference(key(editing), next);
      store.current.set(key(editing), next);
      apply(editing, next, sheets.current);
      setEditing(null);
    } catch {
      setError(ui("无法保存字体颜色，请检查浏览器存储空间。"));
    }
  }
  return (
    <>
      {tables.map(({table,host}, index) => {
        if (!host) return null;
        return createPortal(
          <div className="table-font-control">
            <button
              type="button"
              aria-label={ui("设置表格字体颜色")}
              title={ui("设置表格字体颜色")}
              onClick={() => {
                setError("");
                setTarget("all");
                setColor(settings(table).all || "#2563eb");
                setEditing(table);
              }}
            >
              <Palette size={15} />
            </button>
          </div>,
          host,
          "font-" + index,
        );
      })}
      {editing && (
        <Modal title={ui("字体颜色")} onClose={() => setEditing(null)}>
          <p className="help">
            {ui(
              "仅保存到当前浏览器的个人表格视图，不改变数据或其他用户的显示。关键作业名称优先显示红色。",
            )}
          </p>
          <Field label={ui("应用范围")}>
            <select
              aria-label={ui("应用范围")}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setColor(
                  (e.target.value === "all"
                    ? settings(editing).all
                    : settings(editing).columns?.[e.target.value]) ||
                    settings(editing).all ||
                    "#2563eb",
                );
              }}
            >
              <option value="all">{ui("整张表")}</option>
              {headers(editing).map((h) => (
                <option key={h.key} value={h.key}>
                  {ui("列")}：{h.name}
                </option>
              ))}
            </select>
          </Field>
          <div
            className="font-color-swatches"
            role="group"
            aria-label={ui("常用字体颜色")}
          >
            {palette.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={value}
                aria-pressed={color === value}
                style={{ backgroundColor: value }}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
          <Field label={ui("自定义颜色")}>
            <input
              type="color"
              aria-label={ui("自定义颜色")}
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <span>{color}</span>
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="form-actions">
            <button onClick={() => save(true, true)}>
              {ui("清除本表配色")}
            </button>
            <button onClick={() => save(true)}>{ui("恢复默认颜色")}</button>
            <button className="primary" onClick={() => save()}>
              {ui("应用颜色")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
