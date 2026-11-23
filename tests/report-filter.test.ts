import test from "node:test";
import assert from "node:assert/strict";
import { matchesReportFilters } from "../shared/report-filter.ts";

test("report field and date filters combine inclusively without matching empty dates", () => {
  const values = { work: "海堤浇筑", day: "2026-09-18", empty: "" };
  assert.equal(matchesReportFilters(values, "2026-09-20T02:00:00Z", { filterField: "work", filterOperator: "contains", filterValue: "浇筑", dateField: "day", dateFrom: "2026-09-18", dateTo: "2026-09-18" }), true);
  assert.equal(matchesReportFilters(values, "2026-09-20T02:00:00Z", { filterField: "work", filterOperator: "equals", filterValue: "海堤", dateField: "day", dateFrom: "2026-09-18" }), false);
  assert.equal(matchesReportFilters(values, "2026-09-20T02:00:00Z", { dateField: "empty", dateFrom: "2026-09-01" }), false);
  assert.equal(matchesReportFilters(values, "2026-09-20T02:00:00Z", { dateField: "__created_date__", dateFrom: "2026-09-19", dateTo: "2026-09-20" }), true);
});
