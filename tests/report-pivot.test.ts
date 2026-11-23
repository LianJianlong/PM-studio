import test from "node:test";
import assert from "node:assert/strict";
import { aggregateReportPivot } from "../shared/report-pivot.ts";
test("pivot preserves exact cells, distinguishes missing cells and computes weighted averages from records", () => {
  const entries = [{ row: "A", column: "1", value: "9007199254740993.1234" }, { row: "A", column: "1", value: "0.0006" }, { row: "B", column: "2", value: "2.5000" }];
  const sum = aggregateReportPivot(entries, "sum");
  assert.deepEqual(sum.values, [["9007199254740993.1240", null], [null, "2.5000"]]);
  assert.equal(sum.overall, "9007199254740995.6240");
  const average = aggregateReportPivot([{ row: "A", column: "1", value: 10 }, { row: "A", column: "1", value: 20 }, { row: "A", column: "2", value: 90 }], "average");
  assert.equal(average.rowTotals[0], "40.0000");
  assert.equal(average.overall, "40.0000");
  assert.equal(aggregateReportPivot([{ row: "A", column: "1", value: null }], "count", true).overall, "0");
});
test("pivot truncation retains full-scope totals and tuple keys cannot collide", () => {
  const entries = Array.from({ length: 31 }, (_, i) => ({ row: `R${i}`, column: `C${i}`, value: 1 }));
  const pivot = aggregateReportPivot(entries, "sum");
  assert.equal(pivot.rows.length, 30); assert.equal(pivot.columns.length, 30);
  assert.equal(pivot.rowCount, 31); assert.equal(pivot.columnCount, 31); assert.equal(pivot.overall, "31");
  const collision = aggregateReportPivot([{ row: "a|b", column: "c", value: 1 }, { row: "a", column: "b|c", value: 2 }], "sum");
  assert.equal(collision.overall, "3");
  assert.equal(collision.values.flat().filter((v) => v !== null).length, 2);
});
