import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const tag = "p1p2" + Date.now().toString(36),
  manifest = "fixtures-" + tag + ".json",
  users = [];
function client() {
  let cookie = "";
  return async (path, method = "GET", body, status = 200) => {
    const r = await fetch("http://127.0.0.1:9090/api" + path, {
      method,
      headers: { cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const data = r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer());
    assert.equal(
      r.status,
      status,
      path + " " + (r.status === status ? "" : JSON.stringify(data)),
    );
    return data;
  };
}
const admin = client(),
  system = client(),
  editor = client(),
  viewer = client();
for (const [c, username] of [
  [admin, "admin"],
  [system, "superadmin"],
])
  await c("/login", "POST", {
    username,
    password: process.env.QA_ADMIN_PASSWORD,
  });
const workspace = (
  await admin("/workspaces", "POST", { name: "QA集成验证 " + tag }, 201)
).id;
await fs.mkdir("work/qa", { recursive: true });
const save = () =>
  fs.writeFile(
    "work/qa/" + manifest,
    JSON.stringify({ workspace, tag, users }),
  );
await save();
try {
  const project = (
      await admin(
        `/workspaces/${workspace}/projects`,
        "POST",
        { name: "P1P2整改验收", start_date: "2026-10-06" },
        201,
      )
    ).id,
    context = await admin(`/projects/${project}/context`),
    me = (await admin("/bootstrap")).user.id;
  assert.ok(
    (await system("/bootstrap")).workspaces.some((w) => w.id === workspace),
  );
  await system(`/workspaces/${workspace}/ai-configs`);
  assert.ok(
    (await system("/objects/workspaces")).some((w) => w.id === workspace),
  );
  assert.ok(
    (await system(`/objects/workspaces/${workspace}/projects`)).some(
      (p) => p.id === project,
    ),
  );
  console.log(
    "PASS superadmin sees and manages new workspaces without explicit membership",
  );
  const password = "Temporary-" + tag + "123!",
    ids = {};
  for (const [role, c] of [
    ["editor", editor],
    ["viewer", viewer],
    ["reviewer", null],
  ]) {
    const username = "qa_" + tag + "_" + role,
      u = (
        await admin(
          `/workspaces/${workspace}/users`,
          "POST",
          { username, name: "整改" + role, password },
          201,
        )
      ).id;
    ids[role] = u;
    users.push(u);
    await save();
    await admin(`/projects/${project}/members/${u}`, "PUT", { role });
    if (c) await c("/login", "POST", { username, password });
  }
  assert.deepEqual(
    (await viewer(`/projects/${project}/owner-items`)).allowed_actions,
    [],
  );
  await viewer(
    `/projects/${project}/owner-items`,
    "POST",
    { title: "禁止只读写入", reviewer_id: ids.reviewer, approver_id: me },
    403,
  );
  const todo = (
    await admin(
      `/projects/${project}/todos`,
      "POST",
      { title: "只读待办测试", owner_id: ids.viewer, due_date: "2026-10-06" },
      201,
    )
  ).id;
  await viewer(`/todos/${todo}`, "PATCH", { done: true, version: 1 }, 403);
  await viewer(`/todos/${todo}`, "DELETE", {}, 403);
  const item = await editor(
    `/projects/${project}/owner-items`,
    "POST",
    { title: "撤权前事项", reviewer_id: ids.reviewer, approver_id: me },
    201,
  );
  await admin(`/projects/${project}/members/${ids.editor}`, "PUT", {
    role: "viewer",
  });
  await editor(
    `/owner-items/${item.id}`,
    "PATCH",
    {
      title: "撤权后禁止",
      content: "",
      reviewer_id: ids.reviewer,
      approver_id: me,
      version: item.version,
    },
    403,
  );
  await admin(`/projects/${project}/members/${ids.editor}`, "PUT", {
    role: "editor",
  });
  console.log(
    "PASS readonly users cannot create owner items or mutate assigned todos, including revocation",
  );
  const columns = [
      { id: "category", name: "类别", type: "text" },
      { id: "amount", name: "金额", type: "decimal", precision: 38, scale: 2 },
    ],
    table = (
      await admin(
        `/projects/${project}/tables`,
        "POST",
        {
          name: "全量归类验收",
          department_id: context.departments[0].id,
          columns,
        },
        201,
      )
    ).id;
  await admin(
    `/tables/${table}/import`,
    "POST",
    {
      rows: Array.from({ length: 51 }, () => ({
        category: "A",
        amount: "1.00",
      })),
    },
    200,
  );
  const one = await admin(`/tables/${table}/records?group=category&page=1`),
    two = await admin(`/tables/${table}/records?group=category&page=2`);
  assert.equal(one.rows.length, 50);
  assert.equal(two.rows.length, 1);
  assert.equal(one.summary.columns[0].sum, "51.00");
  assert.equal(two.summary.columns[0].sum, "51.00");
  assert.equal(two.groupSummaries[0].count, 51);
  const decimals = (
    await admin(
      `/projects/${project}/tables`,
      "POST",
      {
        name: "精确小数验收",
        department_id: context.departments[0].id,
        columns,
      },
      201,
    )
  ).id;
  await admin(
    `/tables/${decimals}/import`,
    "POST",
    {
      rows: [
        { category: "A", amount: "0.10" },
        { category: "A", amount: "0.20" },
        { category: "A", amount: null },
      ],
    },
    200,
  );
  const summary = (await admin(`/tables/${decimals}/records?group=category`))
    .summary.columns[0];
  assert.equal(summary.sum, "0.30");
  assert.equal(summary.min, "0.10");
  const numeric = (
    await admin(
      `/projects/${project}/tables`,
      "POST",
      {
        name: "数字排序验收",
        department_id: context.departments[0].id,
        columns: [{ id: "amount", name: "数量", type: "number" }],
      },
      201,
    )
  ).id;
  await admin(
    `/tables/${numeric}/import`,
    "POST",
    { rows: [1.12, 1.2, -10, -2].map((amount) => ({ amount })) },
    200,
  );
  assert.deepEqual(
    (
      await admin(`/tables/${numeric}/records?sort=amount&direction=asc`)
    ).rows.map((r) => r.data.amount),
    [-10, -2, 1.12, 1.2],
  );
  await admin(`/projects/${project}/members/${ids.viewer}`, "PUT", {
    role: "viewer",
    hidden_columns: ["amount"],
  });
  await viewer(`/tables/${numeric}/records?sort=amount`, "GET", undefined, 403);
  await admin(`/projects/${project}/members/${ids.viewer}`, "PUT", {
    role: "viewer",
  });
  console.log(
    "PASS exact/null-safe full-filtered totals, group summaries, numeric sorting and hidden-column rejection",
  );
  const errors = (
    await admin(
      `/projects/${project}/tables`,
      "POST",
      {
        name: "公式错误验收",
        department_id: context.departments[0].id,
        columns: [
          { id: "category", name: "类别", type: "text" },
          { id: "f", name: "错误公式", type: "formula", formula: "1/0" },
        ],
      },
      201,
    )
  ).id;
  await admin(
    `/tables/${errors}/records`,
    "POST",
    { data: { category: "A" } },
    201,
  );
  assert.equal(
    (await admin(`/tables/${errors}/records?group=category`)).summary.columns[0]
      .invalidCount,
    1,
  );
  await admin(
    `/projects/${project}/report-series?source=business_table&tableId=${errors}&dimension=category&metric=f&aggregation=sum&status=all`,
    "GET",
    undefined,
    400,
  );
  const calendar = await admin(`/projects/${project}/calendar`);
  await admin(
    `/projects/${project}/calendar`,
    "PUT",
    {
      version: calendar.version,
      config: { ...calendar.config, hours_per_day: 1e-12 },
    },
    400,
  );
  console.log(
    "PASS invalid formula results cannot become zero totals; invalid calendar coefficients rejected",
  );
  const activity = (
      await admin(
        `/projects/${project}/activities`,
        "POST",
        { code: "QA1", name: "正式作业费用保护", duration: 2, progress: 0 },
        201,
      )
    ).id,
    planTable = (await admin(`/projects/${project}/plan-table`, "POST", {})).id;
  const resource = (
    await admin(
      `/projects/${project}/resources`,
      "POST",
      {
        kind: "human",
        name: "工日验收",
        unit: "人·日",
        rate: "2",
        capacity: "2",
      },
      201,
    )
  ).id;
  const allocation = await admin(
    `/activities/${activity}/resources`,
    "POST",
    { resource_id: resource, quantity: "4", version: 0 },
    201,
  );
  assert.equal(allocation.version, 1);
  await admin(
    `/activities/${activity}/resources`,
    "POST",
    { resource_id: resource, quantity: "4" },
    409,
  );
  const record = (await admin(`/tables/${planTable}/records`)).rows.find(
    (r) => r.data.code === "QA1",
  );
  await system(`/records/${record.id}/admin-approve`, "POST", {
    version: record.version,
    opinion: "整改正式版本验证",
  });
  await editor(
    `/activities/${activity}/resources`,
    "POST",
    { resource_id: resource, quantity: "4", actual_cost: "100", version: 1 },
    409,
  );
  const payload = {
    activity_id: activity,
    resource_id: resource,
    quantity: "4",
    actual_cost: "100",
    version: 1,
    reason: "正式费用变更验收",
  };
  const approval = (
    await editor(
      `/projects/${project}/approvals`,
      "POST",
      { kind: "resource", title: "资源费用变更验收", approver_id: me, payload },
      201,
    )
  ).id;
  assert.equal(
    (await admin(`/projects/${project}/resources`))[0].allocations[0]
      .actual_cost,
    "0.0000",
  );
  await admin(`/approvals/${approval}/decide`, "POST", {
    action: "approve",
    opinion: "金额复核通过",
  });
  const updated = (await admin(`/projects/${project}/resources`))[0]
    .allocations[0];
  assert.equal(updated.actual_cost, "100.0000");
  assert.equal(updated.version, 2);
  await admin(
    `/approvals/${approval}/decide`,
    "POST",
    { action: "approve" },
    409,
  );
  const stale = (
    await editor(
      `/projects/${project}/approvals`,
      "POST",
      {
        kind: "resource",
        title: "过期申请验证",
        approver_id: me,
        payload: { ...payload, version: 2, actual_cost: "101" },
      },
      201,
    )
  ).id;
  await system(
    `/activities/${activity}/resources`,
    "POST",
    {
      resource_id: resource,
      quantity: "4",
      version: 2,
      actual_cost: "102",
      reason: "系统管理员维护",
    },
    201,
  );
  await admin(`/approvals/${stale}/decide`, "POST", { action: "approve" }, 409);
  assert.equal(
    (await admin(`/projects/${project}/resources`))[0].allocations[0]
      .actual_cost,
    "102.0000",
  );
  await editor(`/approvals/${stale}/decide`, "POST", { action: "withdraw" });
  await system(
    `/activity-resources/${updated.id}`,
    "DELETE",
    { version: 2 },
    409,
  );
  console.log(
    "PASS approved resource changes require approval, preserve until decision, block replay/stale versions and audit system override",
  );
  const actual = (
    await admin(
      `/projects/${project}/tables`,
      "POST",
      {
        name: "一对多明细",
        department_id: context.departments[0].id,
        columns: [
          { id: "category", name: "类别", type: "text" },
          {
            id: "actual",
            name: "实绩",
            type: "decimal",
            precision: 38,
            scale: 2,
          },
        ],
      },
      201,
    )
  ).id;
  await admin(
    `/tables/${actual}/import`,
    "POST",
    {
      rows: [
        { category: "A", actual: "10" },
        { category: "A", actual: "20" },
      ],
    },
    200,
  );
  const def = {
    sources: [decimals, actual],
    joins: [
      {
        left: { source: 0, field: "category" },
        right: { source: 1, field: "category" },
        kind: "left",
      },
    ],
    columns: [
      {
        id: "sum",
        name: "主表合计",
        field: { source: 0, field: "amount" },
        aggregation: "sum",
      },
    ],
    filters: [],
    status: "all",
  };
  await admin(
    `/projects/${project}/public/views/preview`,
    "POST",
    { definition: def },
    400,
  );
  const preview = await admin(
    `/projects/${project}/public/views/preview`,
    "POST",
    { definition: { ...def, allow_duplicate_aggregation: true } },
  );
  assert.equal(preview.rows[0].data.sum, "0.60");
  const xy = await admin(
    `/projects/${project}/report-series?source=business_table&tableId=${decimals}&dimension=category&metric=amount&xMetric=__count__&aggregation=sum&status=all`,
  );
  assert.equal(xy.rows[0].x, "3");
  assert.equal(xy.rows[0].value, "0.30");
  const widget = (
    await admin(
      `/projects/${project}/dashboard/widgets`,
      "POST",
      {
        name: "仪表目标验收",
        config: {
          mappingId: decimals,
          chartType: "gauge",
          gaugeMax: 500,
          metric: "amount",
          dimension: "category",
          aggregation: "sum",
          status: "all",
        },
      },
      201,
    )
  ).id;
  assert.equal(
    (await admin(`/projects/${project}/dashboard`)).widgets.find(
      (w) => w.id === widget,
    ).config.gaugeMax,
    500,
  );
  console.log(
    "PASS duplicate master aggregation is guarded and scatter X/gauge target configuration persists",
  );
  const ai = {
    provider: "ollama",
    protocol: "chat",
    base_url: "http://example.com/v1",
    model: "offline",
    enabled: false,
    api_key: "",
    max_tokens: 256,
    timeout_seconds: 5,
    version: 0,
  };
  await system(`/workspaces/${workspace}/ai-configs`, "PUT", ai, 400);
  await system(`/workspaces/${workspace}/ai-configs`, "PUT", {
    ...ai,
    base_url: "http://host.docker.internal:11434/v1",
  });
  await viewer("/system/release-readiness", "GET", undefined, 403);
  const readiness = await system("/system/release-readiness");
  assert.equal(readiness.ready, false);
  assert.equal(
    readiness.checks.find((c) => c.id === "passwords").passed,
    true,
  );
  console.log(
    "PASS remote plaintext AI endpoints blocked, LAN support retained and production readiness reports unsafe defaults",
  );
  await fs.writeFile(
    "work/qa/audit-rectification-browser.json",
    JSON.stringify({
      workspace,
      project,
      table,
      decimals,
      numeric,
      errors,
      activity,
      planTable,
      resource,
      widget,
      manifest,
      editorUsername: "qa_" + tag + "_editor",
      viewerUsername: "qa_" + tag + "_viewer",
      password,
    }),
  );
} finally {
  if (!process.argv.includes("--keep-browser")) {
    const c = spawnSync(
      process.execPath,
      ["tests/cleanup-fixtures.mjs", "--manifest=" + manifest],
      { encoding: "utf8" },
    );
    assert.equal(c.status, 0, c.stdout + c.stderr);
  }
}
