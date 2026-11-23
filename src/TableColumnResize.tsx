import {saveSyncedPreference} from './view-preference-sync';
import { useEffect } from "react";
import "./table-column-resize.css";
type Saved = Record<string, number>;
type Layout = {
  table: HTMLTableElement;
  keys: string[];
  widths: number[];
  group: HTMLTableColElement;
  oldWidth: string;
  oldLayout: string;
};
const clamp = (value: number) =>
  Math.max(48, Math.min(1600, Math.round(value)));
const heads = (table: HTMLTableElement) =>
  Array.from(table.tHead?.rows[0]?.cells || []);
const colKey = (cell: HTMLTableCellElement, index: number) =>
  cell.dataset.styleColumn || `${index}:${cell.textContent?.trim() || ""}`;
export default function TableColumnResize({
  scope,
  page,
}: {
  scope: string;
  page: string;
}) {
  useEffect(() => {
    const layouts = new Map<HTMLTableElement, Layout>();
    let hovered: HTMLTableCellElement | null = null,
      drag: {
        layout: Layout;
        index: number;
        x: number;
        start: number[];
        pointer: number;
      } | null = null,
      frame = 0,
      suppressUntil = 0;
    const key = (table: HTMLTableElement) =>
      `project-studio:column-widths:v1:${scope}:${
        table.dataset.styleKey ||
        page +
          ":" +
          (table.closest("section")?.querySelector("h1,h2,h3")?.textContent ||
            "") +
          ":" +
          heads(table)
            .map((c, i) => colKey(c, i))
            .join("|")
      }`;
    const read = (table: HTMLTableElement): Saved => {
      try {
        const data = JSON.parse(localStorage.getItem(key(table)) || "{}");
        return Object.fromEntries(
          Object.entries(data).filter(
            ([k, v]) =>
              typeof v === "number" &&
              Number.isFinite(v) &&
              v >= 48 &&
              v <= 1600,
          ),
        ) as Saved;
      } catch {
        return {};
      }
    };
    const paint = (layout: Layout) => {
      if (layout.group.children.length !== layout.widths.length)
        layout.group.replaceChildren(
          ...layout.widths.map(() => document.createElement("col")),
        );
      layout.widths.forEach((width, i) => {
        const col = layout.group.children[i] as HTMLTableColElement;
        if (col.style.width !== width + "px") col.style.width = width + "px";
      });
      layout.table.style.width =
        layout.widths.reduce((sum, width) => sum + width, 0) + "px";
      layout.table.style.tableLayout = "fixed";
      layout.table.dataset.resizableTable = "true";
    };
    const activate = (table: HTMLTableElement, saved: Saved = {}) => {
      const cells = heads(table);
      if (!cells.length || table.tHead?.rows.length !== 1 || cells.some((c) => c.colSpan !== 1)) return null;
      const existing = layouts.get(table),
        keys = cells.map(colKey);
      if (existing && keys.join("|") === existing.keys.join("|"))
        return existing;
      const widths = cells.map(
        (cell, i) =>
          saved[keys[i]] ||
          existing?.widths[existing.keys.indexOf(keys[i])] ||
          clamp(cell.getBoundingClientRect().width),
      );
      const group = existing?.group || document.createElement("colgroup");
      group.dataset.columnResize = "true";
      if (!existing) table.prepend(group);
      const value = {
        table,
        keys,
        widths,
        group,
        oldWidth: existing?.oldWidth ?? table.style.width,
        oldLayout: existing?.oldLayout ?? table.style.tableLayout,
      };
      layouts.set(table, value);
      paint(value);
      return value;
    };
    const scan = () => {
      for (const [table, layout] of layouts)
        if (!table.isConnected) {
          layout.group.remove();
          table.style.width = layout.oldWidth;
          table.style.tableLayout = layout.oldLayout;
          delete table.dataset.resizableTable;
          layouts.delete(table);
        }
      for (const table of document.querySelectorAll<HTMLTableElement>(
        "main table,.modal table",
      )) {
        if (table.closest(".word-tool")||table.querySelector("colgroup:not([data-column-resize])")) continue;
        const old = layouts.get(table);
        if (old) {
          if (heads(table).map(colKey).join("|") !== old.keys.join("|"))
            activate(table, read(table));
        } else {
          const saved = read(table);
          if (table.hasAttribute("data-stable-grid") || Object.keys(saved).length) activate(table, saved);
        }
      }
    };
    const queue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    };
    scan();
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    const boundary = (event: PointerEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLTableCellElement>("th")
          : null;
      if (!target || target.closest(".word-tool") || !target.closest("main,.modal") || target.colSpan !== 1)
        return null;
      const table = target.closest("table");
      if (
        !table?.tHead?.contains(target) ||
        table.tHead.rows.length !== 1 ||
        target.parentElement !== table.tHead.rows[0] ||
        table.querySelector("colgroup:not([data-column-resize])")
      )
        return null;
      const rect = target.getBoundingClientRect();
      if (Math.abs(event.clientX - rect.right) <= 5) return target;
      if (
        Math.abs(event.clientX - rect.left) <= 5 &&
        target.previousElementSibling instanceof HTMLTableCellElement
      )
        return target.previousElementSibling;
      return null;
    };
    const hover = (cell: HTMLTableCellElement | null) => {
      if (hovered === cell) return;
      hovered?.classList.remove("column-resize-hover");
      hovered = cell;
      hovered?.classList.add("column-resize-hover");
    };
    const move = (event: PointerEvent) => {
      if (drag) {
        if (event.pointerId !== drag.pointer) return;
        event.preventDefault();
        drag.layout.widths[drag.index] = clamp(
          drag.start[drag.index] + event.clientX - drag.x,
        );
        paint(drag.layout);
      } else hover(boundary(event));
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const cell = boundary(event);
      if (!cell) return;
      const table = cell.closest("table")!,
        layout = activate(table, read(table));
      if (!layout) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = {
        layout,
        index: cell.cellIndex,
        x: event.clientX,
        start: [...layout.widths],
        pointer: event.pointerId,
      };
      document.body.classList.add("column-resize-active");
    };
    const finish = (cancel = false) => {
      if (!drag) return;
      const { layout, start } = drag;
      if (cancel) {
        layout.widths = start;
        paint(layout);
      } else {
        try {
          saveSyncedPreference(key(layout.table),Object.fromEntries(layout.keys.map((k,i)=>[k,layout.widths[i]])));
        } catch {
          /* The resize remains usable for this open view. */
        }
      }
      drag = null;
      suppressUntil = Date.now() + 200;
      document.body.classList.remove("column-resize-active");
      hover(null);
    };
    const up = () => finish(),
      cancel = () => finish(true),
      escape = (e: KeyboardEvent) => {
        if (e.key === "Escape" && drag) {
          e.preventDefault();
          e.stopImmediatePropagation();
          finish(true);
        }
      };
    const click = (e: MouseEvent) => {
      if (Date.now() < suppressUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressUntil = 0;
      }
    };
    const nativeDrag = (e: DragEvent) => {
      if (drag) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointerdown", start, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("click", click, true);
    document.addEventListener("dragstart", nativeDrag, true);
    window.addEventListener("blur", cancel);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      hover(null);
      document.body.classList.remove("column-resize-active");
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerdown", start, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("dragstart", nativeDrag, true);
      window.removeEventListener("blur", cancel);
      for (const value of layouts.values()) {
        value.group.remove();
        value.table.style.width = value.oldWidth;
        value.table.style.tableLayout = value.oldLayout;
        delete value.table.dataset.resizableTable;
      }
    };
  }, [scope, page]);
  return null;
}
