import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const password = crypto.randomBytes(18).toString("hex"),
  adminPassword = (await fs.readFile(".env", "utf8"))
    .match(/^ADMIN_PASSWORD=(.*)$/m)[1]
    .trim(),
  tag = "planning" + Date.now().toString(36);
function client() {
  let cookie = "";
  return async (path, method = "GET", body, status = 200) => {
    const r = await fetch("http://127.0.0.1:9090/api" + path, {
      method,
      headers: {
        cookie,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal(
      r.status,
      status,
      `${method} ${path}: ${r.status !== status ? await r.text() : ""}`,
    );
    return r.json();
  };
}
const admin = client(),
  viewer = client(),
  manager = client();
await admin("/login", "POST", { username: "admin", password: adminPassword });
const workspace = (
    await admin("/workspaces", "POST", { name: "QA集成验证 " + tag }, 201)
  ).id,
  manifestName = "fixtures-" + tag + ".json",
  manifest = { workspace, tag, users: [] };
const save = () =>
  fs.writeFile("work/qa/" + manifestName, JSON.stringify(manifest));
await save();
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "计划工作台联调验收", start_date: "2026-10-05" },
    201,
  )
).id;
const users = {};
for (const [role, c] of [
  ["viewer", viewer],
  ["manager", manager],
]) {
  const u = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username: `qa_${tag}_${role}`, name: role, password },
    201,
  );
  users[role] = u.id;
  manifest.users.push(u.id);
  await save();
  await admin(`/projects/${project}/members/${u.id}`, "PUT", { role });
  await c("/login", "POST", { username: `qa_${tag}_${role}`, password });
}
await viewer(`/projects/${project}/planning-tables/wbs`, "POST", {}, 403);
const wbs = (
    await admin(`/projects/${project}/planning-tables/wbs`, "POST", {})
  ).id,
  org = (
    await admin(`/projects/${project}/planning-tables/organization`, "POST", {})
  ).id;
assert.equal(
  (await admin(`/projects/${project}/planning-tables/wbs`, "POST", {})).id,
  wbs,
);
for (const table of [wbs, org]) {
  const root = (
      await admin(
        `/tables/${table}/records`,
        "POST",
        { data: { code: "1", name: "项目根节点", owner: "项目经理" } },
        201,
      )
    ).id,
    child = (
      await admin(
        `/tables/${table}/records`,
        "POST",
        { data: { code: "1.1", name: "施工分部", parent: [root] } },
        201,
      )
    ).id;
  await admin(
    `/tables/${table}/records`,
    "POST",
    { data: { code: "1", name: "重复编码" } },
    409,
  );
  const r = (await admin(`/tables/${table}/records`)).rows.find(
    (r) => r.id === root,
  );
  await admin(
    `/records/${root}`,
    "PUT",
    { version: r.version, data: { parent: [child] } },
    409,
  );
  await admin(`/tables/${table}/columns`, "POST", {
    id: "formula",
    name: "计算列",
    type: "formula",
    formula: "1 + 2",
  });
  assert.equal(
    (await admin(`/tables/${table}/records`)).rows[0].data.formula,
    "3",
  );
  await viewer(
    `/tables/${table}/records`,
    "POST",
    { data: { code: "2", name: "越权" } },
    403,
  );
}
console.log(
  "PASS WBS and organization native CRUD, formula fields, unique codes, hierarchy cycles, viewer restrictions and idempotent enable",
);
const table = (await admin(`/projects/${project}/plan-table`, "POST", {})).id;
assert.ok(
  (await admin(`/projects/${project}/plan`)).table.columns.some(
    (f) => f.id === "wbs" && f.target_table === wbs,
  ),
);
const ids = [];
for (let i = 0; i < 6; i++)
  ids.push(
    (
      await admin(
        `/projects/${project}/activities`,
        "POST",
        {
          code: "A" + (i + 1),
          name: [
            "土方开挖",
            "基础施工",
            "结构施工",
            "拖拽作业一",
            "拖拽作业二",
            "拖拽作业三",
          ][i],
          duration: i === 0 ? 2 : 3,
          progress: 0,
        },
        201,
      )
    ).id,
  );
const plan = () => admin(`/projects/${project}/plan`);
const nativeTable = (await admin(`/projects/${project}/plan-table`, 'POST', {})).id;
assert.equal(await admin(`/tables/${wbs}/plan-relations`), null);
let context = await admin(`/tables/${nativeTable}/plan-relations`);
assert.equal(context.project_id, project);
assert.equal(context.activities.length, 6);
assert.ok(context.activities.every(a=>a.record_id && a.custom_editable));
assert.ok((await viewer(`/tables/${nativeTable}/plan-relations`)).activities.every(a=>!a.custom_editable));
const link = async (
  p,
  n,
  type = "FS",
  lag = 0,
  remove = false,
  c = admin,
  status = 200,
) => {
  const a = (await plan()).activities.find((a) => a.id === n);
  return c(
    `/projects/${project}/dependencies`,
    "POST",
    { predecessor: p, successor: n, type, lag, remove, version: a.version },
    status,
  );
};
for (const type of ["FS", "SS", "FF", "SF"]) {
  await link(ids[0], ids[1], type, 1);
  assert.equal(
    (await plan()).activities.find((a) => a.id === ids[1]).predecessors[0].type,
    type,
  );
}
await link(ids[0], ids[1], "FS", 0);
await link(ids[0],ids[2],'SS',-2);
await link(ids[1],ids[2],'FF',3);
context = await admin(`/tables/${nativeTable}/plan-relations`);
const related = context.activities.find(a=>a.id===ids[2]);
assert.deepEqual(related.predecessors.map(e=>[e.type,e.lag]),[['SS',-2],['FF',3]]);
assert.equal(related.version,(await plan()).activities.find(a=>a.id===ids[2]).version);
await link(ids[0],ids[2],'SS',-2,true);
await link(ids[1],ids[2],'FF',3,true);
console.log('PASS native relation context, read-only role, multiple relations and signed working-day offsets');
await link(ids[1], ids[0], "FS", 0, false, admin, 400);
await link(ids[0], ids[0], "FS", 0, false, admin, 400);
await link(ids[0], ids[2], "FS", 0, false, viewer, 403);
await admin(
  `/projects/${project}/dependencies`,
  "POST",
  { predecessor: ids[0], successor: ids[1], type: "FS", lag: 0, version: 1 },
  409,
);
console.log(
  "PASS FS SS FF SF relationship persistence, cycle/self-edge validation, version conflicts and viewer denial",
);
let cal = await admin(`/projects/${project}/calendar`);
assert.equal(cal.config.name, "自然日");
const config = {
  name: "项目五天八小时",
  week: [
    [],
    ...Array.from({ length: 5 }, () => [
      ["08:00", "12:00"],
      ["13:00", "17:00"],
    ]),
    [],
  ],
  exceptions: { "2026-10-05": [] },
  hours_per_day: 8,
  hours_per_week: 40,
  hours_per_month: 172,
  hours_per_year: 2080,
};
await admin(`/projects/${project}/calendar`, "PUT", {
  version: cal.version,
  config,
});
await admin(
  `/projects/${project}/calendar`,
  "PUT",
  { version: cal.version, config },
  409,
);
cal = await admin(`/projects/${project}/calendar`);
await viewer(
  `/projects/${project}/calendar`,
  "PUT",
  { version: cal.version, config },
  403,
);
await admin(
  `/projects/${project}/calendar`,
  "PUT",
  {
    version: cal.version,
    config: { ...config, week: Array.from({ length: 7 }, () => []) },
  },
  400,
);
const scheduled = await plan();
assert.equal(scheduled.calendar, config.name);
assert.equal(scheduled.activities[0].es, 1 + 8 / 24);
assert.equal(scheduled.activities[1].ef, 7 + 17 / 24);
console.log(
  "PASS calendar standard shifts, holiday/weekend scheduling, stale versions and restricted edits",
);
const resource = (
  await admin(
    `/projects/${project}/resources`,
    "POST",
    {
      name: "施工班组",
      kind: "human",
      unit: "人日",
      rate: "100.1234",
      capacity: "1",
      productivity: "2.5",
      configuration: "8人，机械配合",
    },
    201,
  )
).id;
let r = (await admin(`/projects/${project}/resources`)).find(
  (r) => r.id === resource,
);
assert.equal(r.productivity, "2.5000");
await admin(`/projects/${project}/resources/${resource}`, "PUT", {
  ...r,
  name: "施工班组调整",
  version: r.version,
});
await admin(
  `/projects/${project}/resources/${resource}`,
  "PUT",
  { ...r, version: r.version },
  409,
);
await admin(
  `/activities/${ids[1]}/resources`,
  "POST",
  {
    resource_id: resource,
    quantity: "10.0001",
    planned_cost: "100.0001",
    actual_cost: "90.0001",
  },
  201,
);
await admin(`/projects/${project}/resources/${resource}`, "DELETE", {}, 409);
const load = (await admin(`/projects/${project}/resource-load`)).resources.find(
  (r) => r.id === resource,
);
assert.deepEqual(
  load.curve.map((d) => d.date),
  ["2026-10-08", "2026-10-09", "2026-10-12"],
);
for (const key of ["quantity", "planned_cost", "actual_cost"])
  assert.equal(
    load.curve.reduce((n, d) => n + BigInt(d[key].replace(".", "")), 0n),
    BigInt(load.allocations[0][key].replace(".", "")),
  );
console.log(
  "PASS resource productivity/configuration, guarded edits/deletion and exact work-date quantity/cost distributions",
);
const target = (await plan()).activities.find((a) => a.id === ids[2]);
const ap = (
  await admin(
    `/projects/${project}/approvals`,
    "POST",
    {
      kind: "record",
      title: "图形修改锁定验证",
      record_id: target.record_id,
      approver_id: users.manager,
    },
    201,
  )
).id;
await link(ids[0], ids[2], "FS", 0, false, admin, 409);
assert.equal(
  (await plan()).activities.find((a) => a.id === ids[2]).version,
  target.version,
);
assert.deepEqual(
  (await plan()).activities.find((a) => a.id === ids[2]).predecessors,
  [],
);
await manager(`/approvals/${ap}/decide`, "POST", {
  action: "approve",
  opinion: "通过",
});
await admin(`/projects/${project}/members/${users.viewer}`, "PUT", {
  role: "viewer",
  hidden_columns: ["owner"],
});
assert.ok(
  !(
    await viewer(`/projects/${project}/planning-tables/wbs`)
  ).table.columns.some((f) => f.id === "owner"),
);
console.log(
  "PASS graphical relationship updates honor native record approval locks and hierarchy metadata honors hidden columns",
);
if (process.argv.includes("--keep-browser")) {
  await fs.writeFile(
    "work/qa/planning-workbench-browser.json",
    JSON.stringify({
      workspace,
      project,
      wbs,
      org,
      table,
      ids,
      resource,
      manifestName,
    }),
  );
  console.log("RETAINED planning workbench fixture");
} else {
  const r = spawnSync(
    process.execPath,
    ["tests/cleanup-fixtures.mjs", "--manifest=" + manifestName],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  console.log(r.stdout.trim());
}

