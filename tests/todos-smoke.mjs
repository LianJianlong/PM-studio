import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
const env = Object.fromEntries((await fs.readFile(".env", "utf8")).trim().split(/\r?\n/).map((line) => { const i = line.indexOf("="); return [line.slice(0, i).replace(/^\uFEFF/, ""), line.slice(i + 1)]; }));
const tag = `todo${Date.now().toString(36)}`, password = crypto.randomBytes(16).toString("hex");
function client() { let cookie = ""; return async (path, method = "GET", body, expected = 200) => {
  const response = await fetch("http://127.0.0.1:9090/api" + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";", 1)[0];
  const result = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`); return result;
}; }
const admin = client(), first = client(), second = client();
await admin("/login", "POST", { username: "admin", password: env.ADMIN_PASSWORD });
const workspace = (await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)).id;
const manifest = { workspace, users: [], tag }, manifestName = `fixtures-${tag}.json`;
await fs.mkdir("work/qa", { recursive: true }); const save = () => fs.writeFile(`work/qa/${manifestName}`, JSON.stringify(manifest)); await save();
const project = (await admin(`/workspaces/${workspace}/projects`, "POST", { name: "待办可靠性验证", start_date: "2026-01-01" }, 201)).id;
for (const [label, api] of [["first", first], ["second", second]]) {
  const username = `qa_${tag}_${label}`;
  const user = (await admin(`/workspaces/${workspace}/users`, "POST", { username, password, name: `待办验证${label}` }, 201)).id;
  manifest.users.push(user); await save(); await admin(`/projects/${project}/members/${user}`, "PUT", { role: "editor" }); await api("/login", "POST", { username, password });
}
const [owner, other] = manifest.users;
const create = (extra, status = 201) => admin(`/projects/${project}/todos`, "POST", { title: "月末任务", owner_id: owner, due_date: "2026-01-31", ...extra }, status);
const list = () => admin(`/projects/${project}/todos`);
const reminders = async (api, id) => (await api("/notifications")).items.filter((n) => n.resource_id === id && n.dedupe_key);
const monthly = (await create({ recurrence: "monthly", recurrence_until: "2026-03-31" })).id;
assert.equal((await reminders(first, monthly)).length, 1);
assert.equal((await reminders(first, monthly)).length, 1);
const completed = await Promise.all([first(`/todos/${monthly}`, "PATCH", { done: true }), first(`/todos/${monthly}`, "PATCH", { done: true })]);
assert.equal(completed[0].next_todo_id, completed[1].next_todo_id);
let children = (await list()).filter((t) => t.parent_todo_id === monthly);
assert.equal(children.length, 1); assert.equal(children[0].due_date.slice(0, 10), "2026-02-28");
assert.equal((await reminders(first, monthly)).length, 0);
await first(`/todos/${monthly}`, "PATCH", { title: "已完成事项仅改标题" });
await first(`/todos/${monthly}`, "PATCH", { done: false }); await first(`/todos/${monthly}`, "PATCH", { done: true });
assert.equal((await list()).filter((t) => t.parent_todo_id === monthly).length, 1);
const feb = children[0].id;
const marchId = (await first(`/todos/${feb}`, "PATCH", { done: true })).next_todo_id;
assert.equal((await list()).find((t) => t.id === marchId).due_date.slice(0, 10), "2026-03-31");
assert.equal((await first(`/todos/${marchId}`, "PATCH", { done: true })).next_todo_id, null);
console.log("PASS concurrent completion, replay/edit/reopen idempotency, monthly anchor and recurrence cutoff");
await create({ recurrence_until: "2026-01-01" }, 400);
const task = (await create({ title: "到期与版本测试", due_date: "2026-10-01" })).id;
const original = (await list()).find((t) => t.id === task);
await first(`/todos/${task}`, "PATCH", { title: "新版事项", owner_id: owner, version: original.version });
await first(`/todos/${task}`, "PATCH", { title: "覆盖旧版", version: original.version }, 409);
await first(`/todos/${task}`, "PATCH", { recurrence_until: "2026-09-01" }, 400);
assert.equal((await reminders(first, task)).length, 1);
await admin(`/todos/${task}`, "PATCH", { owner_id: other });
assert.equal((await reminders(first, task)).length, 0); assert.equal((await reminders(second, task)).length, 1);
await first(`/todos/${task}`, "PATCH", { done: true }, 403);
await second(`/todos/${task}`, "PATCH", { due_date: "2028-01-01" });
assert.equal((await reminders(second, task)).length, 0);
await second(`/todos/${task}`, "DELETE", {});
await second(`/todos/${task}`, "PATCH", { done: true }, 409);
await admin(`/todos/${task}/restore`, "POST", {});
await second(`/todos/${task}`, "PATCH", { due_date: "2026-09-30" });
assert.equal((await reminders(second, task)).length, 1);
await second(`/todos/${task}`, "DELETE", {});
assert.equal((await reminders(second, task)).length, 0);
console.log("PASS stale version, invalid cutoff, reassignment permissions, reschedule and archive reminder invalidation");
await admin(`/projects/${project}/members/${other}`, "PUT", { role: "editor", expires_at: new Date(Date.now() + 60_000).toISOString() });
const expired = spawnSync("docker", ["compose", "exec", "-T", "db", "psql", "-U", "studio", "-d", "project_studio", "-v", "ON_ERROR_STOP=1", "-c", `UPDATE memberships SET expires_at=now()-interval '1 second' WHERE project_id='${project}' AND user_id='${other}'`], { encoding: "utf8" });
assert.equal(expired.status, 0, expired.stderr);
assert.ok(!(await second("/notifications")).items.some((n) => n.project_id === project));
console.log("PASS expired project permission excludes all project notifications");
if (process.argv.includes("--keep-browser")) {
  const ui = (await create({ title: "浏览器重复待办", due_date: "2026-10-01", recurrence: "weekly", owner_id: (await admin("/bootstrap")).user.id })).id;
  await fs.writeFile("work/qa/todo-browser.json", JSON.stringify({ workspace, project, todoId: ui, manifestName }));
  console.log(`BROWSER_WORKSPACE QA集成验证 ${tag}`);
} else {
  const result = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=${manifestName}`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); console.log(result.stdout.trim());
}
