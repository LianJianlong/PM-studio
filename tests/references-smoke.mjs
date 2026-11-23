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
    assert.equal(
      r.status,
      status,
      `${method} ${path}: ${r.status} ${r.status === status ? "" : await r.text()}`,
    );
    return r.headers.get("content-type")?.includes("json")
      ? r.json()
      : Buffer.from(await r.arrayBuffer());
  };
}
const admin = client(),
  editor = client(),
  reviewer = client(),
  tag = Date.now().toString(36);
await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const workspace = (
    await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
  ).id,
  manifest = { workspace, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
const save = () =>
  fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
await save();
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "引用字段验证", start_date: "2026-09-24" },
    201,
  )
).id;
const context = await admin(`/projects/${project}/context`),
  members = {};
for (const [role, api] of [
  ["editor", editor],
  ["reviewer", reviewer],
]) {
  const username = `qa_${tag}_${role}`,
    password = crypto.randomBytes(16).toString("hex");
  const u = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, password, name: "关联" + role },
    201,
  );
  manifest.users.push(u.id);
  await save();
  members[role] = u.id;
  await admin(`/projects/${project}/members/${u.id}`, "PUT", {
    role,
    can_export: true,
  });
  await api("/login", "POST", { username, password });
}
const text = { id: "title", name: "事项名称", type: "text", required: true };
async function makeTable(name, cols = [text]) {
  return (
    await admin(
      `/projects/${project}/tables`,
      "POST",
      { name, department_id: context.departments[0].id, columns: cols },
      201,
    )
  ).id;
}
const target = await makeTable("合同台账"),
  source = await makeTable("付款申请");
const make = async (table, title, extra = {}) =>
  (
    await editor(
      `/tables/${table}/records`,
      "POST",
      { data: { title, ...extra } },
      201,
    )
  ).id;
const t1 = await make(target, "合同-甲 保密标题"),
  t2 = await make(target, "合同-乙"),
  t3 = await make(target, "合同-丙");
await admin(`/tables/${source}/columns`, "POST", {
  id: "contract",
  name: "关联合同",
  type: "reference",
  target_table: target,
  display_column: "title",
  bidirectional: true,
  inverse_name: "付款申请关联",
});
await admin(`/tables/${source}/columns`, "POST", {
  id: "oneway",
  name: "参考合同",
  type: "reference",
  target_table: target,
  display_column: "title",
});
const tables = () => admin(`/projects/${project}/tables`);
const inverse = (await tables())
  .find((t) => t.id === target)
  .columns.find((f) => f.type === "backlink").id;
const list = (table, api = admin) => api(`/tables/${table}/records`);
const get = async (table, id, api = admin) =>
  {
    for (let page = 1; ; page++) {
      const data = await api(`/tables/${table}/records?page=${page}`);
      const record = data.rows.find(r => r.id === id);
      if (record || page * 50 >= data.total) return record;
    }
  };
const s1 = await make(source, "付款-一", { contract: [t1], oneway: [t2] }),
  s2 = await make(source, "付款-二");
let row = await get(target, t1);
assert.deepEqual(row.data[inverse], [s1]);
assert.equal(row.references[inverse].items[0].label, "付款-一");
assert.equal(
  (await get(source, s1)).references.contract.items[0].label,
  "合同-甲 保密标题",
);
await editor(`/records/${t1}`, "PUT", {
  version: row.version,
  data: { [inverse]: [s1, s2] },
  reference_expected: { [inverse]: [s1] },
});
assert.deepEqual((await get(source, s2)).data.contract, [t1]);
row = await get(target, t1);
await editor(
  `/records/${t1}`,
  "PUT",
  {
    version: row.version,
    data: { [inverse]: [] },
    reference_expected: { [inverse]: [s1] },
  },
  409,
);
assert.deepEqual((await get(target, t1)).data[inverse], [s1, s2].sort());
row = await get(source, s1);
await editor(`/records/${s1}`, "PUT", {
  version: row.version,
  data: { contract: [t2] },
});
assert.deepEqual((await get(target, t1)).data[inverse], [s2]);
assert.deepEqual((await get(target, t2)).data[inverse], [s1]);
assert.equal(
  (
    await admin(
      `/tables/${source}/records?search=${encodeURIComponent("合同-乙")}`,
    )
  ).total,
  1,
);
assert.equal(
  (
    await admin(
      `/tables/${target}/records?search=${encodeURIComponent("付款-一")}`,
    )
  ).total,
  1,
);
await editor(
  `/tables/${source}/records`,
  "POST",
  { data: { title: "错误目标", contract: [s1] } },
  403,
);
await editor(
  `/tables/${source}/records`,
  "POST",
  { data: { title: "重复引用", contract: [t1, t1] } },
  400,
);
console.log(
  "PASS one-way/two-way create, reverse editing, reverse conflict rollback, record labels and cross-page relation search",
);

async function approve(table, record) {
  const ap = (
    await editor(
      `/projects/${project}/approvals`,
      "POST",
      {
        kind: "record",
        title: "关联审批",
        record_id: record,
        approver_id: members.reviewer,
      },
      201,
    )
  ).id;
  await reviewer(`/approvals/${ap}/decide`, "POST", { action: "approve" });
  return get(table, record);
}
await approve(source, s1);
row = await get(target, t2);
await editor(
  `/records/${t2}`,
  "PUT",
  {
    version: row.version,
    data: { [inverse]: [] },
    reference_expected: { [inverse]: [s1] },
  },
  409,
);
assert.equal((await get(target, t2)).version, row.version);
const approvedTarget = await approve(target, t3),
  s3 = await make(source, "付款-三", { contract: [t3] });
assert.equal((await get(target, t3)).version, approvedTarget.version);
assert.deepEqual((await get(target, t3)).data[inverse], [s3]);
const change = (await editor(`/records/${s1}/change`, "POST", {})).id;
assert((await get(target, t2)).data[inverse].includes(change));
row = await get(source, s2);
await admin(`/objects/record/${s2}`, "PATCH", {
  version: row.version,
  lifecycle: "frozen",
});
row = await get(target, t1);
await editor(
  `/records/${t1}`,
  "PUT",
  {
    version: row.version,
    data: { [inverse]: [] },
    reference_expected: { [inverse]: [s2] },
  },
  409,
);
const frozen = await get(source, s2);
await admin(`/objects/record/${s2}`, "PATCH", {
  version: frozen.version,
  lifecycle: "active",
});
const targetState = (await tables()).find((t) => t.id === target);
await admin(`/objects/tables/${target}/columns/${inverse}`, "PATCH", {
  version: targetState.object_version,
  lifecycle: "frozen",
});
assert.equal(
  (await tables())
    .find((t) => t.id === source)
    .columns.find((f) => f.id === "contract").lifecycle,
  "frozen",
);
await editor(
  `/tables/${source}/records`,
  "POST",
  { data: { title: "冻结引用", contract: [t1] } },
  409,
);
const latestTarget = (await tables()).find((t) => t.id === target);
await admin(`/objects/tables/${target}/columns/${inverse}`, "PATCH", {
  version: latestTarget.object_version,
  lifecycle: "active",
});
const deleteTarget = (await tables()).find((t) => t.id === target);
await admin(
  `/objects/tables/${target}/columns/${inverse}`,
  "PATCH",
  { version: deleteTarget.object_version, lifecycle: "deleted" },
  409,
);
console.log(
  "PASS approval locks, approved-target live backlinks without mutating its version, change-copy links, frozen rows and paired-column lifecycle",
);

const viewer = reviewer;
await admin(`/projects/${project}/members/${members.reviewer}`, "PUT", {
  role: "viewer",
  table_ids: [source],
  can_export: true,
});
const safe = await get(source, s1, viewer);
assert.deepEqual(safe.data.contract, []);
assert(safe.references.contract.restricted);
assert(!JSON.stringify(safe).includes(t2));
assert.equal((await viewer(`/tables/${source}/records?search=${t2}`)).total, 0);
assert.equal(
  (
    await viewer(
      `/tables/${source}/records?search=${encodeURIComponent("合同-乙")}`,
    )
  ).total,
  0,
);
await viewer(
  `/tables/${source}/reference-options/contract`,
  "GET",
  undefined,
  403,
);
await admin(`/projects/${project}/members/${members.reviewer}`, "PUT", {
  role: "viewer",
  hidden_columns: ["title"],
  can_export: true,
});
const options = await viewer(
  `/tables/${source}/reference-options/contract?search=${encodeURIComponent("保密标题")}`,
);
assert.equal(options.total, 0);
const hiddenLabel = await get(source, s2, viewer);
assert.equal(hiddenLabel.references.contract.items[0].label, t1);
await admin(`/projects/${project}/members/${members.reviewer}`, "PUT", {
  role: "viewer",
  hidden_columns: ["contract"],
  can_export: true,
});
assert((await get(target, t1, viewer)).references[inverse].restricted);
console.log(
  "PASS target table/row/label authorization, opaque ID suppression, protected relation search and hidden original-field inverse protection",
);

const book = new ExcelJS.Workbook();
await book.xlsx.load(await admin(`/tables/${source}/export`));
assert(
  book.worksheets[0]
    .getColumn(2)
    .values.some((v) => v === JSON.stringify([t3])),
);
const before = (await list(source)).total;
await editor(
  `/tables/${source}/import`,
  "POST",
  {
    rows: [
      { title: "批量有效", contract: [t1] },
      { title: "批量无效", contract: [crypto.randomUUID()] },
    ],
    request_key: crypto.randomUUID(),
  },
  403,
);
assert.equal((await list(source)).total, before);
const parsed = await admin(`/tables/${source}/import-preview`, "POST", {
  rows: [["导入关联", JSON.stringify([t1])]],
  mapping: { title: 0, contract: 1 },
});
assert.equal(parsed.errors.length, 0);
await editor(`/tables/${source}/import`, "POST", {
  rows: parsed.rows,
  request_key: crypto.randomUUID(),
});
const self = await makeTable("同表关联");
await admin(`/tables/${self}/columns`, "POST", {
  id: "related",
  name: "关联事项",
  type: "reference",
  target_table: self,
  display_column: "title",
  bidirectional: true,
});
const self1 = await make(self, "同表甲"),
  self2 = await make(self, "同表乙", { related: [self1] });
const inverseSelf = (await tables())
  .find((t) => t.id === self)
  .columns.find((f) => f.type === "backlink").id;
assert.deepEqual((await get(self, self1)).data[inverseSelf], [self2]);
const other = (
    await admin(
      `/workspaces/${workspace}/projects`,
      "POST",
      { name: "隔离项目", start_date: "2026-09-24" },
      201,
    )
  ).id,
  otherDept = (await admin(`/projects/${other}/context`)).departments[0].id;
await admin(
  `/projects/${other}/tables`,
  "POST",
  {
    name: "跨项目非法引用",
    department_id: otherDept,
    columns: [
      text,
      { id: "ref", name: "ref", type: "reference", target_table: target },
    ],
  },
  400,
);
console.log(
  "PASS Excel ID roundtrip, import transaction rollback, mapped reference import, same-table pairs and project isolation",
);
const concurrent = await make(source, "并发关联");
const concurrentRow = await get(source, concurrent);
const updates = await Promise.allSettled(
  [t1, t2].map((targetId) =>
    editor(`/records/${concurrent}`, "PUT", {
      version: concurrentRow.version,
      data: { contract: [targetId] },
    }),
  ),
);
assert.equal(updates.filter((r) => r.status === "fulfilled").length, 1);
assert.match(
  updates.find((r) => r.status === "rejected").reason.message,
  /409/,
);
const winner = (await get(source, concurrent)).data.contract[0];
for (const targetId of [t1, t2])
  assert.equal(
    (await get(target, targetId)).data[inverse].includes(concurrent),
    targetId === winner,
  );
await admin(`/projects/${project}/members/${members.reviewer}`, "PUT", {
  role: "viewer",
  row_scope: "own",
  can_export: true,
});
const noRows = await get(source, s2, admin);
assert(noRows);
assert.equal(
  (await reviewer(`/tables/${source}/reference-options/contract`)).total,
  0,
);
await admin(`/projects/${project}/members/${members.reviewer}`, "PUT", {
  role: "viewer",
  can_export: true,
});
const capacityTarget = await make(target, "关联容量验证");
await editor(`/tables/${source}/import`, "POST", {
  rows: Array.from({ length: 100 }, (_, i) => ({
    title: `关联容量${i}`,
    contract: [capacityTarget],
  })),
  request_key: crypto.randomUUID(),
});
const full = (await get(target, capacityTarget)).data[inverse];
assert.equal(full.length, 100);
await editor(
  `/tables/${source}/records`,
  "POST",
  { data: { title: "超出关联容量", contract: [capacityTarget] } },
  409,
);
await editor(`/records/${full[0]}`, "DELETE", {});
assert.equal((await get(target, capacityTarget)).data[inverse].length, 99);
await make(source, "补充关联容量", { contract: [capacityTarget] });
assert.match(full[0], /^[a-f0-9-]{36}$/);
const deletedSql = spawnSync(
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
    "-At",
    "-c",
    `SELECT version FROM records WHERE id='${full[0]}'`,
  ],
  { encoding: "utf8" },
);
assert.equal(deletedSql.status, 0);
await admin(
  `/objects/record/${full[0]}`,
  "PATCH",
  { version: Number(deletedSql.stdout.trim()), lifecycle: "active" },
  409,
);
assert.equal((await get(target, capacityTarget)).data[inverse].length, 100);
console.log(
  "PASS concurrent relation writes preserve exactly one winner, row-scope option filtering, 100-link bounds and over-capacity restore rollback",
);
const invalidPreview = await editor(
  `/tables/${source}/import-preview`,
  "POST",
  {
    rows: [["不存在的关联", JSON.stringify([crypto.randomUUID()])]],
    mapping: { title: 0, contract: 1 },
  },
);
assert.equal(invalidPreview.errors.length, 1);
const lockedPreview = await editor(`/tables/${target}/import-preview`, "POST", {
  rows: [["反向不可修改", JSON.stringify([s1])]],
  mapping: { title: 0, [inverse]: 1 },
});
assert.equal(lockedPreview.errors.length, 1);
const privateTarget = (
  await admin(
    `/tables/${target}/records`,
    "POST",
    { data: { title: "仅管理员所有的记录" } },
    201,
  )
).id;
const ownSource = await make(source, "本人录入源与受限目标", {
  contract: [privateTarget],
});
await admin(`/projects/${project}/members/${members.editor}`, "PUT", {
  role: "editor",
  row_scope: "own",
  can_export: true,
});
assert.deepEqual((await get(source, ownSource, editor)).data.contract, []);
assert.equal(
  (await editor(`/tables/${source}/records?search=${privateTarget}`)).total,
  0,
);
await admin(`/projects/${project}/members/${members.editor}`, "PUT", {
  role: "editor",
  can_export: true,
});
const emptyTarget = await makeTable("空关联目标"),
  emptySource = await makeTable("空关联源");
await admin(`/tables/${emptySource}/columns`, "POST", {
  id: "link",
  name: "空关联",
  type: "reference",
  target_table: emptyTarget,
  bidirectional: true,
});
await make(emptySource, "空集合记录", { link: [] });
const emptyPair = (await tables()).find((t) => t.id === emptyTarget);
const backId = emptyPair.columns.find((f) => f.type === "backlink").id;
await admin(`/objects/tables/${emptyTarget}/columns/title`, "PATCH", {
  version: emptyPair.object_version,
  lifecycle: "deleted",
});
let emptySrc = (await tables()).find((t) => t.id === emptySource);
await admin(
  `/objects/tables/${emptySource}/columns/link`,
  "PATCH",
  { version: emptySrc.object_version, lifecycle: "deleted" },
  409,
);
let emptyTgt = (await tables()).find((t) => t.id === emptyTarget);
await admin(`/objects/tables/${emptyTarget}/columns/title`, "PATCH", {
  version: emptyTgt.object_version,
  lifecycle: "active",
});
emptySrc = (await tables()).find((t) => t.id === emptySource);
await admin(`/objects/tables/${emptySource}/columns/link`, "PATCH", {
  version: emptySrc.object_version,
  lifecycle: "deleted",
});
assert.equal(
  (await admin(`/objects/projects/${project}/tables`))
    .find((t) => t.id === emptyTarget)
    .columns.find((f) => f.id === backId).lifecycle,
  "deleted",
);
console.log(
  "PASS reference preview authorization, indirect own-row protection, empty relation deletion and opposite last-column guard",
);
manifest.references = { project, source, target, inverse };
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
