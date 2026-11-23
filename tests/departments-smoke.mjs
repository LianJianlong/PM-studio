import fs from "node:fs/promises";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((l) => {
      const n = l.indexOf("=");
      return [l.slice(0, n).replace(/^\uFEFF/, ""), l.slice(n + 1)];
    }),
);
const tag = Date.now().toString(36);
function client() {
  let cookie = "";
  return async (path, method = "GET", body, status = 200) => {
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
    const data = await r.json();
    if (Array.isArray(status)) {
      assert.ok(
        status.includes(r.status),
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
      return { status: r.status, data };
    }
    assert.equal(
      r.status,
      status,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    return data;
  };
}

const admin = client(),
  editor = client(),
  targetUser = client();
await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const w = (
  await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
).id;
const manifest = { workspace: w, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
const save = () =>
  fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
await save();
const p = (
  await admin(
    `/workspaces/${w}/projects`,
    "POST",
    { name: "表移动验收", start_date: "2026-09-01" },
    201,
  )
).id;
const ctx = await admin(`/projects/${p}/context`);
const [source, target] = ctx.departments;
for (const [label, call, department] of [
  ["source", editor, source],
  ["target", targetUser, target],
]) {
  const u = await admin(
    `/workspaces/${w}/users`,
    "POST",
    {
      username: `qa_${tag}_${label}`,
      name: `移动${label}`,
      password: "Move-Test-2026!",
    },
    201,
  );
  manifest.users.push(u.id);
  await save();
  await admin(`/projects/${p}/members/${u.id}`, "PUT", {
    role: "editor",
    department_id: department.id,
    can_export: true,
  });
  await call("/login", "POST", {
    username: `qa_${tag}_${label}`,
    password: "Move-Test-2026!",
  });
}

const dep = await admin(
  `/projects/${p}/departments`,
  "POST",
  { name: "综合协调" },
  201,
);
assert.equal(dep.object_version, 1);
await admin(`/projects/${p}/departments`, "POST", { name: " 综合协调 " }, 409);
await admin(`/projects/${p}/departments`, "POST", { name: " " }, 400);
await editor(`/projects/${p}/departments`, "POST", { name: "不应创建" }, 403);
await editor(
  `/departments/${dep.id}`,
  "PATCH",
  { name: "不应修改", version: 1 },
  403,
);
console.log("PASS create, duplicate, invalid name and editor denial");
const table = await admin(
  `/projects/${p}/tables`,
  "POST",
  {
    name: "部门稳定引用",
    department_id: dep.id,
    columns: [{ id: "title", name: "事项", type: "text" }],
  },
  201,
);
await admin(`/projects/${p}/members/${manifest.users[0]}`, "PUT", {
  role: "editor",
  department_id: dep.id,
});
await admin(`/departments/${dep.id}`, "PATCH", {
  name: "综合管理",
  version: 1,
});
await admin(
  `/departments/${dep.id}`,
  "PATCH",
  { name: "旧版本覆盖", version: 1 },
  409,
);
assert.equal(
  (await editor(`/projects/${p}/tables`)).find((t) => t.id === table.id)
    .department_id,
  dep.id,
);
const renamed = (await admin(`/projects/${p}/departments`)).find(
  (d) => d.id === dep.id,
);
assert.equal(renamed.name, "综合管理");
assert.equal(renamed.object_version, 2);
await admin(
  `/departments/${dep.id}`,
  "PATCH",
  { name: source.name, version: 2 },
  409,
);
assert.equal(
  (await admin(`/projects/${p}/departments`)).find((d) => d.id === dep.id)
    .object_version,
  2,
);
const races = await Promise.all([
  admin(
    `/departments/${dep.id}`,
    "PATCH",
    { name: "并发甲", version: 2 },
    [200, 409],
  ),
  admin(
    `/departments/${dep.id}`,
    "PATCH",
    { name: "并发乙", version: 2 },
    [200, 409],
  ),
]);
assert.deepEqual(races.map((x) => x.status).sort(), [200, 409]);
console.log(
  "PASS rename preserves table and member scope, stale rejection and duplicate rollback",
);
const projects = await admin(`/objects/workspaces/${w}/projects`);
const version = projects.find((x) => x.id === p).object_version;
await admin(`/objects/project/${p}`, "PATCH", { version, lifecycle: "frozen" });
await admin(`/projects/${p}/departments`, "POST", { name: "冻结创建" }, 409);
await admin(
  `/departments/${dep.id}`,
  "PATCH",
  { name: "冻结改名", version: 3 },
  409,
);
await admin(`/objects/project/${p}`, "PATCH", {
  version: version + 1,
  lifecycle: "active",
});
const p2 = (
  await admin(
    `/workspaces/${w}/projects`,
    "POST",
    { name: "另一项目", start_date: "2026-09-01" },
    201,
  )
).id;
assert.equal((await admin(`/projects/${p2}/context`)).departments.length, 11);
await admin(`/projects/${p2}/departments`, "POST", { name: "并发甲" }, 201);
await editor(`/projects/${p2}/departments`, "POST", { name: "跨项目" }, 403);
await admin(`/projects/${p}/members/${manifest.users[0]}`, "PUT", {
  role: "manager",
});
await editor(`/projects/${p}/departments`, "POST", { name: "经理新增" }, 201);
console.log(
  "PASS frozen parent, project isolation, default department migration and manager access",
);
