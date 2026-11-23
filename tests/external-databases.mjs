// Uses disposable roles/schema and a disposable MySQL container; never exposes host ports.
import fs from "node:fs/promises";
import crypto from "node:crypto";
import assert from "node:assert/strict";
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
const tag = crypto.randomBytes(4).toString("hex"),
  schema = "qa_external_" + tag,
  role = "qa_reader_" + tag,
  password = crypto.randomBytes(24).toString("hex");
const mysqlName = "project-studio-qa-mysql-" + tag;
function docker(args, input, extraEnv = {}) {
  const r = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 60000,
  });
  if (r.status !== 0)
    throw Error(
      "Docker test command failed: " +
        String(r.stderr).replaceAll(password, "[redacted]"),
    );
  return r.stdout;
}
const psql = (sql) =>
  docker(
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
    sql,
  );
let cookie = "",
  workspace,
  connections = [];
async function api(path, method = "GET", body, expected = 200) {
  const r = await fetch("http://localhost:9090/api" + path, {
    method,
    headers: {
      cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal(r.status, expected, path);
  return r.json();
}
await api("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
workspace = (await api("/bootstrap")).workspaces.find((w) =>
  w.name.startsWith("QA集成验证 "),
).id;
try {
  psql(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.items(id int PRIMARY KEY,name text); INSERT INTO ${schema}.items VALUES(1,'read-only sample'); GRANT USAGE ON SCHEMA ${schema} TO ${role}; GRANT SELECT ON ${schema}.items TO ${role};`,
  );
  docker(
    [
      "run",
      "-d",
      "--name",
      mysqlName,
      "--network",
      "project-studio_default",
      "--tmpfs",
      "/var/lib/mysql",
      "-e",
      "MYSQL_ROOT_PASSWORD",
      "-e",
      "MYSQL_DATABASE=qa_external",
      "-e",
      "MYSQL_USER=qa_reader",
      "-e",
      "MYSQL_PASSWORD",
      "mysql:8.0.32",
    ],
    undefined,
    { MYSQL_ROOT_PASSWORD: password, MYSQL_PASSWORD: password },
  );
  const pg = (
    await api(
      `/workspaces/${workspace}/connections`,
      "POST",
      {
        name: "QA PostgreSQL " + tag,
        engine: "postgres",
        host: "db",
        port: 5432,
        database: "project_studio",
        user: role,
        password,
        tls: false,
      },
      201,
    )
  ).id;
  connections.push(pg);
  assert.ok(
    (await api(`/connections/${pg}/query`, "POST", {})).rows.some(
      (r) => r.table_schema === schema,
    ),
  );
  assert.equal(
    (
      await api(`/connections/${pg}/query`, "POST", {
        sql: `SELECT * FROM ${schema}.items`,
      })
    ).rows[0].name,
    "read-only sample",
  );
  const limited = await api(`/connections/${pg}/query`, "POST", {
    sql: "SELECT generate_series(1,1000) AS value",
  });
  assert.equal(limited.rows.length, 500);
  assert.equal(limited.truncated, true);
  await api(
    `/connections/${pg}/query`,
    "POST",
    {
      sql: `WITH changed AS (DELETE FROM ${schema}.items RETURNING *) SELECT * FROM changed`,
    },
    400,
  );
  await api(
    `/connections/${pg}/query`,
    "POST",
    { sql: "SELECT 1; SELECT 2" },
    400,
  );
  await api(
    `/connections/${pg}/query`,
    "POST",
    { sql: "SELECT * FROM users" },
    400,
  );
  assert.equal(
    (
      await api(`/connections/${pg}/query`, "POST", {
        sql: `SELECT count(*)::int AS count FROM ${schema}.items`,
      })
    ).rows[0].count,
    1,
  );
  console.log(
    "PASS PostgreSQL connection, objects, read-only query, 500-row cap, platform table isolation and mutation rejection",
  );
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = spawnSync(
      "docker",
      [
        "exec",
        "-e",
        "MYSQL_PWD",
        mysqlName,
        "mysqladmin",
        "ping",
        "-h127.0.0.1",
        "-uroot",
      ],
      { encoding: "utf8", env: { ...process.env, MYSQL_PWD: password } },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(ready, "MySQL failed to become ready");
  docker(
    [
      "exec",
      "-i",
      "-e",
      "MYSQL_PWD",
      mysqlName,
      "mysql",
      "-h127.0.0.1",
      "-uroot",
    ],
    "CREATE TABLE qa_external.items(id int PRIMARY KEY,name varchar(100)); INSERT INTO qa_external.items VALUES(1,'read-only sample'); REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'qa_reader'@'%'; GRANT SELECT ON qa_external.* TO 'qa_reader'@'%';",
    { MYSQL_PWD: password },
  );
  const mysql = (
    await api(
      `/workspaces/${workspace}/connections`,
      "POST",
      {
        name: "QA MySQL " + tag,
        engine: "mysql",
        host: mysqlName,
        port: 3306,
        database: "qa_external",
        user: "qa_reader",
        password,
        tls: false,
      },
      201,
    )
  ).id;
  connections.push(mysql);
  assert.ok(
    (await api(`/connections/${mysql}/query`, "POST", {})).rows.some(
      (r) => r.TABLE_NAME === "items" || r.table_name === "items",
    ),
  );
  assert.equal(
    (
      await api(`/connections/${mysql}/query`, "POST", {
        sql: "SELECT * FROM items",
      })
    ).rows[0].name,
    "read-only sample",
  );
  await api(
    `/connections/${mysql}/query`,
    "POST",
    { sql: "DELETE FROM items" },
    400,
  );
  await api(
    `/connections/${mysql}/query`,
    "POST",
    { sql: "SELECT 1; DELETE FROM items" },
    400,
  );
  await api(
    `/connections/${mysql}/query`,
    "POST",
    { sql: "SELECT * FROM mysql.user" },
    400,
  );
  const metadata = await api(`/workspaces/${workspace}/connections`);
  assert.ok(
    metadata.every((c) => !("config_cipher" in c) && !("password" in c)),
  );
  console.log(
    "PASS MySQL connection, object browsing, real SELECT, mutation rejection and credential redaction",
  );
} finally {
  for (const id of connections) await api(`/connections/${id}`, "DELETE", {});
  psql(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${role};`);
  docker(["rm", "-f", mysqlName]);
}
console.log("EXTERNAL DATABASE TESTS PASSED; disposable resources removed");
