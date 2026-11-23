import test from "node:test";
import assert from "node:assert/strict";
import { aggregateReportValues } from "../shared/report-aggregate.ts";

test("business report aggregation preserves exact decimal and int64 values", () => {
  assert.equal(aggregateReportValues(["9007199254740993", "2"], "sum"), "9007199254740995");
  assert.equal(aggregateReportValues(["1.1001", "2.2002"], "sum"), "3.3003");
  assert.equal(aggregateReportValues(["1", "2"], "average"), "1.5000");
  assert.equal(aggregateReportValues(["-3", "-2"], "min"), "-3");
  assert.equal(aggregateReportValues(["9007199254740993", "9007199254740992"], "max"), "9007199254740993");
  assert.throws(()=>aggregateReportValues([null, "", "2", "#ERROR"], "sum"),/公式/);
  assert.equal(aggregateReportValues([null, "", "2"], "sum"), "2");
  assert.equal(aggregateReportValues([1, null], "count"), "2");
});
