import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const split = line.indexOf("=");
      return [
        line.slice(0, split).replace(/^\uFEFF/, ""),
        line.slice(split + 1),
      ];
    }),
);
const tag = Date.now().toString(36);
function client() {
  let cookie = "";
  return async (path, method = "GET", body, expected = 200) => {
    const response = await fetch(`http://localhost:9090/api${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) cookie = nextCookie.split(";")[0];
    const data = await response.json();
    if (expected !== null)
      assert.equal(
        response.status,
        expected,
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
    return expected === null ? { status: response.status, data } : data;
  };
}

const admin = client();
const proposer = client();
const reviewer = client();
const manager = client();
const outsider = client();
const adminUser = await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const workspace = (
  await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
).id;
const manifest = { workspace, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
const manifestFile = `work/qa/fixtures-${tag}.json`;
const saveManifest = () => fs.writeFile(manifestFile, JSON.stringify(manifest));
await saveManifest();
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "业主事项流转", start_date: "2026-09-01" },
    201,
  )
).id;
const otherProject = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "隔离项目", start_date: "2026-09-01" },
    201,
  )
).id;

async function addUser(label, role, api, targetProject = project) {
  const username = `qa_${tag}_${manifest.users.length}`;
  const password = crypto.randomBytes(16).toString("hex");
  const user = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, name: `事项${label}`, password },
    201,
  );
  manifest.users.push(user.id);
  await saveManifest();
  await admin(`/projects/${targetProject}/members/${user.id}`, "PUT", {
    role,
    can_export: false,
  });
  await api("/login", "POST", { username, password });
  return user.id;
}

const proposerId = await addUser("提出人", "editor", proposer);
const reviewerId = await addUser("审核人", "reviewer", reviewer);
const managerId = await addUser("批复人", "manager", manager);
await addUser("隔离成员", "viewer", outsider, otherProject);

const base = {
  title: "码头设计变更确认",
  content: "请确认设计变更范围、费用边界与实施窗口。",
  reviewer_id: reviewerId,
  approver_id: managerId,
};
await admin(`/projects/${project}/owner-items`, "POST", base, 201);
await reviewer(
  `/projects/${project}/owner-items`,
  "POST",
  { ...base, reviewer_id: reviewerId, approver_id: adminUser.id },
  403,
);
await proposer(`/projects/${project}/owner-items`, 'POST', {...base,reviewer_id:proposerId},400);
const created = await proposer(
  `/projects/${project}/owner-items`,
  "POST",
  base,
  201,
);
assert.equal(created.status, "draft");
assert.equal(created.version, 1);
await outsider(`/projects/${project}/owner-items`, "GET", undefined, 403);
await outsider(`/owner-items/${created.id}`, "GET", undefined, 403);
await manager(
  `/owner-items/${created.id}/actions`,
  "POST",
  { action: "approve", version: 1, opinion: "越过审核" },
  403,
);

const frozenProject = (
  await admin(`/objects/workspaces/${workspace}/projects`)
).find((row) => row.id === project);
await admin(`/objects/project/${project}`, "PATCH", {
  version: frozenProject.object_version,
  lifecycle: "frozen",
});
await proposer(
  `/owner-items/${created.id}/actions`,
  "POST",
  { action: "submit", version: 1, opinion: "" },
  409,
);
await admin(`/objects/project/${project}`, "PATCH", {
  version: frozenProject.object_version + 1,
  lifecycle: "active",
});

const concurrent = await Promise.all([
  proposer(
    `/owner-items/${created.id}/actions`,
    "POST",
    { action: "submit", version: 1, opinion: "" },
    null,
  ),
  proposer(
    `/owner-items/${created.id}/actions`,
    "POST",
    { action: "submit", version: 1, opinion: "" },
    null,
  ),
]);
assert.deepEqual(
  concurrent.map((result) => result.status).sort((a, b) => a - b),
  [200, 409],
);
let item = await proposer(`/owner-items/${created.id}`);
assert.equal(item.status, "submitted");
assert.equal(item.version, 2);
assert.deepEqual(item.allowed_actions.sort(), ["view", "withdraw"]);
await proposer(
  `/owner-items/${created.id}`,
  "PATCH",
  { ...base, version: 2 },
  409,
);
await manager(
  `/owner-items/${created.id}/actions`,
  "POST",
  { action: "review", version: 2, opinion: "非指定审核人" },
  403,
);
await reviewer(
  `/owner-items/${created.id}/actions`,
  "POST",
  { action: "approve", version: 2, opinion: "顺序错误" },
  403,
);
await reviewer(`/owner-items/${created.id}/actions`, "POST", {
  action: "review",
  version: 2,
  opinion: "范围与技术条件已核对",
});
item = await manager(`/owner-items/${created.id}`);
assert.equal(item.status, "reviewed");
assert(item.allowed_actions.includes("approve"));
await manager(
  `/owner-items/${created.id}/actions`,
  "POST",
  { action: "approve", version: 2, opinion: "过期版本" },
  409,
);
await manager(`/owner-items/${created.id}/actions`, "POST", {
  action: "approve",
  version: 3,
  opinion: "同意按审核意见实施",
});
item = await proposer(`/owner-items/${created.id}`);
assert.equal(item.status, "approved");
assert.deepEqual(item.allowed_actions, ["view"]);
assert.deepEqual(
  item.history.map((event) => event.action),
  ["create", "submit", "review", "approve"],
);
assert.equal(item.history[2].opinion, "范围与技术条件已核对");
assert.equal(item.history[3].opinion, "同意按审核意见实施");
assert.deepEqual(
  item.history.map((event) => event.version),
  [1, 2, 3, 4],
);
await proposer(
  `/owner-items/${created.id}`,
  "PATCH",
  { ...base, version: 4 },
  409,
);
await reviewer(
  `/owner-items/${created.id}/actions`,
  "POST",
  { action: "reject", version: 4, opinion: "不得改写终态" },
  403,
);

const rejected = await proposer(
  `/projects/${project}/owner-items`,
  "POST",
  { ...base, title: "退回路径" },
  201,
);
await proposer(`/owner-items/${rejected.id}/actions`, "POST", {
  action: "submit",
  version: 1,
  opinion: "",
});
await reviewer(`/owner-items/${rejected.id}/actions`, "POST", {
  action: "reject",
  version: 2,
  opinion: "资料不完整，请重新提出",
});
assert.equal(
  (await proposer(`/owner-items/${rejected.id}`)).status,
  "rejected",
);
await proposer(`/owner-items/${rejected.id}/actions`, "POST", {
  action: "reopen",
  version: 3,
});
await proposer(`/owner-items/${rejected.id}`, "PATCH", {
  ...base,
  title: "修订后重新提交",
  version: 4,
});
await proposer(`/owner-items/${rejected.id}/actions`, "POST", {
  action: "submit",
  version: 5,
});
assert.equal(
  (await proposer(`/owner-items/${rejected.id}`)).status,
  "submitted",
);
const withdrawn = await proposer(
  `/projects/${project}/owner-items`,
  "POST",
  { ...base, title: "撤回路径" },
  201,
);
await proposer(`/owner-items/${withdrawn.id}/actions`, "POST", {
  action: "withdraw",
  version: 1,
  opinion: "",
});
assert.equal(
  (await proposer(`/owner-items/${withdrawn.id}`)).status,
  "withdrawn",
);
await proposer(`/owner-items/${withdrawn.id}/actions`, "POST", {
  action: "reopen",
  version: 2,
});
assert.equal((await proposer(`/owner-items/${withdrawn.id}`)).status, "draft");

const reviewerNotices = await reviewer("/notifications");
assert(
  reviewerNotices.items.some((notice) => notice.resource_id === created.id),
);
assert(
  reviewerNotices.items.some(
    (notice) =>
      notice.resource_id === created.id && notice.kind === "owner_item",
  ),
);
const managerNotices = await manager("/notifications");
assert(
  managerNotices.items.some((notice) => notice.resource_id === created.id),
);
const proposerNotices = await proposer("/notifications");
assert(
  proposerNotices.items.some((notice) => notice.resource_id === created.id),
);
console.log(
  "PASS owner items authorization, ordered workflow, optimistic concurrency and lifecycle guard",
);
console.log(
  "PASS immutable approval, opinions/history, notifications and project isolation",
);

if (process.argv.includes("--keep-browser")) {
  await fs.writeFile(
    "work/qa/owner-browser.json",
    JSON.stringify({ workspace, project, tag }),
  );
  console.log("RETAINED isolated owner fixture for browser QA");
  process.exit(0);
}
const sql = `BEGIN;
DELETE FROM owner_item_events WHERE item_id IN(SELECT id FROM owner_items WHERE project_id IN(SELECT id FROM projects WHERE workspace_id='${workspace}'::uuid));
DELETE FROM owner_items WHERE project_id IN(SELECT id FROM projects WHERE workspace_id='${workspace}'::uuid);
COMMIT;`;
const purge = spawnSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "studio",
    "-d",
    "project_studio",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
  ],
  { input: sql, encoding: "utf8" },
);
assert.equal(purge.status, 0, purge.stderr);
const cleanup = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`], {
  encoding: "utf8",
});
assert.equal(cleanup.status, 0, cleanup.stderr);
console.log(cleanup.stdout.trim());
