export type ReportFieldFilter = {
  filterField?: string;
  filterOperator?: "equals" | "contains";
  filterValue?: string;
  dateField?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function matchesReportFilters(
  values: Record<string, unknown>,
  createdAt: string | Date,
  filter: ReportFieldFilter,
): boolean {
  if (filter.filterField && filter.filterValue) {
    const actual = String(values[filter.filterField] ?? "").toLocaleLowerCase().trim();
    const expected = filter.filterValue.toLocaleLowerCase().trim();
    if (filter.filterOperator === "contains" ? !actual.includes(expected) : actual !== expected) return false;
  }
  if (filter.dateFrom || filter.dateTo) {
    const raw = filter.dateField === "__created_date__" || !filter.dateField
      ? createdAt : values[filter.dateField];
    const date = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    if (filter.dateFrom && date < filter.dateFrom) return false;
    if (filter.dateTo && date > filter.dateTo) return false;
  }
  return true;
}
