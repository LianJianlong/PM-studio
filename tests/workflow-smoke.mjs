import fs from "node:fs/promises";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).replace(/^\uFEFF/, ""), line.slice(i + 1)];
    }),
);
const tag = Date.now().toString(36),
  password = "Workflow-QA-2026!";
function client() {
  let cookie = "";
  return async (path, method = "GET", body, expected = 200) => {
    const response = await fetch("http://localhost:9090/api" + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    if (response.status !== expected)
      throw Error(
        `${method} ${path}: ${response.status} ${await response.text()}`,
      );
    return response.headers.get("content-type")?.includes("json")
      ? response.json()
      : response;
  };
}
const admin = client(),
  first = client(),
  second = client();
await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const workspace = (
  await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
).id;
const manifest = { workspace, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
async function user(label) {
  const username = `qa_${tag}_${label}`;
  const result = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, name: `流程${label}`, password },
    201,
  );
  manifest.users.push(result.id);
  await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
  return { ...result, username };
}
const one = await user("one"),
  two = await user("two"),
  writer = await user("writer");
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "多节点流程验证", start_date: "2026-09-01" },
    201,
  )
).id;
const context = await admin(`/projects/${project}/context`),
  department = context.departments[0].id;
const table = (
  await admin(
    `/projects/${project}/tables`,
    "POST",
    {
      name: "流程台账",
      department_id: department,
      columns: [{ id: "title", name: "事项", type: "text", required: true }],
    },
    201,
  )
).id;
for (const [u, role] of [
  [one, "reviewer"],
  [two, "reviewer"],
  [writer, "editor"],
])
  await admin(`/projects/${project}/members/${u.id}`, "PUT", { role });
await first("/login", "POST", { username: one.username, password });
await second("/login", "POST", { username: two.username, password });
await client()("/login", "POST", { username: writer.username, password });
const writerClient = client();
await writerClient("/login", "POST", { username: writer.username, password });
const workflow = (
  await admin(
    `/projects/${project}/workflows`,
    "POST",
    {
      kind: "record",
      name: "两级质量复核",
      steps: [
        { name: "部门复核", approver_id: one.id, mode: "one" },
        { name: "项目复核", approver_id: two.id, mode: "one" },
      ],
    },
    201,
  )
).id;
const record = (
  await writerClient(
    `/tables/${table}/records`,
    "POST",
    { data: { title: "多节点测试记录" } },
    201,
  )
).id;
const approval = (
  await writerClient(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "record",
      title: "两级质量复核",
      record_id: record,
      workflow_id: workflow,
    },
    201,
  )
).id;
let pending = (await admin(`/projects/${project}/approvals`)).find(
  (a) => a.id === approval,
);
assert.equal(pending.approver_id, one.id);
assert.equal(pending.status, "pending");
await first(`/approvals/${approval}/decide`, "POST", {
  action: "approve",
  opinion: "部门意见保留",
});
pending = (await admin(`/projects/${project}/approvals`)).find(
  (a) => a.id === approval,
);
assert.equal(pending.approver_id, two.id);
assert.equal(pending.status, "pending");
assert.equal(
  (await writerClient(`/projects/${project}/summary`)).counts.approved,
  0,
);
await second(`/approvals/${approval}/decide`, "POST", {
  action: "approve",
  opinion: "项目最终确认",
});
assert.equal(
  (await writerClient(`/projects/${project}/summary`)).counts.approved,
  1,
);
console.log(
  "PASS versioned two-node record workflow, node transition, requester notification boundary and final activation",
);
const cleanup = await import("node:child_process");
let history = await first(`/approvals/${approval}/history`);
assert.deepEqual(
  history.events.map((e) => e.action),
  ["submit", "approve", "approve"],
);
assert.equal(history.events[1].opinion, "部门意见保留");
assert.equal(history.events[2].opinion, "项目最终确认");
assert(
  (await first(`/projects/${project}/approvals`)).some(
    (a) => a.id === approval,
  ),
);
await second(
  `/approvals/${approval}/decide`,
  "POST",
  { action: "approve" },
  409,
);
const ownBoot = await admin("/bootstrap");
const steps = [
  { name: "部门复核", approver_id: one.id },
  { name: "项目复核", approver_id: two.id },
];
async function publish(
  kind = "record",
  custom = steps,
  by = admin,
  expected = 201,
) {
  return by(
    `/projects/${project}/workflows`,
    "POST",
    { kind, name: `${kind}验证流程`, steps: custom },
    expected,
  );
}
async function draft() {
  return (
    await writerClient(
      `/tables/${table}/records`,
      "POST",
      { data: { title: "权限与流程回归" } },
      201,
    )
  ).id;
}
async function submit(recordId, expected = 201, by = writerClient, extra = {}) {
  return by(
    `/projects/${project}/approvals`,
    "POST",
    { kind: "record", title: "流程边界检查", record_id: recordId, ...extra },
    expected,
  );
}
await publish("record", [{ ...steps[0], mode: "all" }, steps[1]], admin, 400);
const locked = await draft();
await admin(`/projects/${project}/members/${writer.id}`, "PUT", {
  role: "viewer",
});
await submit(locked, 403);
await admin(`/projects/${project}/members/${writer.id}`, "PUT", {
  role: "editor",
});
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "reviewer",
  hidden_columns: ["title"],
});
await submit(locked, 403);
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "reviewer",
});
const lockedApproval = (await submit(locked)).id;
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "viewer",
});
await first(
  `/approvals/${lockedApproval}/decide`,
  "POST",
  { action: "approve", opinion: "不可落库" },
  403,
);
assert.equal(
  (await first(`/approvals/${lockedApproval}/history`)).events.length,
  1,
);
await writerClient(`/approvals/${lockedApproval}/decide`, "POST", {
  action: "withdraw",
});
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "reviewer",
});
console.log(
  "PASS requester write permission, downstream column and role checks, rollback and withdrawal",
);
const oldRecord = await draft(),
  oldApproval = (await submit(oldRecord)).id;
const published = await publish();
await first(`/approvals/${oldApproval}/decide`, "POST", { action: "approve" });
history = await first(`/approvals/${oldApproval}/history`);
assert.equal(history.flow.name, "两级质量复核");
await second(`/approvals/${oldApproval}/decide`, "POST", {
  action: "reject",
  opinion: "待补充依据",
});
assert.equal(
  (await first(`/approvals/${oldApproval}/history`)).events.at(-1).opinion,
  "待补充依据",
);
const newRecord = await draft();
await submit(newRecord, 409, writerClient, { workflow_id: workflow });
const forced = (
  await submit(newRecord, 201, writerClient, { approver_id: two.id })
).id;
assert.equal(
  (await admin(`/projects/${project}/approvals`)).find((a) => a.id === forced)
    .approver_id,
  one.id,
);
await first(`/approvals/${forced}/decide`, "POST", { action: "approve" });
const outcomes = await Promise.allSettled([
  second(`/approvals/${forced}/decide`, "POST", { action: "approve" }),
  second(`/approvals/${forced}/decide`, "POST", { action: "approve" }),
]);
assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
assert.equal(
  (await first(`/approvals/${forced}/history`)).events.filter(
    (e) => e.action === "approve",
  ).length,
  2,
);
await admin(`/projects/${project}/members/${one.id}`, "PUT", {
  role: "reviewer",
  hidden_columns: ["title"],
});
await first(`/approvals/${forced}/history`, "GET", undefined, 403);
await admin(`/projects/${project}/members/${one.id}`, "PUT", {
  role: "reviewer",
});
await admin(`/projects/${project}/members/${writer.id}`, "PUT", {
  role: "manager",
});
await publish("record", [
  steps[0],
  { name: "申请人节点", approver_id: writer.id },
]);
await submit(await draft(), 400);
await publish("access", steps, writerClient, 403);
await publish("record", steps);
console.log(
  "PASS immutable workflow snapshot, enforced active chain, concurrent final approval and former reviewer scope",
);
await admin(`/projects/${project}/members/${one.id}`, "PUT", {
  role: "manager",
});
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "manager",
});
await publish("stage");
await admin(`/projects/${project}/members/${writer.id}`, "PUT", {
  role: "viewer",
});
await writerClient(
  `/projects/${project}/approvals`,
  "POST",
  {
    kind: "stage",
    title: "非法阶段",
    payload: {
      engineering_stage: "启动",
      business_stage: "计划",
      reason: "测试",
    },
  },
  403,
);
await admin(`/projects/${project}/members/${writer.id}`, "PUT", {
  role: "manager",
});
await writerClient(
  `/projects/${project}/approvals`,
  "POST",
  {
    kind: "stage",
    title: "非法阶段",
    payload: {
      engineering_stage: "不存在",
      business_stage: "计划",
      reason: "测试",
    },
  },
  400,
);
const beforeStage = (await admin(`/projects/${project}/summary`)).project;
const stageAp = (
  await writerClient(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "stage",
      title: "正式阶段",
      payload: {
        engineering_stage: "启动",
        business_stage: "计划",
        reason: "流程验证",
        previous: { engineering_stage: "伪造" },
      },
    },
    201,
  )
).id;
await first(`/approvals/${stageAp}/decide`, "POST", { action: "approve" });
assert.equal(
  (await admin(`/projects/${project}/summary`)).project.engineering_stage,
  beforeStage.engineering_stage,
);
await second(`/approvals/${stageAp}/decide`, "POST", { action: "approve" });
assert.equal(
  (await admin(`/projects/${project}/summary`)).project.engineering_stage,
  "启动",
);
await publish("baseline");
await admin(
  `/projects/${project}/activities`,
  "POST",
  { code: "L.10", name: "后作业", duration: 6, progress: 0 },
  201,
);
await admin(
  `/projects/${project}/activities`,
  "POST",
  { code: "L.2", name: "前作业", duration: 4, progress: 0 },
  201,
);
const plan = await admin(`/projects/${project}/plan`);
assert.deepEqual(
  plan.activities.map((a) => a.code),
  ["L.2", "L.10"],
);
const baseline = (
  await writerClient(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "baseline",
      title: "两级基线",
      payload: { duration: 999, activities: [] },
    },
    201,
  )
).id;
await first(`/approvals/${baseline}/decide`, "POST", { action: "approve" });
assert.equal((await admin(`/projects/${project}/plan`)).baselines.length, 0);
await second(`/approvals/${baseline}/decide`, "POST", { action: "approve" });
assert.equal(
  (await admin(`/projects/${project}/plan`)).baselines[0].snapshot.duration,
  6,
);
assert.equal(
  (await admin(`/projects/${project}/plan`)).baselines[0].snapshot._workflow,
  undefined,
);
console.log(
  "PASS stage and baseline validation, final-only effects, server-calculated baseline and alphanumeric WBS sort",
);
const versions = await Promise.all([publish(), publish()]);
assert.equal(Math.abs(versions[0].version - versions[1].version), 1);
assert.equal(
  (await admin(`/projects/${project}/workflows`)).filter(
    (w) => w.kind === "record" && w.active,
  ).length,
  1,
);
const live = (await admin(`/projects/${project}/workflows`)).find(
  (w) => w.kind === "record" && w.active,
);
await admin(`/workflows/${live.id}`, "PATCH", { active: false });
await submit(await draft(), 400);
console.log("PASS concurrent version publication and workflow deactivation");
// Manager UI relies on the existing server boundary and active context projection.
for (const kind of ["record", "stage", "baseline"]) {
  const managed = await writerClient(
    `/projects/${project}/workflows`,
    "POST",
    {
      kind,
      name: `经理配置-${kind}`,
      steps: [
        { name: "初审", approver_id: one.id, mode: "one" },
        { name: "终审", approver_id: two.id, mode: "one" },
      ],
    },
    201,
  );
  await writerClient(`/workflows/${managed.id}`, "PATCH", { active: false });
}
await writerClient(
  `/projects/${project}/workflows`,
  "POST",
  {
    kind: "access",
    name: "越权权限流程",
    steps: [
      { name: "初审", approver_id: one.id, mode: "one" },
      { name: "终审", approver_id: two.id, mode: "one" },
    ],
  },
  403,
);
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "manager",
  expires_at: new Date(Date.now() + 2000).toISOString(),
});
await new Promise(resolve => setTimeout(resolve, 2100));
assert.ok(
  !(await writerClient(`/projects/${project}/context`)).users.some(
    (u) => u.id === two.id,
  ),
);
await admin(`/projects/${project}/members/${two.id}`, "PUT", {
  role: "manager",
});
console.log(
  "PASS manager three workflow kinds, access workflow denial and expired candidate exclusion",
);
if (process.argv.includes("--keep-browser")) {
  await publish();
  await fs.writeFile(
    "work/qa/workflow-browser.json",
    JSON.stringify({
      workspace,
      project,
      table,
      username: writer.username,
      password,
    }),
  );
  console.log("RETAINED isolated fixture for browser QA");
  process.exit(0);
}
const result = cleanup.spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`], {
  encoding: "utf8",
});
if (result.status !== 0) throw Error(result.stderr);
console.log(result.stdout.trim());
