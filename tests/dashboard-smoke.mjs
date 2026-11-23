import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const tag='dash'+Date.now().toString(36),manifest='fixtures-'+tag+'.json',users=[];
function client(){let cookie='';return async(path,method='GET',body,status=200)=>{const r=await fetch('http://127.0.0.1:9090/api'+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,status,path+' '+JSON.stringify(data));return data;};}
const admin=client(),viewer=client();await admin('/login','POST',{username:'superadmin',password:process.env.QA_ADMIN_PASSWORD});
const workspace=(await admin('/workspaces','POST',{name:'QA集成验证 '+tag},201)).id;
const save=()=>fs.writeFile('work/qa/'+manifest,JSON.stringify({workspace,tag,users}));await save();
try{
 const project=(await admin(`/workspaces/${workspace}/projects`,'POST',{name:'总览动态映射验收',start_date:'2026-10-05'},201)).id,context=await admin(`/projects/${project}/context`);
 const department=context.departments.find(d=>d.name==='安全');
 const table=(await admin(`/projects/${project}/tables`,'POST',{name:'安全与进度统计台账',department_id:department.id,columns:[{id:'date',name:'日期',type:'date'},{id:'category',name:'类别',type:'text'},...['planned','actual','pv','ev','ac'].map(id=>({id,name:id,type:'decimal',precision:38,scale:2}))]},201)).id;
 const record=(await admin(`/tables/${table}/records`,'POST',{data:{date:'2026-10-05',category:'一般',planned:'10',actual:'8',pv:'100',ev:'80',ac:'90'}},201)).id;
 await admin(`/tables/${table}/records`,'POST',{data:{date:'2026-10-06',category:'重大',planned:'20',actual:'15',pv:'200',ev:'150',ac:'160'}},201);
 const mapping=(await admin(`/projects/${project}/public`)).tables.find(t=>t.source_table_id===table);assert.ok(mapping);
 const mapped=await admin(`/tables/${mapping.id}/records`);assert.equal(mapped.total,2);assert.equal(mapped.permissions.write,false);assert.equal(mapped.table.columns[0].name,'日期');
 console.log('PASS project public folder auto-maps department tables with current schema and read-only records');
 const initial=(await admin(`/projects/${project}/dashboard`)).widgets;
 async function configure(kind,extra){const w=initial.find(w=>w.kind===kind);await admin(`/projects/${project}/dashboard/widgets/${w.id}`,'PUT',{version:w.version,name:w.name,config:{mappingId:mapping.id,dimension:'category',status:'all',...extra}});}
 await configure('progress',{dateField:'date',plannedField:'planned',actualField:'actual'});
 await configure('earned',{pvField:'pv',evField:'ev',acField:'ac'});
 const custom=(await admin(`/projects/${project}/dashboard/widgets`,'POST',{name:'自定义实际量',config:{mappingId:mapping.id,chartType:'donut',dimension:'category',metric:'actual',aggregation:'sum',status:'all'}},201)).id;
 let dash=(await admin(`/projects/${project}/dashboard`)).widgets;
 assert.deepEqual(dash.find(w=>w.kind==='progress').data.points,[{date:'2026-10-05',planned:'10.00',actual:'8.00'},{date:'2026-10-06',planned:'30.00',actual:'23.00'}]);
 const evm=dash.find(w=>w.kind==='earned').data;assert.equal(evm.pv,'300.00');assert.equal(evm.ev,'230.00');assert.equal(evm.ac,'250.00');assert.equal(evm.cv,'-20');assert.equal(evm.sv,'-70');assert.equal(evm.cpi,'0.92');
 assert.equal(String(dash.find(w=>w.id===custom).data.overall),'23.00');
 const r=(await admin(`/tables/${table}/records`)).rows.find(r=>r.id===record);await admin(`/records/${record}`,'PUT',{version:r.version,data:{actual:'9'}});
 assert.equal((await admin(`/tables/${mapping.id}/records`)).rows.find(r=>r.id===record).data.actual,'9.00');
 dash=(await admin(`/projects/${project}/dashboard`)).widgets;assert.equal(dash.find(w=>w.kind==='progress').data.points[1].actual,'24.00');
 console.log('PASS S-curve cumulative comparison, exact PV/EV/AC and custom charts update after source edit');
 const user=(await admin(`/workspaces/${workspace}/users`,'POST',{username:'qa_'+tag+'_viewer',name:'总览只读验收',password:'Temporary-'+tag+'123!'},201)).id;users.push(user);await save();
 await admin(`/projects/${project}/members/${user}`,'PUT',{role:'viewer',table_ids:[table],hidden_columns:['pv']});await viewer('/login','POST',{username:'qa_'+tag+'_viewer',password:'Temporary-'+tag+'123!'});
 assert.equal((await viewer(`/tables/${mapping.id}/records`)).table.columns.some(f=>f.id==='pv'),false);
 const privateDash=(await viewer(`/projects/${project}/dashboard`)).widgets;assert.equal(privateDash.find(w=>w.kind==='earned').data,null);
 await viewer(`/projects/${project}/dashboard/widgets`,'POST',{name:'越权',config:{}},403);
 const p2=(await admin(`/workspaces/${workspace}/projects`,'POST',{name:'隔离项目',start_date:'2026-10-05'},201)).id;
 await admin(`/projects/${p2}/dashboard/widgets`,'POST',{name:'跨项目绑定',config:{mappingId:mapping.id}},404);
 await admin(`/projects/${project}/dashboard/widgets/${custom}`,'DELETE',{});assert.equal((await admin(`/projects/${project}/dashboard`)).widgets.some(w=>w.id===custom),false);
 console.log('PASS mapping hidden columns, dashboard permission isolation, cross-project rejection and custom deletion');
 const raw=await admin(`/projects/${project}/dashboard/widgets`,'POST',{name:'原表展示',config:{mappingId:table,displayMode:'table',status:'all'}},201);
 let rawData=(await admin(`/projects/${project}/dashboard`)).widgets.find(w=>w.id===raw.id);assert.equal(rawData.data.total,2);assert.equal(rawData.data.table.id,table);
 const privateRaw=await viewer(`/projects/${project}/dashboard/widgets/${raw.id}/table`);assert.equal(privateRaw.table.columns.some(c=>c.id==='pv'),false);assert.equal(Object.hasOwn(privateRaw.rows[0].data,'pv'),false);
 await admin(`/projects/${p2}/dashboard/widgets/${raw.id}/table`,'GET',undefined,404);
 for(const chartType of ['bar','horizontalBar','line','area','pie','donut','scatter','radar','funnel','gauge']){rawData=(await admin(`/projects/${project}/dashboard`)).widgets.find(w=>w.id===raw.id);await admin(`/projects/${project}/dashboard/widgets/${raw.id}`,'PUT',{name:rawData.name,version:rawData.version,config:{mappingId:table,displayMode:'chart',chartType,dimension:'category',metric:'actual',aggregation:'sum',status:'all'}});assert.equal((await admin(`/projects/${project}/dashboard`)).widgets.find(w=>w.id===raw.id).data.overall,'24.00');}
 console.log('PASS original-table display, hidden-column permissions, project isolation and all 10 persisted chart types');
 await fs.writeFile('work/qa/dashboard-browser.json',JSON.stringify({workspace,project,table,mapping:mapping.id,manifest}));
}finally{if(!process.argv.includes('--keep-browser')){const result=spawnSync(process.execPath,['tests/cleanup-fixtures.mjs','--manifest='+manifest],{encoding:'utf8'});assert.equal(result.status,0);}}
