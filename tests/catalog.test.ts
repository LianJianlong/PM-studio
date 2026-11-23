import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCatalog } from "../shared/catalog.ts";
const departments = [
  { id: "a", name: "工程" },
  { id: "b", name: "商务" },
  { id: "c", name: "空部门" },
];
const tables = [
  {
    id: "1",
    department_id: "a",
    name: "施工日报",
    columns: [{ id: "progress", name: "进度" }],
  },
  {
    id: "2",
    department_id: "b",
    name: "合同台账",
    columns: [{ id: "amount", name: "金额" }],
  },
];
test("catalog search retains ancestor, supports field identifier and trimmed case-insensitive matching", () => {
  const result = filterCatalog(departments, tables, " PROGRESS ");
  assert.deepEqual(
    result.map((x) => x.department.id),
    ["a"],
  );
  assert.deepEqual(
    result[0].tables.map((x) => x.id),
    ["1"],
  );
  assert.equal(filterCatalog(departments, tables, "合同")[0].tables[0].id, "2");
  assert.equal(
    filterCatalog(departments, tables, "金额")[0].department.id,
    "b",
  );
});
test("department matches include children; empty matches and clearing are supported without mutation", () => {
  assert.equal(filterCatalog(departments, tables, "工程")[0].tables.length, 1);
  assert.equal(
    filterCatalog(departments, tables, "空部门")[0].tables.length,
    0,
  );
  assert.deepEqual(filterCatalog(departments, tables, "不存在"), []);
  assert.equal(filterCatalog(departments, tables, "  ").length, 3);
  assert.equal(tables.length, 2);
});
test("catalog search cannot find omitted tables or hidden fields", () => {
  const projection = [{ ...tables[0], columns: [] }];
  assert.deepEqual(filterCatalog(departments, projection, "进度"), []);
  assert.deepEqual(filterCatalog(departments, projection, "合同"), []);
});
