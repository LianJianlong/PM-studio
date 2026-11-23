import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeTableRows,
  orderedTableRows,
  tableStatistics,
} from "../shared/table-statistics.ts";
import { aggregateReportValues } from "../shared/report-aggregate.ts";
import {
  calendarTemplate,
  validateCalendar,
} from "../shared/project-calendar.ts";
import { calendarCapacity } from "../shared/resource-values.ts";
test("financial table sums and extrema remain exact and exclude empty cells", () => {
  const c = [{ id: "amount", name: "金额", type: "decimal" }],
    r = ["0.10", "0.20", null].map((amount) => ({ data: { amount } }));
  assert.deepEqual(summarizeTableRows(r, c), [
    {
      id: "amount",
      name: "金额",
      sum: "0.30",
      min: "0.10",
      max: "0.20",
      invalidCount: 0,
    },
  ]);
  const large = [
    { data: { amount: "9007199254740993.01" } },
    { data: { amount: "0.09" } },
  ];
  assert.equal(summarizeTableRows(large, c)[0].sum, "9007199254740993.10");
});
test("numeric ascending sorts negative and different-scale decimals correctly", () => {
  const rows = ["1.12", "1.2", "-10", "-2"].map((amount) => ({
    data: { amount },
  }));
  assert.deepEqual(
    orderedTableRows(
      rows,
      [{ id: "amount", type: "number" }],
      [],
      "amount",
    ).map((r) => r.data.amount),
    ["-10", "-2", "1.12", "1.2"],
  );
});
test("group statistics cover all filtered rows and not the current page", () => {
  const r = Array.from({ length: 51 }, () => ({
      data: { category: "A", amount: "1.00" },
    })),
    c = [{ id: "amount", name: "金额", type: "decimal" }];
  const one = tableStatistics(r, c, ["category"], r.slice(0, 50)),
    two = tableStatistics(r, c, ["category"], r.slice(50));
  assert.equal(one.summary.columns[0].sum, "51.00");
  assert.equal(two.summary.columns[0].sum, "51.00");
  assert.equal(two.groupSummaries[0].count, 51);
});
test("formula failures cannot silently produce financial totals", () => {
  assert.throws(
    () => aggregateReportValues(["1", "#ERROR:DIVIDE_BY_ZERO"], "sum"),
    /公式/,
  );
  assert.throws(
    () => aggregateReportValues(["#ERROR:FORMULA"], "count"),
    /公式/,
  );
  const r = summarizeTableRows(
    [{ data: { f: "#ERROR:DIVIDE_BY_ZERO" } }],
    [{ id: "f", name: "公式", type: "formula" }],
  )[0];
  assert.equal(r.invalidCount, 1);
  assert.equal(r.sum, null);
});
test("calendar conversions reject sub-minute coefficients before capacity division", () => {
  const c = calendarTemplate("five");
  c.hours_per_day = 1e-12;
  assert.throws(() => validateCalendar(c), /整数小时/);
  assert.throws(() => calendarCapacity("1.0000", 480, 1e-12), /换算/);
});
