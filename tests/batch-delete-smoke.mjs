import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const pw = (await fs.readFile(".env", "utf8"))
    .match(/^ADMIN_PASSWORD=(.*)$/m)[1]
    .trim(),
  tag = "batch" + Date.now().toString(36),
  password = crypto.randomBytes(18).toString("hex");
function client() {
  let cookie = "";
  return async (path, method = "GET", body, status = 200) => {
    const r = await fetch("http://127.0.0.1:9090/api" + path, {
      method,
      headers: {
        cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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
  viewer = client();
await admin("/login", "POST", { username: "admin", password: pw });
const workspace = (
    await admin("/workspaces", "POST", { name: "QA集成验证 " + tag }, 201)
  ).id,
  manifestName = "fixtures-" + tag + ".json",
  manifest = { workspace, tag, users: [] };
await fs.writeFile("work/qa/" + manifestName, JSON.stringify(manifest));
const project = (
    await admin(
      `/workspaces/${workspace}/projects`,
      "POST",
      { name: "批量删除验收", start_date: "2026-10-05" },
      201,
    )
  ).id,
  u = (
    await admin(
      `/workspaces/${workspace}/users`,
      "POST",
      { username: "qa_" + tag, password, name: "只读验收" },
      201,
    )
  ).id;
manifest.users.push(u);
await fs.writeFile("work/qa/" + manifestName, JSON.stringify(manifest));
await admin(`/projects/${project}/members/${u}`, "PUT", { role: "viewer" });
await viewer("/login", "POST", { username: "qa_" + tag, password });
const table = (await admin(`/projects/${project}/plan-table`, "POST", {})).id,
  ids = [];
for (let n = 0; n < 6; n++)
  ids.push(
    (
      await admin(
        `/projects/${project}/activities`,
        "POST",
        {
          code: "B" + (n + 1),
          name: "批量作业" + (n + 1),
          duration: 2,
          progress: 0,
          predecessors:
            n > 0 && n < 3 ? [{ id: ids[n - 1], type: "FS", lag: 0 }] : [],
        },
        201,
      )
    ).id,
  );
async function payload(keys) {
  const p = await admin(`/projects/${project}/plan`);
  return {
    records: p.activities
      .filter((a) => keys.includes(a.id))
      .map((a) => ({ id: a.record_id, version: a.record_version })),
  };
}
await viewer(
  `/tables/${table}/records/batch-delete`,
  "POST",
  await payload(ids.slice(0, 2)),
  403,
);
await admin(
  `/tables/${table}/records/batch-delete`,
  "POST",
  await payload([ids[0]]),
  409,
);
assert.equal((await admin(`/projects/${project}/plan`)).activities.length, 6);
console.log(
  "PASS delete permission and unselected dependent block without partial deletion",
);
const stale = await payload(ids.slice(0, 3));
stale.records[0].version = 999;
await admin(`/tables/${table}/records/batch-delete`, "POST", stale, 409);
assert.equal((await admin(`/projects/${project}/plan`)).activities.length, 6);
await admin(
  `/tables/${table}/records/batch-delete`,
  "POST",
  {
    records: [
      ...(await payload([ids[0]])).records,
      ...(await payload([ids[0]])).records,
    ],
  },
  400,
);
console.log("PASS stale versions and duplicate IDs reject the complete batch");
const before = await payload(ids.slice(0, 3)),
  result = await admin(`/tables/${table}/records/batch-delete`, "POST", before);
assert.equal(result.deleted, 3);
assert.deepEqual(
  (await admin(`/projects/${project}/plan`)).activities.map((a) => a.id),
  ids.slice(3),
);
assert.ok(
  !(await admin(`/tables/${table}/records`)).rows.some((r) =>
    before.records.some((n) => n.id === r.id),
  ),
);
console.log(
  "PASS internally dependent activities delete atomically in successor-first order and table/plan sync",
);
await admin(`/projects/${project}/members/${u}`, "PUT", { role: "manager" });
const one = (await payload([ids[3]])).records[0],
  ap = (
    await admin(
      `/projects/${project}/approvals`,
      "POST",
      {
        kind: "record",
        title: "批量审核锁验证",
        record_id: one.id,
        approver_id: u,
      },
      201,
    )
  ).id;
assert.ok(ap);
await admin(
  `/tables/${table}/records/batch-delete`,
  "POST",
  await payload(ids.slice(3)),
  409,
);
assert.equal((await admin(`/projects/${project}/plan`)).activities.length, 3);
console.log("PASS approval locks retain the entire mixed selection");
const wbs = (
  await admin(`/projects/${project}/planning-tables/wbs`, "POST", {})
).id;
const rows = [];
for (let n = 0; n < 2; n++)
  rows.push(
    (
      await admin(
        `/tables/${wbs}/records`,
        "POST",
        { data: { code: "W" + n, name: "删除节点" + n } },
        201,
      )
    ).id,
  );
const meta = (await admin(`/tables/${wbs}/records`)).rows.filter((r) =>
  rows.includes(r.id),
);
await admin(
  `/tables/${table}/records/batch-delete`,
  "POST",
  { records: meta.map((r) => ({ id: r.id, version: r.version })) },
  404,
);
assert.equal((await admin(`/tables/${wbs}/records`)).rows.length, 2);
assert.equal(
  (
    await admin(`/tables/${wbs}/records/batch-delete`, "POST", {
      records: meta.map((r) => ({ id: r.id, version: r.version })),
    })
  ).deleted,
  2,
);
console.log(
  "PASS foreign-table IDs reject and normal WBS drafts share batch deletion",
);
if (process.argv.includes("--keep-browser")) {
  await fs.writeFile(
    "work/qa/batch-delete-browser.json",
    JSON.stringify({ workspace, project, table, wbs, ids, manifestName }),
  );
  console.log("RETAINED batch fixture");
} else {
  const r = spawnSync(
    process.execPath,
    ["tests/cleanup-fixtures.mjs", "--manifest=" + manifestName],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  console.log(r.stdout.trim());
}
