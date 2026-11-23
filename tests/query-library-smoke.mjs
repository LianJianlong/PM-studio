import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  return async (path, method = "GET", body, expected = 200) => {
    const r = await fetch(`http://localhost:9090/api${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    const data = await r.json();
    assert.equal(
      r.status,
      expected,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    return data;
  };
}
function db(sql) {
  const r = spawnSync(
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
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const admin = client(),
  other = client(),
  tag = `sql${Date.now().toString(36)}`;
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
const username = `qa_${tag}`,
  password = crypto.randomBytes(18).toString("hex");
const user = (
  await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, password, name: "查询库测试成员" },
    201,
  )
).id;
manifest.users.push(user);
await save();
await other("/login", "POST", { username, password });
await admin(
  `/workspaces/${workspace}/projects`,
  "POST",
  { name: "SQL工作台验收", start_date: "2026-09-30" },
  201,
);
const config = {
  name: "QA只读验证",
  engine: "postgres",
  host: "db",
  port: 5432,
  database: "project_studio",
  user: "studio_app",
  password: env.APP_DB_PASSWORD,
  tls: false,
};
const con = (
  await admin(`/workspaces/${workspace}/connections`, "POST", config, 201)
).id;
const second = (
  await admin(
    `/workspaces/${workspace}/connections`,
    "POST",
    { ...config, name: "QA连接隔离" },
    201,
  )
).id;
const base = `/connections/${con}`;
const first = await admin(
  `${base}/saved-queries`,
  "POST",
  { name: "常用查询", sql: "SELECT 42 AS answer" },
  201,
);
await other(`${base}/query-library`, "GET", undefined, 403);
await other(
  `${base}/saved-queries`,
  "POST",
  { name: "无权", sql: "SELECT 1" },
  403,
);
await admin(
  `${base}/saved-queries`,
  "POST",
  { name: " ", sql: "SELECT 1" },
  400,
);
await admin(`${base}/saved-queries/${first.id}`, "PATCH", {
  version: 1,
  name: "精确结果",
  sql: "SELECT 43 AS answer",
});
await admin(
  `${base}/saved-queries/${first.id}`,
  "PATCH",
  { version: 1, name: "冲突", sql: "SELECT 44" },
  409,
);
await admin(
  `/connections/${second}/saved-queries/${first.id}`,
  "PATCH",
  { version: 2, archived: true },
  404,
);
await admin(`${base}/saved-queries/${first.id}`, "PATCH", {
  version: 2,
  archived: true,
});
assert.equal((await admin(`${base}/query-library`)).saved[0].archived, true);
await admin(
  `${base}/saved-queries/${first.id}`,
  "PATCH",
  { version: 3, name: "不可编辑归档", sql: "SELECT 1" },
  400,
);
await admin(`${base}/saved-queries/${first.id}`, "PATCH", {
  version: 3,
  archived: false,
});
// Promote only this isolated fixture to test two-owner personal isolation.
db(
  `UPDATE workspace_members SET role='owner' WHERE workspace_id='${workspace}' AND user_id='${user}';`,
);
assert.equal((await other(`${base}/query-library`)).saved.length, 0);
await other(
  `${base}/saved-queries/${first.id}`,
  "PATCH",
  { version: 4, archived: true },
  404,
);
await other(
  `${base}/saved-queries`,
  "POST",
  { name: "其他所有者个人查询", sql: "SELECT 2" },
  201,
);
assert.equal((await admin(`${base}/query-library`)).saved.length, 1);
console.log(
  "PASS saved query CRUD, archive/restore, stale versions, connection and personal isolation",
);
const result = await admin(`${base}/query`, "POST", {
  sql: "SELECT 43 AS answer",
});
assert.equal(result.rows[0].answer, 43);
await admin(
  `${base}/query`,
  "POST",
  { sql: "SELECT missing_column FROM missing_table" },
  400,
);
await admin(`${base}/query`, "POST", {
  sql: "SELECT generate_series(1,510) AS n",
});
const library = await admin(`${base}/query-library`);
assert.equal(library.history.length, 3);
assert.equal(library.history[0].row_count, 500);
assert.equal(library.history[0].truncated, true);
assert.equal(library.history[1].succeeded, false);
assert(!("rows" in library.history[0]));
assert(!("sql_cipher" in library.saved[0]));
assert.equal((await other(`${base}/query-library`)).history.length, 0);
assert.equal(
  (await admin(`/connections/${second}/query-library`)).history.length,
  0,
);
assert.equal(
  db(
    `SELECT count(*) FROM saved_queries WHERE connection_id='${con}' AND sql_cipher LIKE '%SELECT%';`,
  ),
  "0",
);
// Seed older history to verify retention is bounded after the next real execution.
db(
  `INSERT INTO query_history(id,connection_id,user_id,sql_cipher,succeeded,duration_ms,created_at) SELECT gen_random_uuid(),connection_id,user_id,sql_cipher,true,1,now()-interval '1 day' FROM query_history CROSS JOIN generate_series(1,101) WHERE id='${library.history[0].id}';`,
);
await admin(`${base}/query`, "POST", { sql: "SELECT 9 AS retained" });
assert.equal((await admin(`${base}/query-library`)).history.length, 100);
assert.equal(
  db(`SELECT count(*) FROM query_history WHERE connection_id='${con}';`),
  "100",
);
db(
  `UPDATE workspace_members SET role='member' WHERE workspace_id='${workspace}' AND user_id='${user}';`,
);
await other(`${base}/query-library`, "GET", undefined, 403);
await admin(`/connections/${second}`, "DELETE", {});
await admin(`/connections/${second}/query-library`, "GET", undefined, 404);
console.log(
  "PASS real PostgreSQL execution history, failure, truncation, encrypted storage, bounded retention and role revocation",
);
await fs.writeFile(
  "work/qa/query-library-browser.json",
  JSON.stringify({ workspace, connection: con, tag }),
);
console.log("RETAINED isolated fixture for browser QA");
