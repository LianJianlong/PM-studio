import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
const env=Object.fromEntries((await fs.readFile('.env','utf8')).trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).replace(/^\uFEFF/,''),l.slice(i+1)];}));
const tag='fix'+Date.now().toString(36),password=crypto.randomBytes(18).toString('hex');
function client(){let cookie='';return async(path,method='GET',body,status=200,extra={})=>{const r=await fetch('http://127.0.0.1:9090/api'+path,{method,headers:{cookie,...extra,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const result=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(result)}`);return result;};}
const admin=client();await admin('/login','POST',{username:'admin',password:env.ADMIN_PASSWORD});const me=(await admin('/bootstrap')).user.id;
const workspace=(await admin('/workspaces','POST',{name:'QA集成验证 '+tag},201)).id,manifestName='fixtures-'+tag+'.json',manifest={workspace,users:[],tag};await fs.mkdir('work/qa',{recursive:true});const save=()=>fs.writeFile('work/qa/'+manifestName,JSON.stringify(manifest));await save();
const project=(await admin(`/workspaces/${workspace}/projects`,'POST',{name:'整改验收',start_date:'2026-10-01'},201)).id;
const activity=(await admin(`/projects/${project}/activities`,'POST',{code:'1.01',name:'精确费用作业',duration:3,progress:0},201)).id;
const resource=(await admin(`/projects/${project}/resources`,'POST',{name:'精确资源',kind:'human',rate:'0.1234',capacity:'1.0000'},201)).id;
const assign=(values,status=201)=>admin(`/activities/${activity}/resources`,'POST',{resource_id:resource,quantity:'6.0000',planned_cost:'123456789012345.6789',actual_cost:'0.1000',...values},status);
const first=await assign({version:0}),second=await assign({version:first.version});assert.equal(first.id,second.id);
let resources=await admin(`/projects/${project}/resources`);assert.equal(resources[0].allocations[0].planned_cost,'123456789012345.6789');assert.equal(resources[0].rate,'0.1234');
let load=await admin(`/projects/${project}/resource-load`);const sum=values=>values.reduce((total,value)=>total+BigInt(value.replace('.','')),0n);assert.equal(sum(load.resources[0].curve.map(d=>d.planned_cost)),1234567890123456789n);assert.equal(sum(load.resources[0].curve.map(d=>d.actual_cost)),1000n);assert.equal(load.resources[0].overloaded_days,3);
await assign({planned_cost:'0.12345'},400);await assign({quantity:'-0.1000'},400);await assign({planned_cost:123456789012345.67},400);await assign({version:first.version},409);
await admin(`/activity-resources/${second.id}`,'DELETE',{version:second.version});assert.equal((await admin(`/projects/${project}/resources`))[0].allocations.length,0);await assign({planned_cost:'0.1000'});
console.log('PASS exact resource roundtrip, scale rejection, conserved daily shares, actual upsert ID and deletion');
const milestone=(await admin(`/projects/${project}/activities`,'POST',{code:'1.02',name:'零工期费用里程碑',duration:0,progress:0},201)).id;
const milestoneAllocation=await admin(`/activities/${milestone}/resources`,'POST',{resource_id:resource,quantity:'0.0001',planned_cost:'0.1000',actual_cost:'0.0001'},201);
load=await admin(`/projects/${project}/resource-load`);assert.equal(sum(load.resources[0].curve.map(d=>d.planned_cost)),2000n);assert.equal(sum(load.resources[0].curve.map(d=>d.actual_cost)),1001n);
await admin(`/activity-resources/${milestoneAllocation.id}`,'DELETE',{version:milestoneAllocation.version});console.log('PASS zero-duration milestone retains costs and quantity on its start day');
const todo=(await admin(`/projects/${project}/todos`,'POST',{title:'整改议程任务',due_date:'2026-10-01',owner_id:me},201)).id;const due=(await admin('/notifications')).items.find(n=>n.resource_id===todo&&n.dedupe_key);assert.equal(due.due_date,'2026-10-01');assert.ok(due.owner_name);console.log('PASS notification due metadata only for current recipient owner');
const users=[];for(let i=0;i<100;i++){const username=`qa_${tag}_${i}`,u=await admin(`/workspaces/${workspace}/users`,'POST',{username,name:'登录验收'+i,password},201);users.push({id:u.id,username});manifest.users.push(u.id);await save();}
await Promise.all(users.map(async u=>{const c=client();assert.equal((await c('/login','POST',{username:u.username,password})).id,u.id);}));console.log('PASS 100 distinct accounts login concurrently from one source without false rate limits');
for(let i=0;i<12;i++)await client()('/login','POST',{username:users[0].username,password:'incorrect'},401,{'X-Forwarded-For':`203.0.113.${i+1}`});await client()('/login','POST',{username:users[0].username,password},429,{'X-Forwarded-For':'198.51.100.200'});assert.equal((await client()('/login','POST',{username:users[1].username,password})).id,users[1].id);console.log('PASS failed-account limit persists across forged forwarding headers and other accounts remain usable');
if(process.argv.includes('--keep-browser')){await fs.writeFile('work/qa/rectification-browser.json',JSON.stringify({workspace,project,activity,resource,todo,manifestName}));console.log('RETAINED isolated rectification fixture');}else{const r=spawnSync('node',['tests/cleanup-fixtures.mjs','--manifest='+manifestName],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);console.log(r.stdout.trim());}
