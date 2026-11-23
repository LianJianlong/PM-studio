// Integration test: QA_ADMIN_URL is a migration-role URL. All fixtures and operations are rolled back.
import express from "express";
import pg from "pg";
import { pool, requestActor, requestTransaction, uid } from "../server/db.ts";
import { agendaTables, writeAgendaRecord } from "../server/agenda-table.ts";
import { data } from "../server/data.ts";
import { objects } from "../server/objects.ts";
import { planning } from "../server/planning.ts";
import { todoActions } from "../server/todo-actions.ts";
import assert from "node:assert/strict";
const c = new pg.Client({ connectionString: process.env.QA_ADMIN_URL });
await c.connect();
await c.query("BEGIN");
let server;
try {
  const admin = (
      await c.query(
        "SELECT id,username FROM users WHERE active AND system_admin LIMIT 1",
      )
    ).rows[0],
    workspace = (
      await c.query(
        "SELECT id FROM workspaces WHERE lifecycle='active' LIMIT 1",
      )
    ).rows[0].id;
  const users = (
    await c.query(
      "SELECT u.id,u.username FROM users u JOIN workspace_members w ON w.user_id=u.id WHERE w.workspace_id=$1 AND u.active AND NOT u.system_admin LIMIT 2",
      [workspace],
    )
  ).rows;
  assert.equal(users.length, 2);
  const p = uid(),
    dep = uid(),
    old = uid(),
    target = uid(),
    targetRecord = uid();
  await c.query(
    "INSERT INTO projects(id,workspace_id,name,start_date) VALUES($1,$2,'QA agenda table','2026-10-29')",
    [p, workspace],
  );
  await c.query(
    "INSERT INTO departments(id,project_id,name) VALUES($1,$2,'经理')",
    [dep, p],
  );
  for (const u of users)
    await c.query(
      "INSERT INTO memberships(id,project_id,user_id,role,department_id) VALUES($1,$2,$3,'editor',$4)",
      [uid(), p, u.id, dep],
    );
  await c.query(
    "INSERT INTO todos(id,project_id,title,due_date,owner_id) VALUES($1,$2,'Existing personal task','2026-10-29',$3)",
    [old, p, users[0].id],
  );
  await c.query(
    "INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES($1,$2,$3,'QA reference target',$4)",
    [
      target,
      p,
      dep,
      JSON.stringify([{ id: "name", name: "名称", type: "text" }]),
    ],
  );
  await c.query(
    "INSERT INTO records(id,table_id,data,created_by,status) VALUES($1,$2,$3,$4,'approved')",
    [targetRecord, target, JSON.stringify({ name: "Target row" }), admin.id],
  );
  await c.query("SET LOCAL ROLE studio_app");
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    const actor = req.headers["x-qa-actor"] || admin.id;
    req.user = { id: actor };
    await c.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
    requestActor.run(actor, () => requestTransaction.run(c, next));
  });
  app.use(agendaTables, objects, data, todoActions, planning);
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (path, method = "GET", body, actor = admin.id) => {
    const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", "x-qa-actor": actor },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(Error(JSON.stringify(result)), {
        status: response.status,
      });
    return result;
  };
  let table = (await call(`/projects/${p}/agenda-table`)).table;
  assert(table.is_agenda);
  let grid = await call(
    `/tables/${table.id}/records`,
    undefined,
    undefined,
    users[0].id,
  );
  assert(grid.rows.some((r) => r.id === old));
  assert.equal(
    (
      await call(
        `/tables/${table.id}/records`,
        undefined,
        undefined,
        users[1].id,
      )
    ).total,
    0,
  );
  const columns = [
    { id: "qty", name: "数量", type: "int64" },
    { id: "amount", name: "费用", type: "decimal", precision: 20, scale: 4 },
    { id: "tags", name: "标记", type: "multi_select", options: ["A", "B"] },
    {
      id: "serial",
      name: "序号",
      type: "int32",
      auto_increment: true,
      auto_increment_start: "100",
      auto_increment_step: "5",
    },
    { id: "calc", name: "计算", type: "formula", formula: "[qty] * 2" },
    {
      id: "related",
      name: "关联",
      type: "reference",
      target_table: target,
      display_column: "name",
      bidirectional: true,
      inverse_name: "相关事项",
    },
  ];
  for (const f of columns) await call(`/tables/${table.id}/columns`, "POST", f);
  const values = {
    title: "Shared grid task",
    due_date: "2026-10-31",
    owner: users[0].username,
    done: false,
    priority: "高",
    recurrence: "每月",
    content: "Details",
    qty: "9007199254740993",
    amount: "12.3456",
    tags: ["A", "B"],
    related: [targetRecord],
  };
  const created = await call(`/tables/${table.id}/records`, "POST", {
    data: values,
  });
  assert.equal(created.generated.serial, 100);
  let native = (await c.query("SELECT * FROM todos WHERE id=$1", [created.id]))
    .rows[0];
  assert.equal(native.owner_id, users[0].id);
  assert.equal(native.priority, "high");
  assert.equal(native.content, "Details");
  assert.equal(native.recurrence, "monthly");
  grid = await call(
    `/tables/${table.id}/records`,
    undefined,
    undefined,
    users[0].id,
  );
  let row = grid.rows.find((r) => r.id === created.id);
  assert.equal(row.data.qty, values.qty);
  assert.equal(row.data.calc, "18014398509481986");
  assert.equal(row.references.related.items[0].label, "Target row");
  assert.equal(
    (
      await call(
        `/tables/${table.id}/records`,
        undefined,
        undefined,
        users[1].id,
      )
    ).total,
    0,
  );
  await assert.rejects(
    () =>
      call(
        `/records/${created.id}`,
        "PUT",
        { version: row.version, data: { title: "Not allowed" } },
        users[1].id,
      ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    () =>
      call(
        `/records/${created.id}`,
        "PUT",
        { version: row.version, data: { owner: users[1].username } },
        users[0].id,
      ),
    (e) => e.status === 403,
  );
  // Simulate the normal single-record route: its outer transaction is not ambient.
  await requestTransaction.exit(() =>
    requestActor.run(users[0].id, () =>
      writeAgendaRecord(c, users[0].id, table, row, {
        ...Object.fromEntries(
          Object.entries(row.data).filter(
            ([key]) => !["created_at", "updated_at", "calc"].includes(key),
          ),
        ),
        title: "Transaction routing check",
      }),
    ),
  );
  row = (
    await call(`/tables/${table.id}/records`, undefined, undefined, users[0].id)
  ).rows.find((r) => r.id === created.id);
  await call(
    `/records/${created.id}`,
    "PUT",
    { version: row.version, data: { title: "Edited in grid", done: true } },
    users[0].id,
  );
  native = (await c.query("SELECT * FROM todos WHERE id=$1", [created.id]))
    .rows[0];
  assert.equal(native.title, "Edited in grid");
  assert.equal(native.done, true);
  let child = (
    await c.query("SELECT * FROM todos WHERE parent_todo_id=$1", [created.id])
  ).rows[0];
  assert(child);
  assert.equal(
    child.due_date.toISOString?.().slice(0, 10) || child.due_date,
    "2026-11-30",
  );
  assert(
    (await c.query("SELECT id FROM records WHERE id=$1", [child.id])).rowCount,
  );
  await call(
    `/todos/${created.id}`,
    "PATCH",
    { title: "Edited in calendar", version: native.version },
    users[0].id,
  );
  row = (
    await call(`/tables/${table.id}/records`, undefined, undefined, users[0].id)
  ).rows.find((r) => r.id === created.id);
  assert.equal(row.data.title, "Edited in calendar");
  assert.equal(row.data.amount, "12.3456");
  assert.equal(row.data.serial, 100);
  assert.equal(row.version, native.version + 1);
  await call(`/tables/${table.id}/confirm-status`, "POST", {
    status: "approved",
    records: [{ id: row.id, version: row.version }],
  });
  assert.equal(
    (
      await call(
        `/tables/${table.id}/records`,
        undefined,
        undefined,
        users[1].id,
      )
    ).total,
    0,
  );
  row = (
    await call(`/tables/${table.id}/records`, undefined, undefined, users[0].id)
  ).rows.find((r) => r.id === created.id);
  await call(`/tables/${table.id}/confirm-status`, "POST", {
    status: "obsolete",
    records: [{ id: row.id, version: row.version }],
  });
  assert.equal(
    (await c.query("SELECT archived FROM todos WHERE id=$1", [row.id])).rows[0]
      .archived,
    true,
  );
  table = (await call(`/projects/${p}/agenda-table`)).table;
  await assert.rejects(() =>
    call(`/objects/tables/${table.id}/columns/due_date`, "PATCH", {
      version: table.object_version,
      definition: { type: "text", required: true },
    }),
  );
  console.log(
    "PASS transaction-rollback integration: existing tasks, core sync, precise custom types, auto increment, formula, bidirectional reference, owner privacy, permission denial, calendar edits and monthly generation",
  );
} finally {
  server?.close();
  await c.query("ROLLBACK");
  await c.end();
  await pool.end();
}
