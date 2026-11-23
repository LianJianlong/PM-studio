import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataTask,
  compileDataTask,
  enrichmentFields,
  type DataScope,
} from "../shared/ai-workbench.ts";
import { previewRows } from "../src/ai-preview.ts";
const scope = (): DataScope => ({
  project: "p",
  departments: ["engineering"],
  tables: [
    {
      id: "table-id",
      name: "项目WBS",
      project_id: "p",
      object_version: 3,
      columns: [
        { id: "code", name: "编码", type: "text" },
        { id: "name", name: "名称", type: "text" },
        { id: "description", name: "工作范围", type: "text" },
      ],
      rows: [
        {
          id: "row-id",
          data: { code: "A", name: "供配电" },
          status: "draft",
          version: 7,
        },
      ],
      total: 1,
      permissions: { create: true, write: true, delete: true, manage: true },
    },
  ],
});
const task = (operations: any[]) =>
  dataTask.parse({ outcome: "draft", summary: "test", operations });
test("workbench compiles actual server-known record IDs and freezes observed versions without mutating the snapshot", () => {
  const s = scope(),
    t = task([
      {
        action: "records.update",
        table: "项目WBS",
        rows: [{ id: "row_1", data: { 工作范围: "新范围" } }],
      },
    ]);
  const a = compileDataTask(t, s),
    b = compileDataTask(t, s);
  assert.deepEqual(a, b);
  assert.equal(a.operations[0].path, "/tables/table-id/records/batch-update");
  assert.deepEqual(a.operations[0].body?.records, [
    { id: "row-id", version: 7, data: { description: "新范围" } },
  ]);
  assert.equal(s.tables[0].rows[0].version, 7);
});
test("workbench rejects invisible fields, unknown rows, duplicate identities and unavailable CRUD actions", () => {
  for (const op of [
    {
      action: "records.update",
      table: "table-id",
      rows: [{ id: "NOT-READ", data: { name: "x" } }],
    },
    {
      action: "records.update",
      table: "table-id",
      rows: [{ id: "row_1", data: { secret: "x" } }],
    },
    {
      action: "records.update",
      table: "outside",
      rows: [{ id: "row_1", data: { name: "x" } }],
    },
  ])
    assert.throws(() => compileDataTask(task([op]), scope()));
  const s = scope();
  s.tables[0].permissions.write = false;
  assert.throws(() =>
    compileDataTask(
      task([
        {
          action: "records.update",
          table: "table-id",
          rows: [{ id: "row_1", data: { name: "x" } }],
        },
      ]),
      s,
    ),
  );
  assert.throws(() =>
    compileDataTask(
      task([
        {
          action: "records.delete",
          table: "table-id",
          ids: ["row_1", "row_1"],
        },
      ]),
      scope(),
    ),
  );
});
test("approved records produce a change draft and never overwrite the approved row", () => {
  const s = scope();
  s.tables[0].rows[0].status = "approved";
  const p = compileDataTask(
    task([
      {
        action: "records.update",
        table: "table-id",
        rows: [{ id: "row_1", data: { description: "new" } }],
      },
    ]),
    s,
  );
  assert.equal(p.operations[0].path, "/records/row-id/change");
  assert.equal(p.operations[1].path, "/records/$steps.op_1.id");
  assert.equal(p.operations[1].body?.version, 1);
});
test("schema and new table dependencies compile through existing business routes", () => {
  const p = compileDataTask(
    task([
      {
        action: "table.create",
        key: "newtable",
        name: "采购",
        department_id: "engineering",
        columns: [{ id: "title", name: "事项", type: "text" }],
      },
      {
        action: "records.create",
        table: "$steps.newtable.id",
        rows: [{ data: { title: "待办" } }],
      },
    ]),
    scope(),
  );
  assert.equal(p.operations[1].path, "/tables/$steps.newtable.id/import");
  assert.throws(() =>
    compileDataTask(
      task([
        {
          action: "table.create",
          key: "newtable",
          name: "采购",
          department_id: "outside",
          columns: [{}],
        },
      ]),
      scope(),
    ),
  );
});
test("scope enrichment recognises the screenshot request but does not treat exact replacement as generated scope", () => {
  assert.deepEqual(
    enrichmentFields(
      "@[计划管理 / WBS](project:abc;group:plan;plan:wbs) 补充完善WBS的工作范围",
      scope().tables[0],
    ),
    ["description"],
  );
  assert.deepEqual(
    enrichmentFields("把工作范围改为“仅含配电”", scope().tables[0]),
    [],
  );
});
test("data review compares field values instead of treating interface success as data changes", () => {
  const op = { key: "edit", body: { records: [] } };
  const rows = previewRows(op, {
    labels: { description: "工作范围" },
    data: {
      changes: [
        {
          step: "edit",
          before: [{ id: "r", data: { code: "A", description: "old" } }],
          after: [{ id: "r", data: { code: "A", description: "new" } }],
        },
      ],
    },
  });
  assert.deepEqual(rows, [
    { record: "A", field: "工作范围", before: "old", after: "new" },
  ]);
});
import { normalizeDataTask } from "../shared/ai-workbench.ts";
test("structured operation envelopes unwrap equivalent actions without altering business values or accepting conflicts", () => {
  const task = normalizeDataTask({
    outcome: "draft",
    summary: "x",
    operations: [
      {
        table: "T",
        "field.add": { definition: { id: "note", name: "备注", type: "text" } },
      },
    ],
  });
  assert.deepEqual(task.operations[0], {
    table: "T",
    action: "field.add",
    definition: { id: "note", name: "备注", type: "text" },
  });
  assert.throws(() =>
    normalizeDataTask({
      operations: [{ table: "A", "field.add": { table: "B", definition: {} } }],
    }),
  );
});

test('stable aliases cannot fall back to another record with an alias-like code',()=>{const s=scope();s.tables[0].row_aliases={row_1:'previous-search-record'};s.tables[0].rows[0].data.code='row_1';assert.throws(()=>compileDataTask(dataTask.parse({outcome:'draft',summary:'不可错位',operations:[{action:'records.update',table:s.tables[0].id,rows:[{id:'row_1',data:{name:'不应改动'}}]}]}),s),/未读取/);});
