// Repeatable local acceptance: every run owns only the manifests it creates.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "outputs", "test-results", `regression-${Date.now()}`);
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(path.join(root, "work", "qa"), { recursive: true });
const before = new Set(await fs.readdir(path.join(root, "work", "qa")));
const keep = process.argv.includes("--keep-browser"), results = [];
for (let attempt = 0; ; attempt++) {
  try { const health = await fetch("http://127.0.0.1:9090/api/health"); if (health.ok) break; } catch {}
  if (attempt >= 20) throw Error("9090服务尚未健康，未启动回归");
  await new Promise((resolve) => setTimeout(resolve, 500));
}
async function run(name, args) {
  const started = Date.now(); let log = "";
  const child = spawn(process.execPath, process.env.QA_ADMIN_PASSWORD ? ['--import',new URL('./qa-login-override.mjs',import.meta.url).href,...args] : args, { cwd: root, env: {...process.env, ...(name==='recycle-admin-smoke' && process.env.QA_ADMIN_PASSWORD ? {QA_ADMIN_USERNAME:'superadmin'} : {})} });
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  const code = await new Promise((resolve) => { child.on("close", resolve); child.on("error", () => resolve(-1)); });
  await fs.writeFile(path.join(directory, `${name}.log`), log);
  const result = { name, code, elapsedMs: Date.now() - started, groups: (log.match(/^PASS /gm) || []).length };
  results.push(result); console.log(JSON.stringify(result));
  await fs.writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
  return code;
}
await run("unit", ["node_modules/tsx/dist/cli.mjs", "--test", "tests/*.test.ts"]);
await run("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]);
await run("recycle-admin-smoke", ["tests/recycle-admin-smoke.mjs", "--keep-browser"]);
await run("batch-delete-smoke", ["tests/batch-delete-smoke.mjs", "--keep-browser"]);
await run("column-calendar-smoke", ["--import", "tsx", "tests/column-calendar-smoke.mjs", "--keep-browser"]);
await run("dashboard-smoke", ["tests/dashboard-smoke.mjs", "--keep-browser"]);
await run("public-views-smoke", ["tests/public-views-smoke.mjs", "--keep-browser"]);
await run("audit-rectification-smoke", ["tests/audit-rectification-smoke.mjs", "--keep-browser"]);
await run("p2-review-smoke", ["tests/p2-review-smoke.mjs", "--keep-browser"]);
await run("security-hardening-smoke", ["tests/security-hardening-smoke.mjs", "--keep-browser"]);
await run("review-rectification-smoke", ["tests/review-rectification-smoke.mjs", "--keep-browser"]);
for (const name of ["integration", "departments-smoke", "types-smoke", "choice-audit-smoke", "references-smoke", "table-moves-smoke", "permissions-smoke", "workflow-smoke", "lifecycle-smoke", "files-smoke", "owner-items-smoke", "query-library-smoke", "report-documents-smoke", "todos-smoke", "rectification-smoke", "business-links-smoke", "permission-explanation-smoke", "crud-permissions-smoke", "plan-table-smoke", "ai-smoke", "planning-workbench-smoke", "network-plans-smoke", "ai-database-smoke"]) {
  await run(name, [`tests/${name}.mjs`, "--keep-browser"]);
}
const owned = (await fs.readdir(path.join(root, "work", "qa"))).filter((name) => /^fixtures(?:-[a-z0-9]+)?\.json$/.test(name) && !before.has(name));
await fs.writeFile(path.join(directory, "owned-manifests.json"), JSON.stringify(owned, null, 2));
if (!keep) for (const name of owned) await run(`cleanup-${name}`, ["tests/cleanup-fixtures.mjs", `--manifest=${name}`]);
console.log(`Evidence: ${directory}`);
if (results.some((item) => item.code !== 0)) process.exitCode = 1;
