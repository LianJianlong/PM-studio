import fs from "node:fs/promises";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { spawnSync } from "node:child_process";
const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).replace(/^\uFEFF/, ""), l.slice(i + 1)];
    }),
);
function client() {
  let cookie = "";
  return async (path, method = "GET", body, status = 200) => {
    const response = await fetch("http://localhost:9090/api" + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    assert.equal(
      response.status,
      status,
      `${method} ${path}: ${response.status} ${response.status === status ? "" : await response.text()}`,
    );
    return response.headers.get("content-type")?.includes("json")
      ? response.json()
      : Buffer.from(await response.arrayBuffer());
  };
}
const admin = client(),
  editor = client(),
  reviewer = client(),
  tag = Date.now().toString(36);
const who = await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const workspace = (
  await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
).id;
const manifest = { workspace, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
const save = () =>
  fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
await save();
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "选项与系统审计验证", start_date: "2026-09-23" },
    201,
  )
).id;
const context = await admin(`/projects/${project}/context`);
const members = {};
for (const [role, api] of [
  ["editor", editor],
  ["reviewer", reviewer],
]) {
  const username = `qa_${tag}_${role}`,
    password = crypto.randomBytes(16).toString("hex");
  const user = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, password, name: `测试${role}` },
    201,
  );
  manifest.users.push(user.id);
  await save();
  members[role] = user.id;
  await admin(`/projects/${project}/members/${user.id}`, "PUT", {
    role,
    can_export: true,
  });
  await api("/login", "POST", { username, password });
}
const fields = [
  { id: "title", name: "事项", type: "text", required: true },
  {
    id: "stage",
    name: "办理状态",
    type: "single_select",
    options: ["待办", "完成"],
    required: true,
  },
  {
    id: "teams",
    name: "协作部门",
    type: "multi_select",
    options: ["设计", "工程", "商务"],
    required: true,
  },
  ...["created_time", "modified_time", "created_user", "modified_user"].map(
    (type) => ({ id: type, name: type, type }),
  ),
];
const table = (
  await admin(
    `/projects/${project}/tables`,
    "POST",
    {
      name: "单选多选与审计字段",
      department_id: context.departments[0].id,
      columns: fields,
    },
    201,
  )
).id;
const base = {
  title: "浏览器选择验证",
  stage: "待办",
  teams: ["商务", "设计"],
};
for (const data of [
  { ...base, teams: [] },
  { ...base, teams: ["设计", "设计"] },
  { ...base, teams: ["不允许"] },
  { ...base, stage: "未知" },
  ...fields.slice(3).map((f) => ({ ...base, [f.id]: who.id })),
])
  await editor(`/tables/${table}/records`, "POST", { data }, 400);
const key = (
  await editor(`/tables/${table}/records`, "POST", { data: base }, 201)
).id;
const get = async (api = admin) =>
  (await api(`/tables/${table}/records`)).rows.find((r) => r.id === key);
let row = await get();
const created = row.data.created_time;
assert.deepEqual(row.data.teams, ["设计", "商务"]);
assert.equal(row.data.created_user, members.editor);
assert.equal(row.data.modified_user, members.editor);
assert.match(created, /Z$/);
await admin(`/records/${key}`, "PUT", {
  version: row.version,
  data: { title: "管理员修改" },
});
row = await get();
assert.equal(row.data.created_time, created);
assert.equal(row.data.created_user, members.editor);
assert.equal(row.data.modified_user, who.id);
assert(row.data.modified_time > created);
await admin(
  `/records/${key}`,
  "PUT",
  { version: row.version, data: { modified_time: null } },
  400,
);
assert.equal((await get()).version, row.version);
const ap = (
  await editor(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "record",
      title: "审计追踪",
      record_id: key,
      approver_id: members.reviewer,
    },
    201,
  )
).id;
assert.equal((await get()).data.modified_user, members.editor);
await reviewer(`/approvals/${ap}/decide`, "POST", { action: "approve" });
row = await get();
assert.equal(row.data.modified_user, members.reviewer);
assert.equal(row.data.created_time, created);
const approval = (await admin(`/projects/${project}/approvals`)).find(
  (a) => a.id === ap,
);
assert.equal(approval.record_data.modified_user, members.reviewer);
const change = (await editor(`/records/${key}/change`, "POST", {})).id;
const changed = (await editor(`/tables/${table}/records`)).rows.find(
  (r) => r.id === change,
);
assert.equal(changed.data.created_user, members.editor);
assert.notEqual(changed.data.created_time, created);
console.log(
  "PASS choices, immutable creation identity, server-only fields, edit/approval provenance, failed-write rollback and fresh change identity",
);
const exported = new ExcelJS.Workbook();
await exported.xlsx.load(await admin(`/tables/${table}/export`));
assert.equal(exported.worksheets[0].getCell(2, 3).value, '["设计","商务"]');
const parsed = await admin(`/tables/${table}/import-file`, "POST", {
  filename: "roundtrip.xlsx",
  content: Buffer.from(await exported.xlsx.writeBuffer()).toString("base64"),
});
const preview = await admin(`/tables/${table}/import-preview`, "POST", {
  rows: parsed.sheets[0].rows,
  mapping: { title: 0, stage: 1, teams: 2 },
});
assert.equal(preview.errors.length, 0);
await editor(`/tables/${table}/import`, "POST", {
  rows: preview.rows,
  request_key: crypto.randomUUID(),
});
await admin(
  `/tables/${table}/import-preview`,
  "POST",
  { rows: [["fake"]], mapping: { created_user: 0 } },
  400,
);
await admin(
  `/tables/${table}/import`,
  "POST",
  { rows: [{ ...base, created_time: "2020-01-01" }] },
  400,
);
const results = await Promise.all(
  Array.from({ length: 12 }, (_, i) =>
    (i % 2 ? editor : admin)(
      `/tables/${table}/records`,
      "POST",
      { data: { ...base, title: `并发${i}` } },
      201,
    ).then((r) => ({ id: r.id, actor: i % 2 ? members.editor : who.id })),
  ),
);
const all = (await admin(`/tables/${table}/records`)).rows;
for (const r of results) {
  const actual = all.find((x) => x.id === r.id);
  assert.equal(actual.data.created_user, r.actor);
  assert.equal(actual.data.modified_user, r.actor);
}
await admin(`/projects/${project}/members/${members.reviewer}`, "PUT", {
  role: "reviewer",
  can_export: true,
  hidden_columns: [
    "created_user",
    "modified_user",
    "created_time",
    "modified_time",
  ],
});
const hidden = await get(reviewer);
for (const k of [
  "created_user",
  "modified_user",
  "created_time",
  "modified_time",
])
  assert(!Object.hasOwn(hidden.data, k));
for (const k of [
  "created_by",
  "updated_by",
  "creator",
  "created_at",
  "updated_at",
])
  assert(!Object.hasOwn(hidden, k));
assert.equal(
  (await reviewer(`/tables/${table}/records?search=${who.id}`)).total,
  0,
);
assert((await admin(`/tables/${table}/records?search=${who.id}`)).total > 0);
const old = (
  await admin(
    `/projects/${project}/tables`,
    "POST",
    {
      name: "后加系统列",
      department_id: context.departments[0].id,
      columns: [fields[0]],
    },
    201,
  )
).id;
await editor(
  `/tables/${old}/records`,
  "POST",
  { data: { title: "早于字段创建" } },
  201,
);
await admin(`/tables/${old}/columns`, "POST", {
  id: "author",
  name: "创建人",
  type: "created_user",
});
assert.equal(
  (await admin(`/tables/${old}/records`)).rows[0].data.author,
  members.editor,
);
console.log(
  "PASS XLSX choice roundtrip, import forgery rejection, concurrent actor isolation, hidden-field projection/search and retroactive generated fields",
);
if (process.argv.includes("--keep-browser")) {
  console.log(`BROWSER_WORKSPACE QA集成验证 ${tag}`);
  process.exit(0);
}
const cleanup = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`], {
  encoding: "utf8",
});
assert.equal(cleanup.status, 0, cleanup.stderr);
console.log(cleanup.stdout.trim());
