import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
const t = (
  await admin(
    `/projects/${p}/tables`,
    "POST",
    {
      name: "移动台账",
      department_id: source.id,
      columns: [{ id: "title", name: "事项", type: "text", required: true }],
    },
    201,
  )
).id;
const record = (
  await editor(
    `/tables/${t}/records`,
    "POST",
    { data: { title: "保留标识与内容" } },
    201,
  )
).id;
const linkedTable = (await admin(`/projects/${p}/tables`, 'POST', {
  name: '移动引用验证', department_id: target.id,
  columns: [{id:'title',name:'事项',type:'text'}, {id:'ref',name:'关联',type:'reference',target_table:t,display_column:'title',bidirectional:true,inverse_name:'反向关联'}]
},201)).id;
const linkedRecord=(await admin(`/tables/${linkedTable}/records`,'POST',{data:{title:'保留关系',ref:[record]}},201)).id;
assert.deepEqual((await targetUser(`/tables/${linkedTable}/records`)).rows[0].data.ref,[]);
const peek = (dep) => admin(`/tables/${t}/move-preview?department=${dep}`);
const move = (dep, preview, status = 200) =>
  admin(
    `/tables/${t}/move`,
    "POST",
    {
      department_id: dep,
      version: preview.version,
      fingerprint: preview.fingerprint,
    },
    status,
  );
await editor(
  `/tables/${t}/move-preview?department=${target.id}`,
  "GET",
  undefined,
  403,
);
await peek(source.id).then(
  () => assert.fail("same department accepted"),
  (e) => assert.match(e.message, /400/),
);
const first = await peek(target.id);
assert.equal(first.changes.length, 2);
assert.equal(first.pending, 0);
await admin(`/projects/${p}/members/${manifest.users[0]}`, "PUT", {
  role: "editor",
  department_id: source.id,
  can_export: false,
});
await move(target.id, first, 409);
const fresh = await peek(target.id);
await move(target.id, fresh);
const moved = (await admin(`/projects/${p}/tables`)).find((r) => r.id === t);
assert.equal(moved.department_id, target.id);
assert.equal(moved.object_version, fresh.version + 1);
await editor(`/tables/${t}/records`, "GET", undefined, 403);
await editor(
  `/tables/${t}/records`,
  "POST",
  { data: { title: "不得越权" } },
  403,
);
await editor(
  `/tables/${t}/import`,
  "POST",
  { rows: [{ title: "不得越权导入" }] },
  403,
);
await editor(
  `/records/${record}`,
  "PUT",
  { version: 1, data: { title: "不得越权更新" } },
  403,
);
const visible = await targetUser(`/tables/${t}/records`);
assert.equal(visible.rows[0].id, record);
assert.equal(visible.rows[0].data.title, "保留标识与内容");
assert.deepEqual((await targetUser(`/tables/${linkedTable}/records`)).rows[0].data.ref,[record]);
assert.equal((await targetUser(`/tables/${linkedTable}/records`)).rows[0].references.ref.items[0].label,'保留标识与内容');
const reverse=moved.columns.find(f=>f.type==='backlink').id;
assert.deepEqual(visible.rows[0].data[reverse],[linkedRecord]);
console.log(
  "PASS preview access changes, stale grant rejection, retained record identity and immediate read/write/import scope changes",
);
const stale = await peek(source.id);
await admin(`/objects/table/${t}`, "PATCH", {
  version: moved.object_version,
  name: "移动后台账",
});
await move(source.id, stale, 409);
const rows = await admin(`/objects/projects/${p}/tables`);
const version = rows.find((r) => r.id === t).object_version;
await admin(`/objects/table/${t}`, "PATCH", { version, lifecycle: "frozen" });
await admin(
  `/tables/${t}/move-preview?department=${source.id}`,
  "GET",
  undefined,
  409,
);
await admin(`/objects/table/${t}`, "PATCH", {
  version: version + 1,
  lifecycle: "active",
});
const p2 = (
  await admin(
    `/workspaces/${w}/projects`,
    "POST",
    { name: "隔离项目", start_date: "2026-09-01" },
    201,
  )
).id;
const foreign = (await admin(`/projects/${p2}/context`)).departments[0].id;
await admin(
  `/tables/${t}/move-preview?department=${foreign}`,
  "GET",
  undefined,
  400,
);
console.log(
  "PASS stale table rejection, frozen table protection and cross-project department rejection",
);
await admin(`/projects/${p}/members/${manifest.users[1]}`, "PUT", {
  role: "reviewer",
  department_id: target.id,
});
const ap = (
  await admin(
    `/projects/${p}/approvals`,
    "POST",
    {
      kind: "record",
      title: "移动待审保护",
      record_id: record,
      approver_id: manifest.users[1],
    },
    201,
  )
).id;
const pending = await peek(source.id);
assert.equal(pending.pending, 1);
await move(source.id, pending, 409);
await targetUser(`/approvals/${ap}/decide`, "POST", { action: "approve" });
await move(source.id, await peek(source.id));
const after = (await admin(`/tables/${t}/records`)).rows[0];
assert.equal(after.status, "approved");
assert.equal(after.id, record);
console.log(
  "PASS pending move rejection and approved record identity preservation",
);
// Queue the move before a writer behind the real project's relationship lock.
// The writer has already passed initial authorization when the move commits.
const queuedPreview = await peek(target.id);
const blocker = spawn('docker', ['compose','exec','-T','db','psql','-U','studio','-d','project_studio','-At'], {stdio:['pipe','pipe','pipe']});
const ready = new Promise((resolve,reject)=>{
  let output=''; const timer=setTimeout(()=>reject(Error('lock setup timeout')),10000);
  blocker.stdout.on('data',chunk=>{output+=chunk; if(output.includes('MOVE_LOCK_READY')){clearTimeout(timer);resolve();}});
  blocker.on('error',reject);
});
const finished = new Promise(resolve=>blocker.on('close',resolve));
blocker.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('${p}',703)); SELECT 'MOVE_LOCK_READY';\n`);
let moving, writing;
async function waitQueue(count){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    const r=spawnSync('docker',['compose','exec','-T','db','psql','-U','studio','-d','project_studio','-At','-c',`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND ((classid::bigint << 32) | objid::bigint)=hashtextextended('${p}',703) AND NOT granted`],{encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    if(Number(r.stdout.trim())>=count)return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('queued operation not observed');
}
try {
  await ready;
  moving=move(target.id,queuedPreview); moving.catch(()=>{});
  await waitQueue(1);
  writing=editor(`/tables/${t}/records`,'POST',{data:{title:'旧权限并发写入'}},403); writing.catch(()=>{});
  await waitQueue(2);
} finally { blocker.stdin.end('COMMIT;\n'); await finished; }
await Promise.all([moving,writing]);
assert.equal((await admin(`/tables/${t}/records`)).total,1);
console.log('PASS queued writer reauthorizes after table move and cannot insert with old department permission');
console.log(`BROWSER_WORKSPACE QA集成验证 ${tag}`);
