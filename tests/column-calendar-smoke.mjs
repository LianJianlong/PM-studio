import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
const tag = "colcal" + Date.now().toString(36),
  manifest = "fixtures-" + tag + ".json";
let cookie = "";
async function api(path, method = "GET", body, status = 200) {
  const r = await fetch("http://127.0.0.1:9090/api" + path, {
    method,
    headers: { cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const result = await r.json();
  assert.equal(r.status, status, path + " " + JSON.stringify(result));
  return result;
}
await api("/login", "POST", {
  username: "superadmin",
  password: process.env.QA_ADMIN_PASSWORD,
});
const workspace = (
  await api("/workspaces", "POST", { name: "QA集成验证 " + tag }, 201)
).id;
await fs.writeFile(
  "work/qa/" + manifest,
  JSON.stringify({ workspace, tag, users: [] }),
);
try {
  const project = (
    await api(
      `/workspaces/${workspace}/projects`,
      "POST",
      { name: "列设计与日历验收", start_date: "2026-10-05" },
      201,
    )
  ).id;
  const context = await api(`/projects/${project}/context`);
  const table = (
    await api(
      `/projects/${project}/tables`,
      "POST",
      {
        name: "列修改检验表",
        department_id: context.departments[0].id,
        columns: [
          { id: "title", name: "名称", type: "text" },
          { id: "value", name: "数值", type: "text" },
          { id: "calc", name: "公式", type: "formula", formula: "1" },
        ],
      },
      201,
    )
  ).id;
  const record = (
    await api(
      `/tables/${table}/records`,
      "POST",
      { data: { title: "验收", value: "12.5" } },
      201,
    )
  ).id;
  const rows = () => api(`/tables/${table}/records`);
  async function edit(id, definition, status = 200) {
    const current = (await rows()).table;
    return api(
      `/objects/tables/${table}/columns/${id}`,
      "PATCH",
      { version: current.object_version, definition: { id, ...definition } },
      status,
    );
  }
  await edit("value", { name: "数量", type: "number" });
  assert.equal((await rows()).rows[0].data.value, 12.5);
  await edit("calc", { name: "金额", type: "formula", formula: "[value] * 2" });
  assert.equal((await rows()).rows[0].data.calc, "25");
  const before = (await rows()).table.object_version;
  await edit("value", { name: "不能缩窄", type: "int8" }, 409);
  await edit(
    "calc",
    { name: "非法公式", type: "formula", formula: "[missing] + 1" },
    400,
  );
  await edit(
    "calc",
    { name: "循环公式", type: "formula", formula: "[calc] + 1" },
    400,
  );
  assert.equal((await rows()).table.object_version, before);
  const current = (await rows()).rows[0];
  await api(`/records/${record}/admin-approve`, "POST", {
    version: current.version,
    opinion: "正式记录转换保护",
  });
  await edit(
    "value",
    { name: "不能改正式存储", type: "decimal", precision: 38, scale: 2 },
    409,
  );
  assert.equal((await rows()).rows[0].data.value, 12.5);
  console.log(
    "PASS rename/type/formula changes, invalid conversion rollback, formula cycles and approved-value protection",
  );
  const { calendarTemplate } = await import("../shared/project-calendar.ts");
  const cal = calendarTemplate("five");
  cal.exceptions["2026-10-06"] = [["08:00", "12:00"]];
  const calendar = await api(`/projects/${project}/calendar`);
  await api(`/projects/${project}/calendar`, "PUT", {
    version: calendar.version,
    config: cal,
  });
  const activity = (
    await api(
      `/projects/${project}/activities`,
      "POST",
      {
        code: "A",
        name: "工时分摊作业",
        duration: 2,
        progress: 0,
        predecessors: [],
      },
      201,
    )
  ).id;
  const resource = (
    await api(
      `/projects/${project}/resources`,
      "POST",
      {
        kind: "human",
        name: "测试人工",
        unit: "人·小时",
        rate: "2.5000",
        capacity: "10.0000",
      },
      201,
    )
  ).id;
  await api(
    `/activities/${activity}/resources`,
    "POST",
    { resource_id: resource, quantity: "24.0000" },
    201,
  );
  let load = (await api(`/projects/${project}/resource-load`)).resources.find(
    (r) => r.id === resource,
  );
  assert.deepEqual(
    load.curve.map((d) => [
      d.date,
      d.quantity,
      d.planned_cost,
      d.available_capacity,
    ]),
    [
      ["2026-10-05", "12.0000", "30.0000", "10.0000"],
      ["2026-10-06", "6.0000", "15.0000", "5.0000"],
      ["2026-10-07", "6.0000", "15.0000", "10.0000"],
    ],
  );
  assert.equal(load.planned_cost, "60.0000");
  assert.equal(load.overloaded_days, 2);
  await api(
    `/activities/${activity}/resources`,
    "POST",
    { resource_id: resource, quantity: "24.0000", planned_cost: "0", version:load.allocations[0].version },
    201,
  );
  load = (await api(`/projects/${project}/resource-load`)).resources.find(
    (r) => r.id === resource,
  );
  assert.equal(load.planned_cost, "0.0000");
  console.log(
    "PASS half-day/hour-based resource shares, calendar capacity, auto pricing and explicit zero cost",
  );
  await fs.writeFile(
    "work/qa/column-calendar-browser.json",
    JSON.stringify({
      workspace,
      project,
      table,
      record,
      activity,
      resource,
      manifest,
    }),
  );
} finally {
  if (!process.argv.includes("--keep-browser")) {
    const result = spawnSync(
      process.execPath,
      ["tests/cleanup-fixtures.mjs", "--manifest=" + manifest],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0);
  }
}
