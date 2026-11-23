import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const tag='network'+Date.now().toString(36),password=crypto.randomBytes(18).toString('hex');
function client(){let cookie='';return async(path,method='GET',body,status=200)=>{
  const r=await fetch('http://127.0.0.1:9090/api'+path,{method,headers:{cookie,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  assert.equal(r.status,status,`${method} ${path}: ${r.status!==status?await r.text():''}`);return r.json();
}}
const admin=client(),viewer=client(),editor=client();
const seed=(await fs.readFile('.env','utf8')).match(/^ADMIN_PASSWORD=(.*)$/m)[1].trim();
await admin('/login','POST',{username:'admin',password:seed});
const workspace=(await admin('/workspaces','POST',{name:'QA集成验证 '+tag},201)).id;
const manifestName=`fixtures-${tag}.json`,manifest={workspace,tag,users:[]};
const persist=()=>fs.writeFile('work/qa/'+manifestName,JSON.stringify(manifest));await persist();
const project=(await admin(`/workspaces/${workspace}/projects`,'POST',{name:'独立网络计划验收',start_date:'2026-10-08'},201)).id;
const other=(await admin(`/workspaces/${workspace}/projects`,'POST',{name:'另一项目',start_date:'2026-10-08'},201)).id;
for(const [role,c] of [['viewer',viewer],['editor',editor]]){
  const username=`qa_${tag}_${role}`,user=await admin(`/workspaces/${workspace}/users`,'POST',{username,name:role,password},201);
  manifest.users.push(user.id);await persist();await admin(`/projects/${project}/members/${user.id}`,'PUT',{role});
  await c('/login','POST',{username,password});
}
const a=(await admin(`/projects/${project}/activities`,'POST',{code:'A',name:'详细作业一',duration:2,progress:0},201)).id;
const b=(await admin(`/projects/${project}/activities`,'POST',{code:'B',name:'详细作业二',duration:4,progress:0,predecessors:[{id:a,type:'FS',lag:1}]},201)).id;
const base=`/projects/${project}/network-plans`,metadata={name:'阶段总控',granularity:'总控计划',start_date:'2026-10-08'};
assert.equal((await admin(base)).plans.length,0);
await viewer(base,'POST',metadata,403);await editor(base,'POST',metadata,403);
const copy=(await admin(base,'POST',{...metadata,source:'gantt'},201)).id;
let data=await admin(`${base}/${copy}`);assert.equal(data.work_duration,7);
assert.ok(data.plan.activities.every(x=>![a,b].includes(x.id)));
assert.equal((await viewer(`${base}/${copy}`)).can_write,false);
await admin(`/projects/${other}/network-plans/${copy}`,'GET',undefined,404);
console.log('PASS independent Gantt copy, isolated identifiers, read permissions and cross-project denial');
let doc={name:data.plan.name,granularity:data.plan.granularity,start_date:data.plan.start_date,activities:data.plan.activities};
doc.activities[1].duration=9;
await viewer(`${base}/${copy}`,'PUT',{version:data.plan.version,document:doc},403);
await editor(`${base}/${copy}`,'PUT',{version:data.plan.version,document:doc});
await admin(`${base}/${copy}`,'PUT',{version:data.plan.version,document:doc},409);
data=await admin(`${base}/${copy}`);assert.equal(data.work_duration,12);
assert.equal((await admin(`/projects/${project}/plan`)).activities.find(x=>x.id===b).duration,4);
const ga=(await admin(`/projects/${project}/plan`)).activities.find(x=>x.id===a);
await admin(`/projects/${project}/activities/${a}`,'PUT',{...ga,duration:5,version:ga.version});
assert.equal((await admin(`${base}/${copy}`)).plan.activities[0].duration,2);
await editor(`${base}/${copy}`,'PUT',{version:data.plan.version,document:{...doc,name:'越权改名'}},403);
const cyclic=structuredClone(doc);cyclic.activities[0].predecessors=[{id:cyclic.activities[1].id,type:'FS',lag:0}];
await admin(`${base}/${copy}`,'PUT',{version:data.plan.version,document:cyclic},400);
assert.equal((await admin(`${base}/${copy}`)).plan.version,data.plan.version);
const invalid=structuredClone(doc);invalid.activities[0].predecessors=[{id:a,type:'FS',lag:0}];
await admin(`${base}/${copy}`,'PUT',{version:data.plan.version,document:invalid},400);
console.log('PASS bidirectional independence, editor task edits, protected settings, stale versions and cyclic/foreign references');
const blank=(await admin(base,'POST',{...metadata,name:'粗粒度空白计划',granularity:'阶段计划'},201)).id;
assert.equal((await admin(`${base}/${blank}`)).plan.activities.length,0);
const duplicate=(await admin(base,'POST',{...metadata,name:'细粒度副本',granularity:'详细计划',source:'network',source_id:copy},201)).id;
assert.equal((await admin(`${base}/${duplicate}`)).work_duration,12);
await viewer(`${base}/${blank}`,'DELETE',{version:1},403);
await admin(`${base}/${blank}`,'DELETE',{version:1});await admin(`${base}/${blank}`,'GET',undefined,404);
await admin(`${base}/${blank}`,'DELETE',{version:1},409);
assert.equal((await admin(base)).plans.length,2);
console.log('PASS multiple granularities, empty plans, isolated plan duplication and guarded deletion');
if(process.argv.includes('--keep-browser')) {
  await fs.writeFile('work/qa/network-plans-browser.json',JSON.stringify({workspace,project,copy,duplicate,manifestName}));console.log('RETAINED network plans fixture');
} else {
  const r=spawnSync(process.execPath,['tests/cleanup-fixtures.mjs','--manifest='+manifestName],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);console.log(r.stdout.trim());
}
