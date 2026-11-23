// Run against the local Docker deployment after files.sql and files router are integrated.
// Creates only an isolated QA workspace recorded for tests/cleanup-fixtures.mjs.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";

const env = Object.fromEntries(
  (await fs.readFile(".env", "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const split = line.indexOf("=");
      return [
        line.slice(0, split).replace(/^\uFEFF/, ""),
        line.slice(split + 1),
      ];
    }),
);
const base = "http://localhost:9090/api";
const tag = `files${Date.now().toString(36)}`;
const password = crypto.randomBytes(18).toString("hex");

function client() {
  let cookie = "";
  return async (path, method = "GET", body, expected = 200) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";", 1)[0];
    if (response.status !== expected)
      throw new Error(
        `${method} ${path}: expected ${expected}, got ${response.status} ${await response.text()}`,
      );
    if (response.headers.get("content-type")?.includes("json"))
      return response.json();
    return Buffer.from(await response.arrayBuffer());
  };
}

const admin = client();
const editor = client();
const manager = client();
const viewer = client();
const outsider = client();
await admin("/login", "POST", {
  username: "admin",
  password: env.ADMIN_PASSWORD,
});
const workspace = (
  await admin("/workspaces", "POST", { name: `QA集成验证 ${tag}` }, 201)
).id;
const manifest = { workspace, users: [], tag };
await fs.mkdir("work/qa", { recursive: true });
await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));

async function createUser(label) {
  const username = `qa_${tag}_${label}`;
  const result = await admin(
    `/workspaces/${workspace}/users`,
    "POST",
    { username, name: `文件测试${label}`, password },
    201,
  );
  manifest.users.push(result.id);
  await fs.writeFile(`work/qa/fixtures-${tag}.json`, JSON.stringify(manifest));
  return { ...result, username };
}

const editorUser = await createUser("editor");
const managerUser = await createUser("manager");
const viewerUser = await createUser("viewer");
const outsiderUser = await createUser("outsider");
const project = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    {
      name: "文件模块验证",
      start_date: "2026-09-28",
      description: "隔离文件 QA",
    },
    201,
  )
).id;
const secondProject = (
  await admin(
    `/workspaces/${workspace}/projects`,
    "POST",
    { name: "文件项目隔离验证", start_date: "2026-09-28" },
    201,
  )
).id;
await admin(`/projects/${project}/members/${editorUser.id}`, "PUT", {
  role: "editor",
});
await admin(`/projects/${project}/members/${managerUser.id}`, "PUT", {
  role: "manager",
});
await admin(`/projects/${project}/members/${viewerUser.id}`, "PUT", {
  role: "viewer",
});
await editor("/login", "POST", { username: editorUser.username, password });
await manager("/login", "POST", { username: managerUser.username, password });
await viewer("/login", "POST", { username: viewerUser.username, password });
await outsider("/login", "POST", { username: outsiderUser.username, password });

const root = await manager(
  `/projects/${project}/folders`,
  "POST",
  { name: "设计资料", parent_id: null },
  201,
);
const nested = await editor(
  `/projects/${project}/folders`,
  "POST",
  { name: "第一批", parent_id: root.id },
  201,
);
await viewer(`/projects/${project}/folders`, "POST", { name: "越权目录" }, 403);
await outsider(`/projects/${project}/files`, "GET", undefined, 403);

const firstBytes = Buffer.from("stable id, version one\n", "utf8");
const uploaded = await editor(
  `/projects/${project}/files`,
  "POST",
  {
    name: "说明.txt",
    parent_id: nested.id,
    mime_type: "text/plain",
    content_base64: firstBytes.toString("base64"),
  },
  201,
);
assert.equal(uploaded.current_version, 1);
await editor(
  `/projects/${project}/files`,
  "POST",
  {
    name: "说明.txt",
    parent_id: nested.id,
    mime_type: "text/plain",
    content_base64: firstBytes.toString("base64"),
  },
  409,
);
await editor(
  `/projects/${project}/files`,
  "POST",
  {
    name: "路径/注入.txt",
    parent_id: nested.id,
    mime_type: "text/plain",
    content_base64: firstBytes.toString("base64"),
  },
  400,
);
await editor(
  `/projects/${project}/files`,
  "POST",
  {
    name: "伪装.pdf",
    parent_id: nested.id,
    mime_type: "text/plain",
    content_base64: firstBytes.toString("base64"),
  },
  400,
);
await editor(
  `/projects/${project}/files`,
  "POST",
  { name: "错误.txt", mime_type: "text/plain", content_base64: "not-base64" },
  400,
);

let listing = await viewer(`/projects/${project}/files?parent=${nested.id}`);
assert.equal(listing.rows.length, 1);
assert.equal(listing.rows[0].id, uploaded.id);
assert.deepEqual(await viewer(`/files/${uploaded.id}/download`), firstBytes);
assert.deepEqual(
  await viewer(`/files/${uploaded.id}/download?version=1`),
  firstBytes,
);
await outsider(`/files/${uploaded.id}/download`, "GET", undefined, 403);
const search = await viewer(
  `/projects/${project}/files?search=${encodeURIComponent("说明")}`,
);
assert.equal(search.rows[0].id, uploaded.id);

const secondBytes = Buffer.from("stable id, version two\n", "utf8");
const versioned = await editor(
  `/files/${uploaded.id}/versions`,
  "POST",
  {
    version: uploaded.object_version,
    mime_type: "text/plain",
    content_base64: secondBytes.toString("base64"),
  },
  201,
);
assert.equal(versioned.id, uploaded.id);
assert.equal(versioned.current_version, 2);
assert.deepEqual(
  (await viewer(`/files/${uploaded.id}/versions`)).map((v) => v.version),
  [2, 1],
);
await outsider(`/files/${uploaded.id}/versions`, "GET", undefined, 403);
assert.deepEqual(await viewer(`/files/${uploaded.id}/download`), secondBytes);
assert.deepEqual(
  await viewer(`/files/${uploaded.id}/download?version=1`),
  firstBytes,
);
await editor(
  `/files/${uploaded.id}/versions`,
  "POST",
  {
    version: uploaded.object_version,
    mime_type: "text/plain",
    content_base64: secondBytes.toString("base64"),
  },
  409,
);

const secondRoot = await admin(
  `/projects/${secondProject}/folders`,
  "POST",
  { name: "另一项目目录" },
  201,
);
await editor(
  `/files/${uploaded.id}`,
  "PATCH",
  { version: versioned.object_version, parent_id: secondRoot.id },
  400,
);
await editor(
  `/files/${root.id}`,
  "PATCH",
  { version: root.object_version, parent_id: nested.id },
  400,
);
const renamed = await editor(`/files/${uploaded.id}`, "PATCH", {
  version: versioned.object_version,
  name: "施工说明.txt",
  parent_id: root.id,
});
assert.equal(renamed.id, uploaded.id);
assert.equal(renamed.parent_id, root.id);

const copiedFolder = await manager(
  `/files/${root.id}/copy`,
  "POST",
  { version: root.object_version, name: "设计资料副本", parent_id: null },
  201,
);
const copiedChildren = await viewer(
  `/projects/${project}/files?parent=${copiedFolder.id}`,
);
assert.ok(copiedChildren.rows.some((row) => row.name === "施工说明.txt"));
await manager(
  `/files/${root.id}/copy`,
  "POST",
  { version: root.object_version, name: "设计资料副本", parent_id: null },
  409,
);

const beforeDelete = (
  await viewer(`/projects/${project}/files?parent=${root.id}`)
).rows.find((row) => row.id === uploaded.id);
await editor(`/files/${uploaded.id}`, "DELETE", {
  version: beforeDelete.object_version,
});
await viewer(`/files/${uploaded.id}/download`, "GET", undefined, 404);
await viewer(`/projects/${project}/files?deleted=true`, "GET", undefined, 403);
const trash = await editor(`/projects/${project}/files?deleted=true`);
const deleted = trash.rows.find((row) => row.id === uploaded.id);
assert.ok(deleted);
const conflicting = await editor(
  `/projects/${project}/files`,
  "POST",
  {
    name: "施工说明.txt",
    parent_id: root.id,
    mime_type: "text/plain",
    content_base64: Buffer.from("replacement").toString("base64"),
  },
  201,
);
await editor(
  `/files/${uploaded.id}/restore`,
  "POST",
  { version: deleted.object_version, name: "施工说明.txt", parent_id: root.id },
  409,
);
const restored = await editor(`/files/${uploaded.id}/restore`, "POST", {
  version: deleted.object_version,
  name: "施工说明-恢复.txt",
  parent_id: root.id,
});
assert.equal(restored.id, uploaded.id);
assert.deepEqual(await viewer(`/files/${uploaded.id}/download`), secondBytes);

const copyState = (await manager(`/projects/${project}/files`)).rows.find(
  (row) => row.id === copiedFolder.id,
);
await manager(`/files/${copiedFolder.id}`, "DELETE", {
  version: copyState.object_version,
});
const deletedFolder = (
  await manager(`/projects/${project}/files?deleted=true`)
).rows.find((row) => row.id === copiedFolder.id);
await manager(`/files/${copiedFolder.id}/restore`, "POST", {
  version: deletedFolder.object_version,
  name: "设计资料恢复",
  parent_id: null,
});
assert.ok(
  (await viewer(`/projects/${project}/files?parent=${copiedFolder.id}`)).rows
    .length,
);

let projectState = (
  await admin(`/objects/workspaces/${workspace}/projects`)
).find((row) => row.id === project);
await admin(`/objects/project/${project}`, "PATCH", {
  version: projectState.object_version,
  lifecycle: "frozen",
});
await editor(
  `/projects/${project}/folders`,
  "POST",
  { name: "冻结期越权目录" },
  409,
);
projectState = (await admin(`/objects/workspaces/${workspace}/projects`)).find(
  (row) => row.id === project,
);
await admin(`/objects/project/${project}`, "PATCH", {
  version: projectState.object_version,
  lifecycle: "active",
});

const audits = await admin(`/workspaces/${workspace}/audit`);
for (const action of [
  "新建项目文件夹",
  "上传项目文件",
  "上传项目文件新版本",
  "更新项目文件位置或名称",
  "复制项目文件",
  "软删除项目文件",
  "恢复项目文件",
])
  assert.ok(
    audits.some((row) => row.action === action),
    `missing audit: ${action}`,
  );
assert.ok(conflicting.id);
console.log(
  "PASS file access, validation, stable versions, authenticated downloads and search",
);
console.log(
  "PASS move isolation, recursive copy, soft delete/restore conflicts, lifecycle and audit",
);

// A folder restore must not resurrect files deleted in an earlier operation.
const batchFolder = await editor(
  `/projects/${project}/folders`,
  "POST",
  { name: "恢复批次验证" },
  201,
);
const oldDeleted = await editor(
  `/projects/${project}/files`,
  "POST",
  {
    name: "早已删除.txt",
    parent_id: batchFolder.id,
    mime_type: "text/plain",
    content_base64: firstBytes.toString("base64"),
  },
  201,
);
await editor(`/files/${oldDeleted.id}`, "DELETE", { version: 1 });
await editor(`/files/${batchFolder.id}`, "DELETE", { version: 1 });
await editor(`/files/${batchFolder.id}/restore`, "POST", { version: 2 });
assert.equal(
  (await viewer(`/projects/${project}/files?parent=${batchFolder.id}`)).rows
    .length,
  0,
);
await viewer(`/files/${oldDeleted.id}/download`, "GET", undefined, 404);
// Two concurrent opposing moves must never create a cyclic folder tree.
const left = await editor(
  `/projects/${project}/folders`,
  "POST",
  { name: "并发左" },
  201,
);
const right = await editor(
  `/projects/${project}/folders`,
  "POST",
  { name: "并发右" },
  201,
);
const moves = await Promise.allSettled([
  editor(`/files/${left.id}`, "PATCH", { version: 1, parent_id: right.id }),
  editor(`/files/${right.id}`, "PATCH", { version: 1, parent_id: left.id }),
]);
assert.equal(moves.filter((r) => r.status === "fulfilled").length, 1);
const rejected = moves.find((r) => r.status === "rejected");
assert.match(String(rejected.reason), /got 400/);
console.log("PASS deletion batch isolation and concurrent cycle prevention");

if (process.argv.includes("--keep-browser")) {
  await fs.writeFile(
    "work/qa/files-browser.json",
    JSON.stringify({ workspace, project, tag, file: restored.id }),
  );
  console.log("RETAINED isolated files fixture for browser QA");
  process.exit(0);
}

const cleanup = spawnSync("node", ["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`], {
  encoding: "utf8",
});
assert.equal(cleanup.status, 0, cleanup.stderr);
console.log(cleanup.stdout.trim());
