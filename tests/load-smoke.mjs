// Local 100-session smoke check, isolated synthetic project; not a production SLA.
import fs from "node:fs/promises";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const tag = Date.now().toString(36),
  workspace = crypto.randomUUID(),
  project = crypto.randomUUID(),
  department = crypto.randomUUID(),
  table = crypto.randomUUID();
const clients = Array.from({ length: 100 }, (_, i) => ({
  id: crypto.randomUUID(),
  token: crypto.randomBytes(32).toString("hex"),
  i,
}));
const sql = (command) => {
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
      "-qAt",
    ],
    { input: command, encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout;
};
const values = clients
  .map(
    (c) =>
      `('${c.id}','qa_${tag}_${c.i}','并发验证账号 ${c.i}','disabled-for-test')`,
  )
  .join(",");
await fs.mkdir("work/qa", { recursive: true });
const fixturePath = `work/qa/fixtures-${tag}.json`;
await fs.writeFile(
  fixturePath,
  JSON.stringify({ workspace, users: clients.map((c) => c.id), tag }),
);
sql(`BEGIN;
INSERT INTO workspaces(id,name) VALUES('${workspace}','QA集成验证 ${tag}');
INSERT INTO users(id,username,name,password_hash) VALUES${values};
INSERT INTO projects(id,workspace_id,name,start_date) VALUES('${project}','${workspace}','100会话性能样例','2026-09-01');
INSERT INTO departments(id,project_id,name) VALUES('${department}','${project}','工程');
INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES('${table}','${project}','${department}','并发样例','[{"id":"title","name":"事项","type":"text"},{"id":"amount","name":"数量","type":"number"}]');
${clients.map((c) => `INSERT INTO workspace_members VALUES('${workspace}','${c.id}','member'); INSERT INTO memberships(id,project_id,user_id,role) VALUES('${crypto.randomUUID()}','${project}','${c.id}','viewer'); INSERT INTO sessions VALUES('${crypto.createHash("sha256").update(c.token).digest("hex")}','${c.id}',now()+interval '15 minutes');`).join("\n")}
INSERT INTO records(id,table_id,data,status,created_by) SELECT gen_random_uuid(),'${table}',jsonb_build_object('title','性能样例 '||n,'amount',n),'approved','${clients[0].id}' FROM generate_series(1,2000)n;
INSERT INTO activities(id,project_id,code,name,duration) SELECT gen_random_uuid(),'${project}','L.'||n,'并发样例作业 '||n,10 FROM generate_series(1,200)n;
COMMIT;`);
const paths = [
  `/projects/${project}/summary`,
  `/tables/${table}/records`,
  `/projects/${project}/plan`,
  `/projects/${project}/context`,
];
const latencies = [],
  errors = [];
const start = performance.now();
try {
  await Promise.all(
    clients.map(async (client) => {
      for (let i = 0; i < 8; i++) {
        const path = paths[i % paths.length],
          t = performance.now();
        try {
          const r = await fetch("http://localhost:9090/api" + path, {
            headers: { cookie: "studio_session=" + client.token },
            signal: AbortSignal.timeout(30000),
          });
          assert.equal(r.status, 200);
          const data = await r.json();
          if (path.endsWith("/summary"))
            assert.equal(data.counts.approved, 2000);
          if (path.endsWith("/records")) assert.equal(data.total, 2000);
          if (path.endsWith("/plan")) assert.equal(data.activities.length, 200);
        } catch (e) {
          errors.push({ path, message: e.message });
        }
        latencies.push(performance.now() - t);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const elapsed = performance.now() - start;
  const percentile = (p) =>
    Math.round(
      latencies[
        Math.min(latencies.length - 1, Math.floor(latencies.length * p))
      ],
    );
  const result = {
    date: new Date().toISOString(),
    environment: "local Docker, synthetic project",
    accounts: 100,
    maxConcurrent: 100,
    records: 2000,
    activities: 200,
    requests: latencies.length,
    failures: errors.length,
    elapsedMs: Math.round(elapsed),
    requestsPerSecond: Number(((latencies.length * 1000) / elapsed).toFixed(1)),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: Math.round(latencies.at(-1)),
    limitations:
      "Read-only API workload; excludes password login, writes, large files, internet latency and real business data.",
  };
  await fs.mkdir("outputs/test-results", { recursive: true });
  await fs.writeFile(
    "outputs/test-results/load-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  assert.equal(errors.length, 0, JSON.stringify(errors.slice(0, 3)));
} finally {
  const r = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw Error("Load fixture cleanup failed: " + r.stderr);
  console.log(r.stdout.trim());
}
