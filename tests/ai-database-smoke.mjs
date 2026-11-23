import assert from 'node:assert/strict';import fs from 'node:fs/promises';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const tag='aidata'+Date.now().toString(36),password=crypto.randomBytes(18).toString('hex');
const env=Object.fromEntries((await fs.readFile('.env','utf8')).split(/\r?\n/).filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
function client(){let cookie='';return async(path,method='GET',body,status=200)=>{
  let r;for(let attempt=0;attempt<3;attempt++){
    r=await fetch('http://127.0.0.1:9090/api'+path,{method,headers:{cookie,...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    if(r.status!==429)break;await new Promise(resolve=>setTimeout(resolve,Math.min(60,Math.max(1,Number(r.headers.get('retry-after'))||1))*1000));
  }
  if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  assert.equal(r.status,status,`${method} ${path}: ${r.status!==status?await r.text():''}`);return r.json();
}}
const admin=client(),editor=client(),viewer=client();await admin('/login','POST',{username:'admin',password:env.ADMIN_PASSWORD});
const workspace=(await admin('/workspaces','POST',{name:'QA集成验证 '+tag},201)).id;
const manifestName=`fixtures-${tag}.json`,manifest={workspace,tag,users:[]};const persist=()=>fs.writeFile('work/qa/'+manifestName,JSON.stringify(manifest));await persist();
const projects=[];for(const name of ['只读聊天项目','可写数据项目','无权项目'])projects.push((await admin(`/workspaces/${workspace}/projects`,'POST',{name,start_date:'2026-10-11'},201)).id);
const [chat,project,privateProject]=projects;
const ids={};for(const [role,c] of [['editor',editor],['viewer',viewer]]) {
  const username=`qa_${tag}_${role}`,u=await admin(`/workspaces/${workspace}/users`,'POST',{username,name:role,password},201);ids[role]=u.id;manifest.users.push(u.id);await persist();
  await admin(`/projects/${chat}/members/${u.id}`,'PUT',{role:'viewer'});await admin(`/projects/${project}/members/${u.id}`,'PUT',{role});await c('/login','POST',{username,password});
}
const use=async(c,name,args={},p=chat,status=200)=>c(`/projects/${p}/ai/tool`,'POST',{name,arguments:args,allow_write:true},status);
async function write(c,method,path,body={}) {
  const q=await use(c,'business_api',{method,path,body});assert.equal(q.pending,true);
  return c(`/projects/${chat}/ai/changes/${q.change.id}/confirm`,'POST',{confirm:true});
}
const fields=await use(editor,'api_catalog',{topic:'fields'});assert.ok(fields.field_types.some(f=>f.type==='formula'));assert.match(fields.catalog,/definition/);
const spaces=await use(editor,'data_catalog',{scope:'workspaces'});assert.ok(spaces.projects.some(p=>p.id===project));assert.ok(!spaces.projects.some(p=>p.id===privateProject));
await use(editor,'data_catalog',{project_id:privateProject},chat,403);
const department=(await admin(`/projects/${project}/context`)).departments[0].id;
const tableResult=await write(admin,'POST',`projects/${project}/tables`,{name:'AI全流程验收表',department_id:department,columns:[
  {id:'category',name:'分类',type:'text'},{id:'amount',name:'金额',type:'decimal',precision:12,scale:2},{id:'secret',name:'隐藏',type:'text'}]});
assert.equal(tableResult.status,201);const table=tableResult.data.id;
await admin(`/projects/${project}/members/${ids.editor}`,'PUT',{role:'editor',hidden_columns:['secret'],row_scope:'own'});
const metadata=await use(editor,'data_catalog',{table_id:table});assert.equal(metadata.project.id,project);assert.ok(!metadata.tables[0].columns.some(f=>f.id==='secret'));
await use(viewer,'business_api',{method:'POST',path:`/tables/${table}/records`,body:{data:{category:'越权'}}},chat,403);
await use(editor,'business_api',{method:'POST',path:`/tables/${table}/columns`,body:{id:'denied',name:'越权',type:'text'}},chat,403);
await use(editor,'business_api',{method:'POST',path:`/tables/${table}/records`,body:{data:{secret:'越权隐藏列'}}},chat,403);
console.log('PASS scoped catalog, schema help, hidden columns and cross-project role equality');
assert.equal((await write(viewer,'POST',`/tables/${table}/views`,{name:'只读账号个人视图',config:{search:'A',status:'all'}})).status,200);
const created=await write(editor,'POST',`/tables/${table}/records`,{data:{category:'A',amount:'12.50'}});assert.equal(created.status,201);const record=created.data.id;
await write(editor,'PUT',`/records/${record}`,{version:1,data:{amount:'14.25'}});
const read=await use(editor,'business_api',{method:'GET',path:`/tables/${table}/records?search=users%20name`});assert.equal(read.status,200);
const records=await use(editor,'business_api',{method:'GET',path:`/tables/${table}/records`});assert.equal(records.data.rows[0].data.amount,'14.25');
const stale=await write(editor,'PUT',`/records/${record}`,{version:1,data:{amount:'0.00'}});assert.equal(stale.status,409);
await write(admin,'POST',`/tables/${table}/columns`,{id:'double_amount',name:'金额双倍',type:'formula',formula:'[amount] * 2'});
let t=(await admin(`/objects/projects/${project}/tables`)).find(t=>t.id===table);
await write(admin,'PATCH',`/objects/tables/${table}/columns/amount`,{version:t.object_version,definition:{id:'amount',name:'合同金额',type:'decimal',precision:12,scale:2}});
const calculated=await use(editor,'business_api',{method:'GET',path:`/tables/${table}/records`});assert.equal(calculated.data.rows[0].data.double_amount,'28.5');
const deleted=await write(editor,'DELETE',`/records/${record}`);assert.equal(deleted.status,200);
console.log('PASS confirmed AI create table/field, record CRUD, precision/formula, column redesign and stale-version rejection');
const kept=await write(admin,'POST',`/tables/${table}/records`,{data:{category:'A',amount:'2.00'}});assert.equal(kept.status,201);
const definition={sources:[table],status:'all',joins:[],filters:[],columns:[{id:'category',name:'分类',field:{source:0,field:'category'},aggregation:'none'},{id:'total',name:'金额合计',field:{source:0,field:'amount'},aggregation:'sum'}]};
const view=await write(admin,'POST',`/projects/${project}/public/views`,{name:'AI聚合视图',definition});assert.equal(view.status,201);
const viewMetadata=await use(admin,'data_catalog',{table_id:view.data.id});assert.equal(viewMetadata.tables[0].is_view,true);assert.ok(viewMetadata.tables[0].columns.some(f=>f.id==='total'));
const updated=await write(admin,'PUT',`/public/views/${view.data.id}`,{version:view.data.version,name:'AI聚合视图修改',definition});assert.equal(updated.status,200);
assert.equal((await write(admin,'DELETE',`/public/views/${view.data.id}`)).status,200);
t=(await admin(`/objects/projects/${project}/tables`)).find(t=>t.id===table);
assert.equal((await write(admin,'PATCH',`/objects/tables/${table}/columns/double_amount`,{version:t.object_version,lifecycle:'deleted'})).status,200);
await write(admin,'DELETE',`/records/${kept.data.id}`);
t=(await admin(`/objects/projects/${project}/tables`)).find(t=>t.id===table);
assert.equal((await write(admin,'PATCH',`/objects/table/${table}`,{version:t.object_version,lifecycle:'deleted'})).status,200);
console.log('PASS SQL-style platform views, aggregate definitions, and safe field/table removal');
const connection=(await admin(`/workspaces/${workspace}/connections`,'POST',{name:'AI只读PG验收',engine:'postgres',host:'db',port:5432,database:'project_studio',user:'studio',password:env.DB_PASSWORD,tls:false},201)).id;
const con=await use(admin,'database_connections');assert.ok(con.connections.some(c=>c.id===connection));assert.ok(!JSON.stringify(con).includes(env.DB_PASSWORD));
await use(editor,'database_connections',{},chat,403);
const result=await use(admin,'database_query',{connection_id:connection,sql:'SELECT 1 AS ai_read_only'});assert.equal(result.data.rows[0].ai_read_only,1);
await use(admin,'database_query',{connection_id:connection,sql:'DELETE FROM records'},chat,400);
await admin(`/connections/${connection}`,'DELETE',{});
console.log('PASS existing PostgreSQL SELECT tool, credential-free directory, owner-only access and SQL write denial');
const cleanup=spawnSync(process.execPath,['tests/cleanup-fixtures.mjs','--manifest='+manifestName],{encoding:'utf8'});assert.equal(cleanup.status,0,cleanup.stdout+cleanup.stderr);console.log(cleanup.stdout.trim());
