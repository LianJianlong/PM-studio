import fs from "node:fs/promises";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
    const r = await fetch("http://localhost:9090/api" + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const value = await r.json();
    if (Array.isArray(status)) {
      assert.ok(status.includes(r.status), JSON.stringify(value));
      return { status: r.status, value };
    }
    assert.equal(
      r.status,
      status,
      `${method} ${path}: ${JSON.stringify(value)}`,
    );
    return value;
  };
}
const admin = client(),
  editor = client(),
  viewer = client(),
  manager = client(),
  tag = Date.now().toString(36);
await admin("/login", "POST", {
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
    { name: "权限配置表验证", start_date: "2026-09-24" },
    201,
  )
).id;
const context = await admin(`/projects/${project}/context`),
  members = {},
  logins = {};
for (const [role, api] of [
  ["editor", editor],
  ["viewer", viewer],
  ["manager", manager],
]) {
  const username = `qa_${tag}_${role}`,
    password = crypto.randomBytes(16).toString("hex");
  const u = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, password, name: `权限表${role}` },
    201,
  );
  manifest.users.push(u.id);
  await save();
  members[role] = u.id;
  logins[role] = { username, password };
  await api("/login", "POST", { username, password });
}
const endpoint = `/projects/${project}/permission-matrix`,
  read = () => admin(endpoint);
const send = (changes, status = 200) =>
  admin(endpoint, "PUT", { changes }, status);
const matrix = (await read()).rows;
await send(
  ["editor", "viewer", "manager"].map((role) => ({
    user_id: members[role],
    expected_revision: null,
    grant: { role },
  })),
);
const current = async (user) =>
  (await read()).rows.find((r) => r.user_id === user).grant;
const change = async (user, grant) => ({
  user_id: user,
  expected_revision: (await current(user))?.revision ?? null,
  grant,
});
for (const api of [editor, viewer, manager]) {
  await api(endpoint, "GET", undefined, 403);
  await api(
    endpoint,
    "PUT",
    { changes: [await change(members.viewer, { role: "manager" })] },
    403,
  );
}
const owner = matrix.find((r) => r.workspace_role === "owner");
await send(
  [
    {
      user_id: owner.user_id,
      expected_revision: null,
      grant: { role: "viewer" },
    },
  ],
  400,
);
const before = await current(members.editor);
await send(
  [
    await change(members.editor, { role: "manager" }),
    await change(members.viewer, {
      role: "editor",
      department_id: crypto.randomUUID(),
    }),
  ],
  400,
);
assert.deepEqual(await current(members.editor), before);
await send(
  [
    await change(members.editor, { role: "editor" }),
    await change(members.editor, { role: "viewer" }),
  ],
  400,
);
await send(
  [
    {
      user_id: crypto.randomUUID(),
      expected_revision: null,
      grant: { role: "viewer" },
    },
  ],
  400,
);
console.log(
  "PASS owner-only matrix, protected owner, target membership checks and all-or-nothing validation",
);

const stale = await change(members.viewer, { role: "editor" });
await admin(`/projects/${project}/members/${members.viewer}`, "PUT", {
  role: "reviewer",
});
const latest = await current(members.viewer);
assert.notEqual(stale.expected_revision, latest.revision);
await send([await change(members.editor, { role: "manager" }), stale], 409);
assert.deepEqual(await current(members.editor), before);
const concurrent = await change(members.viewer, { role: "viewer" });
const outcomes = await Promise.all([
  send([concurrent], [200, 409]),
  send([{ ...concurrent, grant: { role: "editor" } }], [200, 409]),
]);
assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
const old = await current(members.viewer);
await send([await change(members.viewer, null)]);
await viewer(`/projects/${project}/context`, "GET", undefined, 403);
await send([
  {
    user_id: members.viewer,
    expected_revision: null,
    grant: { role: "viewer" },
  },
]);
assert.notEqual((await current(members.viewer)).revision, old.revision);
await send(
  [
    {
      user_id: members.viewer,
      expected_revision: old.revision,
      grant: { role: "editor" },
    },
  ],
  409,
);
console.log(
  "PASS legacy grant revision tracking, stale batch rollback, concurrent single winner and revoke/regrant identity",
);

const table = (
  await admin(
    `/projects/${project}/tables`,
    "POST",
    {
      name: "受限业务表",
      department_id: context.departments[0].id,
      columns: [
        { id: "title", name: "事项", type: "text", required: true },
        { id: "secret", name: "内部金额", type: "number" },
      ],
    },
    201,
  )
).id;
await admin(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "管理员记录", secret: 150 } },
  201,
);
await editor(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "本人记录", secret: 250 } },
  201,
);
await send([
  await change(members.editor, {
    role: "viewer",
    table_ids: [table],
    hidden_columns: ["secret"],
    row_scope: "own",
    can_export: false,
  }),
]);
const rows = await editor(`/tables/${table}/records`);
assert.equal(rows.total, 1);
assert.equal(rows.rows[0].data.title, "本人记录");
assert.equal(rows.rows[0].data.secret, undefined);
await editor(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "拒绝写入" } },
  403,
);
await editor(`/tables/${table}/export`, "GET", undefined, 403);
const oldGrant = await current(members.editor);
const request = (
  await editor(
    `/projects/${project}/approvals`,
    "POST",
    { kind: "access", title: "申请调整录入权限", payload: { role: "editor" } },
    201,
  )
).id;
await admin(`/approvals/${request}/decide`, "POST", { action: "approve" });
const approvedGrant = await current(members.editor);
assert.equal(approvedGrant.role, "editor");
assert.notEqual(approvedGrant.revision, oldGrant.revision);
await send(
  [
    {
      user_id: members.editor,
      expected_revision: oldGrant.revision,
      grant: { role: "viewer" },
    },
  ],
  409,
);
await editor(
  `/tables/${table}/records`,
  "POST",
  { data: { title: "审批后可写入" } },
  201,
);
console.log(
  "PASS live row/column/write/export restrictions and approval grant revisions prevent stale matrix overwrite",
);

const objects = await admin(`/objects/workspaces/${workspace}/projects`),
  p = objects.find((p) => p.id === project);
await admin(`/objects/project/${project}`, "PATCH", {
  version: p.object_version,
  lifecycle: "frozen",
});
await send([await change(members.editor, null)], 409);
assert.equal((await current(members.editor)).role, "editor");
const frozen = (await admin(`/objects/workspaces/${workspace}/projects`)).find(
  (p) => p.id === project,
);
await admin(`/objects/project/${project}`, "PATCH", {
  version: frozen.object_version,
  lifecycle: "active",
});
await send([
  await change(members.viewer, {
    role: "viewer",
    expires_at: new Date(Date.now() + 1500).toISOString(),
  }),
]);
await viewer(`/projects/${project}/context`);
await new Promise((r) => setTimeout(r, 1600));
await viewer(`/projects/${project}/context`, "GET", undefined, 403);
console.log(
  "PASS frozen project rejects matrix changes and temporary membership expires on the next request",
);

const users = () => admin(`/workspaces/${workspace}/users`),
  account = async () => (await users()).find((u) => u.id === members.editor);
const accountBefore = await account();
await admin(`/workspaces/${workspace}/users/${members.editor}`, "PATCH", {
  name: "表内修改姓名",
  expected_revision: accountBefore.revision,
});
assert.equal((await account()).name, "表内修改姓名");
await editor("/bootstrap");
await admin(
  `/workspaces/${workspace}/users/${members.editor}`,
  "PATCH",
  { name: "旧版本姓名", expected_revision: accountBefore.revision },
  409,
);
await editor(
  `/workspaces/${workspace}/users/${members.viewer}`,
  "PATCH",
  { name: "越权编辑" },
  403,
);
await admin(
  `/workspaces/${workspace}/users/${owner.user_id}`,
  "PATCH",
  { name: "修改自己" },
  400,
);
await admin(`/workspaces/${workspace}/users/${members.editor}`, "PATCH", {
  active: false,
  expected_revision: (await account()).revision,
});
await editor("/bootstrap", "GET", undefined, 401);
await admin(`/workspaces/${workspace}/users/${members.editor}`, "PATCH", {
  active: true,
  expected_revision: (await account()).revision,
});
await editor("/login", "POST", logins.editor);
await editor("/bootstrap");
const audits = await admin(`/workspaces/${workspace}/audit`);
assert.ok(audits.some((a) => a.action === "修改账号姓名"));
assert.ok(
  audits.some(
    (a) => a.action === "权限表配置授权" && a.details?.project_id === project,
  ),
);
console.log(
  "PASS inline account name/status revisions, permission checks, session invalidation and grant audit evidence",
);
manifest.matrix = { project, users: members };
await save();
if (process.argv.includes("--keep-browser")) {
  console.log(`BROWSER_WORKSPACE QA集成验证 ${tag}`);
  process.exit(0);
}
const cleanup = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`], {
  encoding: "utf8",
});
assert.equal(cleanup.status, 0, cleanup.stderr);
console.log(cleanup.stdout.trim());
