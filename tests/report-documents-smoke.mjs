// Isolated API integration QA; records its own manifest for scoped cleanup.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";

const env = Object.fromEntries((await fs.readFile(".env", "utf8")).trim().split(/\r?\n/).map((line) => { const i = line.indexOf("="); return [line.slice(0, i).replace(/^\uFEFF/, ""), line.slice(i + 1)]; }));
const base = "http://127.0.0.1:9090/api", tag = `report${Date.now().toString(36)}`, password = crypto.randomBytes(18).toString("hex");
function client() {
  let cookie = "";
  return async (path, method = "GET", body, expected = 200) => {
    const response = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
    assert.equal(response.status, expected, `${method} ${path}: ${response.status !== expected ? await response.text() : ""}`);
    return response.headers.get("content-type")?.includes("json") ? response.json() : Buffer.from(await response.arrayBuffer());
  };
}
const admin = client(), reviewer = client(), reporter = client(), viewer = client();
await admin("/login", "POST", { username: "admin", password: env.ADMIN_PASSWORD });
const workspace = (await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)).id;
const manifest = { workspace, users: [], tag };
const manifestName = `fixtures-${tag}.json`;
await fs.mkdir("work/qa", { recursive: true });
const saveManifest = () => fs.writeFile(`work/qa/${manifestName}`, JSON.stringify(manifest));
await saveManifest();
const project = (await admin(`/workspaces/${workspace}/projects`, "POST", { name: "报表筛选与导出验证", start_date: "2026-10-01" }, 201)).id;
const context = await admin(`/projects/${project}/context`), d1 = context.departments[0], d2 = context.departments[1];
const users = {};
for (const [role, api] of [["reviewer", reviewer], ["reporter", reporter], ["viewer", viewer]]) {
  const username = `qa_${tag}_${role}`;
  users[role] = (await admin(`/workspaces/${workspace}/users`, "POST", { username, name: `报表验证${role}`, password }, 201)).id;
  manifest.users.push(users[role]); await saveManifest();
  await admin(`/projects/${project}/members/${users[role]}`, "PUT", { role: role === "reporter" ? "editor" : role });
  await api("/login", "POST", { username, password });
}
const columns = [{ id: "work", name: "作业", type: "text", required: true }, { id: "day", name: "日期", type: "date", required: true }, { id: "amount", name: "金额", type: "decimal", precision: 38, scale: 4, unit: "元", required: true }, { id: "scientific", name: "浮点量", type: "float64" }, { id: "secret", name: "保密项", type: "text" }];
const table = (await admin(`/projects/${project}/tables`, "POST", { name: "日报精确金额", department_id: d1.id, columns }, 201)).id;
const grant = (extra = {}) => admin(`/projects/${project}/members/${users.reporter}`, "PUT", { role: "editor", department_id: d1.id, table_ids: [table], hidden_columns: ["secret"], can_export: true, ...extra });
await grant();
const approved = [
  { work: "Alpha", day: "2026-10-01", amount: "9007199254740993.1234", scientific: 1e21, secret: "隐藏值" },
  { work: "Alpha", day: "2026-10-02", amount: "0.0006", secret: "隐藏值" },
  { work: "Beta", day: "2026-10-02", amount: "2.5000", secret: "隐藏值" },
];
for (const data of approved) {
  const record = (await admin(`/tables/${table}/records`, "POST", { data }, 201)).id;
  const approval = (await admin(`/projects/${project}/approvals`, "POST", { kind: "record", title: "报表验证记录", record_id: record, approver_id: users.reviewer }, 201)).id;
  await reviewer(`/approvals/${approval}/decide`, "POST", { action: "approve" });
}
await admin(`/tables/${table}/records`, "POST", { data: { work: "Alpha", day: "2026-10-02", amount: "999.0000" } }, 201);
const series = (api, options, status = 200) => api(`/projects/${project}/report-series?${new URLSearchParams(options)}`, "GET", undefined, status);
const query = { source: "business_table", tableId: table, dimension: "day", metric: "amount", status: "approved", aggregation: "sum" };
const all = await series(admin, query);
assert.equal(all.overall, "9007199254740995.6240"); assert.equal(all.matched, 3);
const pivot = (await series(reporter, { ...query, dimension: "work", dimension2: "day" })).pivot;
assert.deepEqual(pivot.rows, ["Alpha", "Beta"]);
assert.deepEqual(pivot.columns, ["2026-10-01", "2026-10-02"]);
assert.deepEqual(pivot.values, [["9007199254740993.1234", "0.0006"], [null, "2.5000"]]);
assert.equal(pivot.overall, all.overall);
await series(reporter, { ...query, dimension2: "secret" }, 403);
await series(reporter, { ...query, dimension2: "day" }, 400);
assert.equal((await series(admin, { ...query, filterField: "scientific", filterValue: "1e+21" })).overall, "9007199254740993.1234");
const filtered = { ...query, filterField: "work", filterOperator: "contains", filterValue: "alpha", dateField: "day", dateFrom: "2026-10-02", dateTo: "2026-10-02" };
const selected = await series(reporter, filtered);
assert.equal(selected.overall, "0.0006"); assert.equal(selected.matched, 1);
await series(reporter, { ...filtered, filterField: "secret" }, 403);
await series(reporter, { ...filtered, dateField: "secret" }, 403);
await series(admin, { ...filtered, dateFrom: "2026-10-03" }, 400);
assert.equal((await series(admin, { ...query, status: "draft" })).overall, "999.0000");
console.log("PASS field/date filters execute in PostgreSQL, inclusivity, exact sum, status exclusion and hidden fields");

const activities = [];
for (const [code, department, progress] of [["A", d1.id, 10], ["B", d1.id, 30], ["C", d2.id, 100]]) {
  activities.push((await admin(`/projects/${project}/activities`, "POST", { code, name: `作业${code}`, duration: 5, progress, department_id: department }, 201)).id);
}
const resource = (await admin(`/projects/${project}/resources`, "POST", { name: "测试人工", kind: "human", unit: "人", rate: 1, capacity: 10 }, 201)).id;
for (const [i, cost] of [2.1234, 3.1234, 5].entries()) await admin(`/activities/${activities[i]}/resources`, "POST", { resource_id: resource, quantity: 1, planned_cost: cost, actual_cost: 0 }, 201);
const progress = { source: "activity_progress", dimension: "department", metric: "progress" };
await series(admin, { ...progress, dimension: "constructor" }, 400);
await series(admin, { ...progress, metric: "toString" }, 400);
assert.equal(Number((await series(reporter, progress)).overall), 20);
assert.equal((await series(reporter, progress)).rows.length, 1);
await series(reporter, { ...progress, departmentId: d2.id }, 403);
const costs = { source: "resource_cost", dimension: "department", metric: "planned_cost" };
assert.equal((await series(reporter, costs)).overall, "5.2468");
assert.equal(typeof (await series(reporter, costs)).rows[0].value, "string");
assert.deepEqual((await reporter(`/projects/${project}/report-departments`)).map((d) => d.id), [d1.id]);
console.log("PASS department-limited plan/resource reports and global average KPI semantics");

let report = await admin(`/projects/${project}/report-documents`, "POST", { name: "筛选导出测试" }, 201);
const layout = { sections: { header: [{ id: "title", type: "title", text: "精确数据验证" }], detail: [{ id: "daily", type: "table", title: "已审核日报", ...filtered, dimension2: "work" }, { id: "kpi", type: "kpi", title: "平均进度", ...progress }, { id: "cost", type: "chart", title: "费用", chartType: "bar", ...costs }], summary: [], footer: [] } };
report = await admin(`/report-documents/${report.id}`, "PUT", { name: report.name, version: report.version, layout });
assert.deepEqual((await admin(`/report-documents/${report.id}`)).layout, layout);
const exportPath = `/report-documents/${report.id}/export.xlsx?version=${report.version}`;
await viewer(exportPath, "GET", undefined, 403);
await admin(`/report-documents/${report.id}/export.xlsx?version=${report.version + 1}`, "GET", undefined, 409);
const bytes = await reporter(exportPath);
const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
assert.equal(book.worksheets.length, 4);
const sheetValues = (sheet) => { const values = []; sheet.eachRow((r) => r.eachCell((c) => values.push(c.value))); return values; };
assert.ok(sheetValues(book.getWorksheet("组件01")).includes("0.0006"));
assert.ok(sheetValues(book.getWorksheet("组件01")).includes("Alpha"));
assert.ok(sheetValues(book.getWorksheet("组件01")).some((value) => String(value).includes("alpha")));
const find = (sheet, label) => { let found; sheet.eachRow((r) => { if (r.getCell(1).value === label) found = r.getCell(2).value; }); return found; };
assert.equal(Number(find(book.getWorksheet("组件02"), "整体指标（全部匹配分组）")), 20);
assert.equal(find(book.getWorksheet("组件03"), "整体指标（全部匹配分组）"), "5.2468");
await fs.mkdir("work/qa", { recursive: true });
await fs.writeFile("work/qa/report-filter-export.xlsx", bytes);
await grant({ hidden_columns: ["secret", "amount"] });
await reporter(exportPath, "GET", undefined, 403);
await grant();
const own = (await reporter(`/tables/${table}/records`, "POST", { data: { work: "Gamma", day: "2026-10-03", amount: "7.0000" } }, 201)).id;
await grant({ row_scope: "own" });
const ownSeries = await series(reporter, { ...query, status: "all" });
assert.equal(ownSeries.matched, 1); assert.equal(ownSeries.overall, "7.0000"); assert.ok(own);
console.log("PASS saved filters, XLSX download/reload, no-export role, stale versions, retracted field grants and own-row scope");
if (!process.argv.includes("--keep-browser")) {
  const cleanup = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=${manifestName}`], { encoding: "utf8" });
  assert.equal(cleanup.status, 0, cleanup.stderr); console.log(cleanup.stdout.trim());
} else {
  console.log(`BROWSER_WORKSPACE QA集成验证 ${tag}`);
  await fs.writeFile("work/qa/report-browser.json", JSON.stringify({ workspace, project, reportId: report.id, reportVersion: report.version, manifestName }));
}
