import fs from "node:fs/promises";
import assert from "node:assert/strict";
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
const base = "http://localhost:9090/api",
  tag = Date.now().toString(36);
function client() {
  let cookie = "";
  return async (path, method = "GET", body, expected = 200) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const result = await r.json();
    assert.equal(
      r.status,
      expected,
      `${method} ${path} ${JSON.stringify(result)}`,
    );
    return result;
  };
}
const admin = client(),
  editor = client();
await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const w = (
  await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
).id;
const manifest = { workspace: w, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
async function save() {
  await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
}
await save();
const p = (
  await admin(
    `/workspaces/${w}/projects`,
    "POST",
    { name: "对象状态验证", start_date: "2026-09-01" },
    201,
  )
).id;
const context = await admin(`/projects/${p}/context`);
const t = (
  await admin(
    `/projects/${p}/tables`,
    "POST",
    {
      name: "状态台账",
      department_id: context.departments[0].id,
      columns: [
        { id: "title", name: "事项", type: "text", required: true },
        { id: "note", name: "备注", type: "text" },
        { id: "empty", name: "空列", type: "text" },
      ],
    },
    201,
  )
).id;
const e = await admin(
  `/workspaces/${w}/users`,
  "POST",
  {
    username: `qa_${tag}_editor`,
    name: "测试录入员",
    password: "Lifecycle-Test-2026!",
  },
  201,
);
manifest.users.push(e.id);
await save();
await admin(`/projects/${p}/members/${e.id}`, "PUT", { role: "editor" });
await editor("/login", "POST", {
  username: `qa_${tag}_editor`,
  password: "Lifecycle-Test-2026!",
});
const r = (
  await editor(
    `/tables/${t}/records`,
    "POST",
    { data: { title: "保留内容", note: "原备注" } },
    201,
  )
).id;
async function obj(kind, key) {
  const url =
    kind === "workspace"
      ? "/objects/workspaces"
      : kind === "project"
        ? `/objects/workspaces/${w}/projects`
        : kind === "table"
          ? `/objects/projects/${p}/tables`
          : `/objects/tables/${t}/records`;
  const data = await admin(url);
  return (data.rows || data).find((x) => x.id === key);
}
async function patch(kind, key, body, expected = 200, by = admin) {
  const row = await obj(kind, key);
  return by(
    `/objects/${kind}/${key}`,
    "PATCH",
    { version: row.object_version || row.version, ...body },
    expected,
  );
}
async function col(key, body, expected = 200) {
  const table = await obj("table", t);
  return admin(
    `/objects/tables/${t}/columns/${key}`,
    "PATCH",
    { version: table.object_version, ...body },
    expected,
  );
}
await patch("table", t, { name: "越权修改" }, 403, editor);
await editor(`/objects/projects/${p}/tables`, "GET", undefined, 403);
const old = await obj("table", t);
await patch("table", t, { name: "重命名台账" });
await admin(
  `/objects/table/${t}`,
  "PATCH",
  { version: old.object_version, name: "覆盖" },
  409,
);
await patch("record", r, { lifecycle: "frozen" });
let record = (await admin(`/tables/${t}/records`)).rows.find((x) => x.id === r);
await editor(
  `/records/${r}`,
  "PUT",
  { version: record.version, data: { title: "非法修改" } },
  409,
);
await patch("record", r, { lifecycle: "active" });
await col("note", { lifecycle: "frozen" });
record = (await admin(`/tables/${t}/records`)).rows.find((x) => x.id === r);
await editor(
  `/records/${r}`,
  "PUT",
  { version: record.version, data: { note: "非法改列" } },
  409,
);
await editor(`/records/${r}`, "PUT", {
  version: record.version,
  data: { title: "其他列仍可编辑" },
});
await col("note", { lifecycle: "deleted" }, 409);
await col("empty", { lifecycle: "deleted" });
assert(
  !(await admin(`/tables/${t}/records`)).table.columns.some(
    (f) => f.id === "empty",
  ),
);
await col("empty", { lifecycle: "active", name: "同时改名" }, 409);
await col("empty", { lifecycle: "active" });
console.log(
  "PASS management authorization, version conflicts, row/column freeze and protected column deletion",
);
for (const [kind, key] of [
  ["table", t],
  ["project", p],
  ["workspace", w],
]) {
  await patch(kind, key, { lifecycle: "frozen" });
  await editor(
    `/tables/${t}/records`,
    "POST",
    { data: { title: "不得写入" } },
    409,
  );
  await editor(
    `/tables/${t}/import`,
    "POST",
    { rows: [{ title: "批次不得写入" }] },
    409,
  );
  assert((await editor(`/tables/${t}/records`)).rows.length > 0);
  if (kind !== "table") await patch("table", t, { lifecycle: "disabled" }, 409);
  await patch(kind, key, { name: "冻结状态改名" }, 409);
  await patch(kind, key, { lifecycle: "active" });
}
await col("note", { lifecycle: "active" });
await patch("table", t, { lifecycle: "disabled" });
await patch("project", p, { lifecycle: "frozen" });
await patch("project", p, { lifecycle: "active" });
assert.equal((await obj("table", t)).lifecycle, "disabled");
await patch("table", t, { lifecycle: "active" });
console.log(
  "PASS inherited workspace/project/table write guards, import rollback, read-only queries, parent activation preserves child state",
);
await patch("record", r, { lifecycle: "deleted" });
assert.equal((await admin(`/tables/${t}/records`)).total, 0);
assert.equal((await obj("record", r)).data.title, "其他列仍可编辑");
await patch("record", r, { lifecycle: "active" });
assert.equal((await admin(`/tables/${t}/records`)).total, 1);
await patch("table", t, { lifecycle: "deleted" });
assert.equal((await admin(`/projects/${p}/tables`)).length, 0);
await admin(`/tables/${t}/records`, "GET", undefined, 403);
await patch("table", t, { lifecycle: "active" });
await patch("project", p, { lifecycle: "deleted" });
await admin(`/projects/${p}/summary`, "GET", undefined, 409);
await patch("project", p, { lifecycle: "active" });
// Keep original manifest workspace name so cleanup can verify ownership.
await patch("workspace", w, { lifecycle: "deleted" });
await admin(`/projects/${p}/context`, "GET", undefined, 409);
await patch("workspace", w, { lifecycle: "active" });
assert.equal(
  (await admin(`/tables/${t}/records`)).rows[0].data.title,
  "其他列仍可编辑",
);
console.log(
  "PASS recoverable workspace/project/table/row deletion and original data retention",
);
await admin(`/projects/${p}/members/${e.id}`, "PUT", { role: "reviewer" });
const ap = (
  await admin(
    `/projects/${p}/approvals`,
    "POST",
    { kind: "record", title: "状态校验审批", record_id: r, approver_id: e.id },
    201,
  )
).id;
await patch("record", r, { lifecycle: "frozen" }, 409);
await patch("project", p, { lifecycle: "deleted" }, 409);
await patch("table", t, { lifecycle: "frozen" });
await editor(`/approvals/${ap}/decide`, "POST", { action: "approve" }, 409);
await patch("table", t, { lifecycle: "active" });
assert.equal(
  (await admin(`/projects/${p}/approvals`)).find((x) => x.id === ap).status,
  "pending",
);
await editor(`/approvals/${ap}/decide`, "POST", { action: "approve" });
await patch("record", r, { lifecycle: "deleted" }, 409);
console.log(
  "PASS pending deletion protection, frozen approval transaction rollback and final-record protection",
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
