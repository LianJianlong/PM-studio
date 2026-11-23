import test from "node:test";
import assert from "node:assert/strict";
import { costUnits, formatCost, groupCosts } from "../shared/cost-dashboard.ts";

test("cost dashboard aggregates exact four-decimal amounts across dimensions", () => {
  const rows = [
    { kind: "human", department: "工程", activity_id: "a", activity_code: "1.2", activity_name: "开挖", planned_cost: "100.0001", actual_cost: "110.0000" },
    { kind: "material", department: "工程", activity_id: "a", activity_code: "1.2", activity_name: "开挖", planned_cost: "0.0002", actual_cost: "0.0001" },
    { kind: "human", department: "商务", activity_id: "b", activity_code: "1.3", activity_name: "计量", planned_cost: "20.0000", actual_cost: "10.0000" },
  ];
  const byDepartment = groupCosts(rows, "department");
  assert.equal(byDepartment.find((row) => row.key === "工程")?.planned, 1000003n);
  assert.equal(byDepartment.find((row) => row.key === "工程")?.variance, -99998n);
  assert.equal(groupCosts(rows, "kind").find((row) => row.key === "human")?.planned, 1200001n);
  assert.equal(groupCosts(rows, "activity").find((row) => row.key === "a")?.actual, 1100001n);
  assert.equal(formatCost(costUnits("123456789012345.6789")), "123,456,789,012,345.6789");
});
