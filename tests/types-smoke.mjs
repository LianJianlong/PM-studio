import fs from "node:fs/promises";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { spawnSync } from "node:child_process";
const env=Object.fromEntries((await fs.readFile(".env","utf8")).trim().split(/\r?\n/).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).replace(/^\uFEFF/,""),l.slice(i+1)];}));
const tag=Date.now().toString(36),base="http://localhost:9090/api";
function client(){let cookie="";return async(path,method="GET",body,expected=200)=>{const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get("set-cookie"))cookie=r.headers.get("set-cookie").split(";")[0];if(r.status!==expected)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.headers.get("content-type")?.includes("json")?r.json():Buffer.from(await r.arrayBuffer());};}
const admin=client(),reviewer=client();await admin("/login","POST",{username:"admin",password:env.ADMIN_PASSWORD});
const w=(await admin("/workspaces","POST",{name:`QA集成验证 ${tag}`},201)).id,manifest={workspace:w,users:[],tag};
await fs.mkdir("work/qa",{recursive:true});const save=()=>fs.writeFile(`work/qa/fixtures-${tag}.json`,JSON.stringify(manifest));await save();
const p=(await admin(`/workspaces/${w}/projects`,"POST",{name:"精确类型验证",start_date:"2026-09-23"},201)).id;
const context=await admin(`/projects/${p}/context`),d=context.departments[0].id;
const rev=await admin(`/workspaces/${w}/users`,"POST",{username:`qa_${tag}_reviewer`,name:"类型测试审核员",password:"Types-QA-2026!"},201);manifest.users.push(rev.id);await save();
await admin(`/projects/${p}/members/${rev.id}`,"PUT",{role:"reviewer"});await reviewer("/login","POST",{username:`qa_${tag}_reviewer`,password:"Types-QA-2026!"});
const values={text:"完整文本",number:0.1,date:"2024-02-29",boolean:true,int8:-128,int16:-32768,int24:-8388608,int32:-2147483648,int64:"9223372036854775807",uint64:"18446744073709551615",decimal:"9007199254740993.01",float32:0.125,float64:0.2,time:"12:34:56.123456",timestamp:"2026-09-23T01:02:03.123456",timestamptz:"2026-09-23T01:02:03.123456+08:00",uuid:"550e8400-e29b-41d4-a716-446655440000",json:{编号:"9007199254740993",a:[1,true]},enum:"启用",array:[1,"甲",true],binary:"AAEC/w=="};
const columns=Object.keys(values).map(type=>({id:type,name:type,type,required:true,...(type==="decimal"?{precision:38,scale:2}:{}),...(type==="enum"?{options:["启用","停用"]}:{})}));
const table=(await admin(`/projects/${p}/tables`,"POST",{name:"21类型全链验证",department_id:d,columns},201)).id;
await admin(`/projects/${p}/tables`,"POST",{name:"错误精度",department_id:d,columns:[{id:"bad",name:"错误",type:"decimal",precision:2,scale:3}]},400);
for(const bad of [{decimal:0.1},{int64:9007199254740992},{date:"2023-02-29"},{enum:"未知"},{array:{}},{decimal:"0.001"}])await admin(`/tables/${table}/records`,"POST",{data:{...values,...bad}},400);
const records=[];
for(let i=0;i<2;i++){
  const r=(await admin(`/tables/${table}/records`,"POST",{data:values},201)).id;records.push(r);
  const ap=(await admin(`/projects/${p}/approvals`,"POST",{kind:"record",title:`类型审批${i+1}`,record_id:r,approver_id:rev.id},201)).id;
  await reviewer(`/approvals/${ap}/decide`,"POST",{action:"approve"});
}
const read=(await admin(`/tables/${table}/records`)).rows[0].data;
for(const [key,value] of Object.entries(values))assert.deepEqual(read[key],key==="timestamptz"?"2026-09-22T17:02:03.123456Z":value,key);
assert.equal((await admin(`/tables/${table}/records?search=9007199254740993`)).total,2);
const metrics=(await admin(`/projects/${p}/summary`)).tables[0].metrics;
assert.equal(metrics.find(m=>m.id==="decimal").sum,"18014398509481986.02");
assert.equal(metrics.find(m=>m.id==="int64").sum,"18446744073709551614");
assert.equal(metrics.find(m=>m.id==="uint64").sum,"36893488147419103230");
assert.equal(metrics.find(m=>m.id==="number").sum,0.2);
const report=(await admin(`/projects/${p}/reports`,"POST",{name:"精确统计快照"},201)).id;
assert.deepEqual((await admin(`/reports/${report}`)).snapshot.tables[0].metrics,metrics);
console.log("PASS all 21 types persist, malformed values rejected, final-approved exact statistics and report snapshots");
const bytes=await admin(`/tables/${table}/export`),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.worksheets[0];
for(const key of ["int64","uint64","decimal","timestamptz"]){const index=columns.findIndex(c=>c.id===key)+1;assert.equal(sheet.getCell(2,index).type,ExcelJS.ValueType.String);assert.equal(sheet.getCell(2,index).value,read[key]);}
assert.equal(sheet.getCell(2,columns.findIndex(c=>c.id==="json")+1).value,JSON.stringify(read.json));
const parsed=await admin(`/tables/${table}/import-file`,"POST",{filename:"roundtrip.xlsx",content:bytes.toString("base64")});
const dataSheet=parsed.sheets?.[0]||parsed[0];
const preview=await admin(`/tables/${table}/import-preview`,"POST",{rows:dataSheet.rows,mapping:Object.fromEntries(columns.map((c,i)=>[c.id,i]))});
assert.equal(preview.errors.length,0);assert.equal(preview.rows[0].decimal,read.decimal);assert.deepEqual(preview.rows[0].json,read.json);
await admin(`/tables/${table}/import`,"POST",{rows:preview.rows,request_key:crypto.randomUUID()});
assert.equal((await admin(`/tables/${table}/records`)).total,4);
const sumAfter=(await admin(`/projects/${p}/summary`)).tables[0].metrics.find(m=>m.id==="decimal").sum;assert.equal(sumAfter,"18014398509481986.02");
const precisionError=await admin(`/tables/${table}/import-preview`,"POST",{rows:[[123]],mapping:{decimal:0}});assert(precisionError.errors.length>0);assert.equal(precisionError.rows.length,0);
await admin(`/projects/${p}/members/${rev.id}`,"PUT",{role:"reviewer",hidden_columns:["decimal"],can_export:true});
assert(!(await reviewer(`/projects/${p}/summary`)).tables[0].metrics.some(m=>m.id==="decimal"));
assert.equal((await reviewer(`/tables/${table}/records?search=9007199254740993.01`)).total,0);
console.log("PASS XLSX exact strings, complex JSON round trip, normalized import, draft exclusion and hidden precision fields");
const ui=(await admin(`/projects/${p}/tables`,"POST",{name:"界面类型验证",department_id:d,columns:[{id:"title",name:"事项",type:"text",required:true},{id:"amount",name:"精确金额",type:"decimal",precision:38,scale:2},{id:"code",name:"大整数",type:"int64"},{id:"details",name:"结构数据",type:"json"},{id:"state",name:"办理状态",type:"enum",options:["待办","完成"]}]},201)).id;
if(process.argv.includes("--keep-browser")){console.log(`BROWSER_WORKSPACE QA集成验证 ${tag}`);process.exit(0);}
const cleanup=spawnSync("node",["tests/cleanup-fixtures.mjs", `--manifest=fixtures-${tag}.json`],{encoding:"utf8"});assert.equal(cleanup.status,0,cleanup.stderr);console.log(cleanup.stdout.trim());
