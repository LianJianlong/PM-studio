import { aggregateReportValues, type ReportAggregation } from "./report-aggregate.ts";

export type ReportPivot = {
  rows: string[]; columns: string[]; values: (string | null)[][];
  rowTotals: string[]; columnTotals: string[]; overall: string;
  rowCount: number; columnCount: number;
};
export function aggregateReportPivot(entries: { row: string; column: string; value: unknown }[], aggregation: ReportAggregation, countNonempty = false): ReportPivot {
  const byRow = new Map<string, unknown[]>(), byColumn = new Map<string, unknown[]>(), cells = new Map<string, unknown[]>();
  const add = (map: Map<string, unknown[]>, key: string, value: unknown) => { if (!map.has(key)) map.set(key, []); map.get(key)!.push(value); };
  for (const entry of entries) {
    add(byRow, entry.row, entry.value); add(byColumn, entry.column, entry.value);
    add(cells, JSON.stringify([entry.row, entry.column]), entry.value);
  }
  const calculate = (values: unknown[]) => aggregateReportValues(countNonempty && aggregation === "count" ? values.filter((v) => v !== null && v !== undefined && v !== "") : values, aggregation);
  const rows = [...byRow.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")).slice(0, 30);
  const columns = [...byColumn.keys()].sort((a, b) => a.localeCompare(b, "zh-CN")).slice(0, 30);
  return { rows, columns, values: rows.map((row) => columns.map((column) => { const values = cells.get(JSON.stringify([row, column])); return values ? calculate(values) : null; })),
    rowTotals: rows.map((row) => calculate(byRow.get(row)!)), columnTotals: columns.map((column) => calculate(byColumn.get(column)!)),
    overall: calculate(entries.map((e) => e.value)), rowCount: byRow.size, columnCount: byColumn.size };
}
