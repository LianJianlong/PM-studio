// Run manually against the local Docker deployment: node tests/integration.mjs
// Creates an isolated QA workspace. A manifest is written for fixture cleanup.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).replace(/^\uFEFF/, ""), l.slice(i + 1)];
    }),
);
const base = "http://localhost:9090/api",
  tag = Date.now().toString(36),
  password = crypto.randomBytes(18).toString("hex");
function client() {
  let cookie = "";
  return async (path, method = "GET", body, expected = 200) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    if (r.status !== expected)
      throw Error(
        `${method} ${path}: expected ${expected}, got ${r.status} ${await r.text()}`,
      );
    if (r.headers.get("content-type")?.includes("json")) return r.json();
    return Buffer.from(await r.arrayBuffer());
  };
}
const admin = client(),
  editor = client(),
  reviewer = client(),
  outsider = client();
await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const boot = await admin("/bootstrap");
const workspace = (
  await admin("/workspaces", "POST", { name: "QA集成验证 " + tag }, 201)
).id;
const manifest = { workspace, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
async function newUser(label) {
  const name = "qa_" + tag + "_" + label;
  const r = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username: name, name: "测试" + label, password },
    201,
  );
  manifest.users.push(r.id);
  await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
  return { ...r, username: name };
}
const ed = await newUser("editor"),
  rev = await newUser("reviewer"),
  out = await newUser("outsider");
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    {
      name: "权限审批验证项目",
      start_date: "2026-09-01",
      description: "自动化验证专用",
    },
    201,
  )
).id;
const second = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "隔离项目", start_date: "2026-09-01" },
    201,
  )
).id;
const context = await admin(`/projects/${project}/context`),
  department = context.departments[0].id;
const fields = [
  { id: "title", name: "事项", type: "text", required: true },
  { id: "amount", name: "金额", type: "number", required: true },
  { id: "secret", name: "敏感列", type: "text", required: false },
];
const table = (
  await admin(
    `/projects/${project}/tables`,
    "POST",
    { name: "验证台账", department_id: department, columns: fields },
    201,
  )
).id;
await admin(`/projects/${project}/members/${ed.id}`, "PUT", {
  role: "editor",
  can_export: true,
});
await admin(`/projects/${project}/members/${rev.id}`, "PUT", {
  role: "reviewer",
});
await editor("/login", "POST", { username: ed.username, password });
await reviewer("/login", "POST", { username: rev.username, password });
await outsider("/login", "POST", { username: out.username, password });
await outsider(`/projects/${project}/summary`, "GET", undefined, 403);
await editor(`/projects/${second}/tables`, "GET", undefined, 403);
console.log("PASS tenant and project isolation");
await editor(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "错误数值", amount: "not-number" } },
  400,
);
const record = (
  await editor(
    `/tables/${table}/records`,
    "POST",
    { data: { title: "审批测试", amount: 100, secret: "hidden-secret" } },
    201,
  )
).id;
await editor(
  `/records/${record}`,
  "PUT",
  { version: 999, data: { amount: 1 } },
  409,
);
await editor(
  `/projects/${project}/approvals`,
  "POST",
  { kind: "record", title: "禁止自审", record_id: record, approver_id: ed.id },
  400,
);
const approval = (
  await editor(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "record",
      title: "日报审核",
      record_id: record,
      approver_id: rev.id,
    },
    201,
  )
).id;
await editor(
  `/records/${record}`,
  "PUT",
  { version: 2, data: { amount: 10 } },
  409,
);
const received = await reviewer("/notifications");
assert.ok(received.items.some((n) => n.resource_id === approval));
assert.ok(received.unread > 0);
const messageId = received.items.find((n) => n.resource_id === approval).id;
await outsider(`/notifications/${messageId}`, "PATCH", {}, 404);
await reviewer(`/notifications/${messageId}`, "PATCH", {});
assert.ok(
  (await reviewer("/notifications")).items.find((n) => n.id === messageId)
    .read_at,
);
await reviewer(`/approvals/${approval}/decide`, "POST", { action: "approve" });
assert.ok(
  (await editor("/notifications")).items.some(
    (n) => n.resource_id === approval && n.title.includes("通过"),
  ),
);
console.log(
  "PASS transactional approval notifications, read state and recipient isolation",
);
await reviewer(
  `/approvals/${approval}/decide`,
  "POST",
  { action: "approve" },
  409,
);
await editor(
  `/records/${record}`,
  "PUT",
  { version: 3, data: { amount: 10 } },
  409,
);
let summary = await editor(`/projects/${project}/summary`);
assert.equal(summary.tables[0].metrics[0].sum, 100);
console.log(
  "PASS validation, optimistic locking, no self-approval, approved lock and idempotent decisions",
);
const changed = (await editor(`/records/${record}/change`, "POST", {})).id;
await editor(`/records/${changed}`, "PUT", {
  version: 1,
  data: { amount: 150 },
});
const changeApproval = (
  await editor(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "record",
      title: "变更审核",
      record_id: changed,
      approver_id: rev.id,
    },
    201,
  )
).id;
await reviewer(`/approvals/${changeApproval}/decide`, "POST", {
  action: "approve",
});
summary = await editor(`/projects/${project}/summary`);
assert.equal(summary.tables[0].metrics[0].sum, 150);
console.log("PASS approved change replaces original without double-counting");
const buffer = await editor(`/tables/${table}/export`);
assert.equal(buffer.subarray(0, 2).toString(), "PK");
console.log("PASS real XLSX export");
await admin(`/projects/${project}/members/${ed.id}`, "PUT", {
  role: "editor",
  hidden_columns: ["secret"],
  can_export: false,
});
let records = await editor(`/tables/${table}/records`);
assert.ok(records.rows.every((r) => !("secret" in r.data)));
assert.ok(records.table.columns.every((f) => f.id !== "secret"));
assert.equal(
  (await editor(`/tables/${table}/records?search=hidden-secret`)).total,
  0,
);
assert.ok(
  (await admin(`/tables/${table}/records?search=hidden-secret`)).total > 0,
);
await editor(
  `/tables/${table}/import-preview`,
  "POST",
  { rows: [["hidden-secret"]], mapping: { secret: 0 } },
  403,
);
await editor(`/tables/${table}/export`, "GET", undefined, 403);
await editor(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "hidden injection", amount: 1, secret: "try" } },
  403,
);
console.log(
  "PASS hidden column projection, write rejection and export permission",
);
await admin(`/projects/${project}/members/${ed.id}`, "PUT", {
  role: "editor",
  row_scope: "own",
});
await admin(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "别人数据", amount: 50 } },
  201,
);
records = await editor(`/tables/${table}/records`);
assert.ok(records.rows.every((r) => r.created_by === ed.id));
console.log("PASS row-level filtering");
const accessRequest = (
  await outsider(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "access",
      title: "申请短期查看",
      payload: {
        role: "viewer",
        expires_at: new Date(Date.now() + 4000).toISOString(),
      },
    },
    201,
  )
).id;
await admin(`/approvals/${accessRequest}/decide`, "POST", {
  action: "approve",
});
await outsider(`/projects/${project}/summary`);
await new Promise((r) => setTimeout(r, 4200));
await outsider(`/projects/${project}/summary`, "GET", undefined, 403);
console.log("PASS access approval and real-time expiry");
const a = (
  await admin(
    `/projects/${project}/activities`,
    "POST",
    { code: "1", name: "前置作业", duration: 5, progress: 0 },
    201,
  )
).id;
const b = (
  await admin(
    `/projects/${project}/activities`,
    "POST",
    {
      code: "2",
      name: "后续作业",
      duration: 3,
      progress: 0,
      predecessors: [{ id: a, type: "FS", lag: 1 }],
    },
    201,
  )
).id;
let plan = await admin(`/projects/${project}/plan`);
assert.equal(plan.duration, 9);
await admin(
  `/projects/${project}/activities/${a}`,
  "PUT",
  {
    code: "1",
    name: "循环",
    duration: 5,
    progress: 0,
    version: 1,
    predecessors: [{ id: b, type: "FS", lag: 0 }],
  },
  400,
);
console.log("PASS schedule recalculation and cycle rejection");
await admin(`/projects/${project}/members/${rev.id}`, "PUT", {
  role: "manager",
});
const baseline = (
  await admin(
    `/projects/${project}/approvals`,
    "POST",
    { kind: "baseline", title: "验证基线", approver_id: rev.id },
    201,
  )
).id;
await reviewer(`/approvals/${baseline}/decide`, "POST", { action: "approve" });
plan = await admin(`/projects/${project}/plan`);
assert.equal(plan.baselines.length, 1);
assert.equal(plan.baselines[0].snapshot.duration, 9);
const stage = (
  await admin(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "stage",
      title: "启动批准",
      approver_id: rev.id,
      payload: {
        engineering_stage: "启动",
        business_stage: "计划",
        reason: "集成验证关口",
      },
    },
    201,
  )
).id;
await reviewer(`/approvals/${stage}/decide`, "POST", { action: "approve" });
summary = await admin(`/projects/${project}/summary`);
assert.equal(summary.project.engineering_stage, "启动");
console.log("PASS baseline and lifecycle approvals");
const todo = (
  await editor(
    `/projects/${project}/todos`,
    "POST",
    { title: "验证待办", due_date: "2026-09-25", owner_id: ed.id },
    201,
  )
).id;
await editor(`/todos/${todo}`, "PATCH", { done: true });
assert.ok(
  (await editor(`/projects/${project}/todos`)).find((t) => t.id === todo).done,
);
const report = (
  await admin(
    `/projects/${project}/reports`,
    "POST",
    { name: "验证统计报告" },
    201,
  )
).id;
assert.equal((await admin(`/reports/${report}`)).snapshot.counts.approved, 1);
console.log("PASS calendar persistence and report snapshot");
assert.ok(
  (await editor("/notifications")).items.some(
    (n) => n.kind === "todo" && n.resource_id === todo,
  ),
);
const csv = Buffer.from("事项,金额\n导入一,12.5\n导入二,18").toString("base64");
const parsed = await editor(`/tables/${table}/import-file`, "POST", {
  filename: "test.csv",
  content: csv,
});
assert.equal(parsed.sheets[0].rows.length, 2);
const beforeImport = (await editor(`/tables/${table}/records`)).total;
const preview = await editor(`/tables/${table}/import-preview`, "POST", {
  rows: parsed.sheets[0].rows,
  mapping: { title: 0, amount: 1 },
});
assert.equal(preview.errors.length, 0);
assert.equal(preview.rows[0].amount, 12.5);
assert.equal((await editor(`/tables/${table}/records`)).total, beforeImport);
const invalid = await editor(`/tables/${table}/import-preview`, "POST", {
  rows: [
    ["valid", 2],
    ["invalid", "bad-number"],
  ],
  mapping: { title: 0, amount: 1 },
});
assert.equal(invalid.errors.length, 1);
assert.equal(invalid.rows.length, 0);
await editor(
  `/tables/${table}/import`,
  "POST",
  {
    rows: [
      { title: "should rollback", amount: 2 },
      { title: "invalid", amount: "bad" },
    ],
  },
  400,
);
assert.equal((await editor(`/tables/${table}/records`)).total, beforeImport);
const requestKey = crypto.randomUUID();
const imported = await editor(`/tables/${table}/import`, "POST", {
  rows: preview.rows,
  request_key: requestKey,
});
assert.equal(imported.count, 2);
const repeated = await editor(`/tables/${table}/import`, "POST", {
  rows: preview.rows,
  request_key: requestKey,
});
assert.equal(repeated.replayed, true);
await editor(
  `/tables/${table}/import`,
  "POST",
  { rows: [{ title: "different batch", amount: 5 }], request_key: requestKey },
  409,
);
assert.equal(
  (
    await editor(
      `/tables/${table}/records?search=${encodeURIComponent("导入")}&status=draft`,
    )
  ).total,
  2,
);
assert.equal(
  (
    await editor(
      `/tables/${table}/records?search=${encodeURIComponent("导入")}&status=approved`,
    )
  ).total,
  0,
);
await editor("/notifications/read-all", "POST", {});
assert.equal((await editor("/notifications")).unread, 0);
console.log(
  "PASS import preview, atomic validation, mapped import, authorized search and notification read-all",
);
await admin(`/projects/${project}/members/${ed.id}`, "PUT", {
  role: "editor",
  row_scope: "all",
  can_export: true,
});
const allReport = (
  await editor(
    `/projects/${project}/reports`,
    "POST",
    { name: "全部范围报告" },
    201,
  )
).id;
await admin(`/projects/${project}/members/${ed.id}`, "PUT", {
  role: "editor",
  row_scope: "own",
  can_export: true,
});
await editor(`/reports/${allReport}`, "GET", undefined, 403);
const ownReport = (
  await editor(
    `/projects/${project}/reports`,
    "POST",
    { name: "本人范围报告" },
    201,
  )
).id;
assert.equal(
  (await editor(`/reports/${ownReport}`)).snapshot.access_scope.row_scope,
  "own",
);
console.log(
  "PASS report snapshots honor original row scope and deny narrowed historical access",
);
await admin(`/workspaces/${workspace}/users/${ed.id}`, "PATCH", {
  active: false,
});
await editor("/bootstrap", "GET", undefined, 401);
console.log("PASS account disable revokes active session");
const csrf = await fetch(base + "/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://untrusted.example",
  },
  body: JSON.stringify({ username: "admin", password: "not-real" }),
});
assert.equal(csrf.status, 403);
console.log("PASS cross-origin mutation rejected");
const browserName = "qa_browser_" + tag;
const browser = (
  await admin(
    `/workspaces/${boot.workspaces[0].id}/users`,
    "POST",
    {
      username: browserName,
      name: "界面验证账号",
      password: "Local-QA-9090-Only!",
    },
    201,
  )
).id;
manifest.browser = {
  id: browser,
  username: browserName,
  workspace: boot.workspaces[0].id,
};
await admin(`/projects/${boot.projects[0].id}/members/${browser}`, "PUT", {
  role: "manager",
});
await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
console.log("BROWSER_TEST_USERNAME", browserName);
console.log("INTEGRATION PASSED");
