import { numericTypes, decimalParts } from "./fields.ts";
import { aggregateReportValues } from "./report-aggregate.ts";
export function compareTableValues(a: unknown, b: unknown, type: string) {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) ? (empty(b) ? 0 : 1) : -1;
  if (numericTypes.includes(type) || type === "formula") {
    try {
      const l = decimalParts(String(a)),
        r = decimalParts(String(b)),
        scale = Math.max(l.scale, r.scale),
        x = l.coefficient * 10n ** BigInt(scale - l.scale),
        y = r.coefficient * 10n ** BigInt(scale - r.scale);
      return x < y ? -1 : x > y ? 1 : 0;
    } catch {}
  }
  return String(a).localeCompare(String(b), "zh-CN", { numeric: true });
}
export function tableGroupKey(row: any, groups: string[]) {
  return JSON.stringify(groups.map((id) => String(row.data[id] ?? "未填写")));
}
export function summarizeTableRows(rows: any[], columns: any[]) {
  return columns
    .filter((f) => numericTypes.includes(f.type) || f.type === "formula")
    .map((f) => {
      const values = rows
        .map((r) => r.data[f.id])
        .filter((v) => v !== null && v !== undefined && v !== "");
      const invalidCount = values.filter(
        (v) => !/^[-+]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(v)),
      ).length;
      if (invalidCount)
        return {
          id: f.id,
          name: f.name,
          sum: null,
          min: null,
          max: null,
          invalidCount,
          message: "存在错误或非数值结果，请修正后统计",
        };
      return {
        id: f.id,
        name: f.name,
        sum: aggregateReportValues(values, "sum"),
        min: values.length ? aggregateReportValues(values, "min") : null,
        max: values.length ? aggregateReportValues(values, "max") : null,
        invalidCount: 0,
      };
    });
}
export function orderedTableRows(
  rows: any[],
  columns: any[],
  groups: string[],
  sort?: string,
  direction = 1,
) {
  const field = (id: string) => columns.find((f) => f.id === id);
  return [...rows].sort((a, b) => {
    for (const id of groups) {
      const c = compareTableValues(a.data[id], b.data[id], field(id).type);
      if (c) return c;
    }
    return sort
      ? compareTableValues(a.data[sort], b.data[sort], field(sort).type) *
          direction
      : 0;
  });
}
export function tableStatistics(
  rows: any[],
  columns: any[],
  groups: string[],
  pageRows: any[],
) {
  const wanted = new Set(pageRows.map((r) => tableGroupKey(r, groups))),
    byGroup = new Map<string, any[]>();
  if (groups.length)
    for (const r of rows) {
      const key = tableGroupKey(r, groups);
      if (!wanted.has(key)) continue;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(r);
    }
  return {
    summary: {
      scope: "filtered",
      count: rows.length,
      columns: summarizeTableRows(rows, columns),
    },
    groupSummaries: [...byGroup].map(([key, items]) => ({
      key,
      count: items.length,
      columns: summarizeTableRows(items, columns),
    })),
  };
}
