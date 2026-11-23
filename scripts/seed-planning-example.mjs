// Run with node --env-file=.env --import tsx scripts/seed-planning-example.mjs PROJECT_ID [--commit].
// Uses the same application routes and permission/confirmation logic as the UI.
import express from 'express';import assert from 'node:assert/strict';import {pool,requestTransaction,requestActor} from '../server/db.ts';
import {data} from '../server/data.ts';import {planning} from '../server/planning.ts';import {resources} from '../server/resources.ts';
import {resourceTicks} from '../shared/resource-values.ts';
const project=process.argv[2];assert.match(project||'',/^[a-f0-9-]{36}$/i);const commit=process.argv.includes('--commit'),prefix='EX-MEP-';
const specs=[
 {key:'A',name:'【示例】施工准备与技术交底',duration:2,wbs:'01',pred:[],discipline:'土建工程',subsystem:'钢筋混凝土主体'},
 {key:'B',name:'【示例】电缆桥架安装',duration:3,wbs:'02',pred:['A'],discipline:'电气工程',subsystem:'动力照明与防雷接地'},
 {key:'C',name:'【示例】冷却水管安装',duration:4,wbs:'03',pred:['A'],discipline:'暖通工程',subsystem:'空调冷热源与水系统'},
 {key:'D',name:'【示例】动力电缆敷设',duration:2,wbs:'02',pred:['B'],discipline:'电气工程',subsystem:'动力照明与防雷接地'},
 {key:'E',name:'【示例】冷却管网试压',duration:2,wbs:'03',pred:['C'],discipline:'暖通工程',subsystem:'空调冷热源与水系统'},
 {key:'F',name:'【示例】机电设备接线与单机调试',duration:2,wbs:'04',pred:['D','E'],discipline:'电气工程',subsystem:'动力照明与防雷接地'},
 {key:'G',name:'【示例】系统联调与验收',duration:2,wbs:'04',pred:['F'],discipline:'智能化工程',subsystem:'楼宇自控与能耗计量'},
];
const resourceSpecs=[
 {key:'workers',name:'【示例】机电综合施工班组',kind:'human',unit:'人日',rate:'300',capacity:'6'},
 {key:'electricians',name:'【示例】电气安装技工',kind:'human',unit:'人日',rate:'400',capacity:'4'},
 {key:'crane',name:'【示例】小型吊装设备',kind:'equipment',unit:'机日',rate:'600',capacity:'1'},
 {key:'cable',name:'【示例】动力电缆 YJV-5×16',kind:'material',unit:'m',rate:'25',capacity:'100'},
 {key:'pipe',name:'【示例】冷却水管 DN80',kind:'material',unit:'m',rate:'80',capacity:'20'},
];
const allocations=[['A','workers','8','2400'],['B','workers','12','3900'],['C','workers','20','5700'],['C','pipe','80','6600'],['C','crane','4','2400'],['D','electricians','8','3400'],['D','cable','160','4200'],['E','workers','4','1200'],['F','electricians','6','2600'],['G','electricians','4','1600']];
const c=await pool.connect();let server;
try{
 await c.query('BEGIN');const actor=(await c.query('SELECT id FROM users WHERE system_admin AND active ORDER BY username LIMIT 1')).rows[0]?.id;assert(actor,'An active system administrator is required');await c.query("SELECT set_config('app.actor_id',$1,true)",[actor]);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,703))',[project]);
 const original=(await c.query('SELECT * FROM activities WHERE project_id=$1 ORDER BY id',[project])).rows;
 assert(!original.some(r=>r.code.startsWith(prefix)),'Example already exists; refusing to duplicate or overwrite it');
 const meta=(await c.query("SELECT id,name,currency,start_date::text,calendar_config FROM projects WHERE id=$1 AND lifecycle='active'",[project])).rows[0];assert(meta);assert.equal(meta.currency,'CNY','Example costs are denominated in CNY');assert.equal(meta.calendar_config,null,'Expected the current project natural-day calendar; review fixture before using another calendar');
 const tables=(await c.query('SELECT table_id,kind FROM planning_tables WHERE project_id=$1 UNION ALL SELECT table_id,\'activities\' AS kind FROM plan_data_tables WHERE project_id=$1',[project])).rows;const wbsTable=tables.find(t=>t.kind==='wbs')?.table_id,activityTable=tables.find(t=>t.kind==='activities')?.table_id;assert(wbsTable&&activityTable,'Enable the normal WBS and activity tables first');
 const baselineTables=(await c.query('SELECT * FROM records WHERE table_id=ANY($1::uuid[]) ORDER BY id',[[wbsTable,activityTable]])).rows;
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:actor};requestActor.run(actor,()=>requestTransaction.run(c,next))});app.use(data,planning,resources);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const call=async(path,method='GET',body)=>{const res=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();assert(res.ok,`${method} ${path}: ${JSON.stringify(value)}`);return value};
 const confirm=async(table,ids)=>{const rows=(await c.query('SELECT id,version FROM records WHERE id=ANY($1::uuid[])',[ids])).rows;await call(`/tables/${table}/confirm-status`,'POST',{status:'approved',records:rows})};
 const wbs={};for(const [key,name] of [['00','【示例】机房机电安装与联调'],['01','【示例】施工准备'],['02','【示例】电气安装'],['03','【示例】暖通安装'],['04','【示例】调试验收']]){const result=await call(`/tables/${wbsTable}/records`,'POST',{data:{code:prefix+'W'+key,name,parent:key==='00'?[]:[wbs['00']],description:'逻辑与资源费用验证示例，不代表项目实际预算或施工进展。'}});wbs[key]=result.id;await confirm(wbsTable,[result.id])}
 const acts={};for(const s of specs){const created=await call(`/projects/${project}/activities`,'POST',{code:prefix+s.key,name:s.name,duration:s.duration,progress:0,predecessors:s.pred.map(k=>({id:acts[k],type:'FS',lag:0}))});acts[s.key]=created.id;const record=(await c.query('SELECT r.* FROM records r JOIN plan_activity_records l ON l.record_id=r.id WHERE l.activity_id=$1',[created.id])).rows[0];await call(`/records/${record.id}`,'PUT',{version:record.version,data:{wbs:[wbs[s.wbs]],discipline:s.discipline,subsystem:s.subsystem}})}
 const rs={};for(const s of resourceSpecs){const {key,...body}=s;rs[key]=(await call(`/projects/${project}/resources`,'POST',{...body,currency:'CNY',configuration:'验证示例：分配数量为整个作业总量，按项目日历均匀加载。'})).id}
 for(const [task,resource,quantity,actual_cost] of allocations)await call(`/activities/${acts[task]}/resources`,'POST',{resource_id:rs[resource],quantity,actual_cost,reason:'示例数据：验证总量×单价、资源峰值与实际费用差异'});
 const linked=(await c.query('SELECT record_id FROM plan_activity_records WHERE activity_id=ANY($1::uuid[])',[Object.values(acts)])).rows;await confirm(activityTable,linked.map(r=>r.record_id));
 const plan=await call(`/projects/${project}/plan`),load=await call(`/projects/${project}/resource-load`),cost=await call(`/projects/${project}/cost-dashboard`);
 const expected={A:[0,2],B:[2,5],C:[2,6],D:[5,7],E:[6,8],F:[8,10],G:[10,12]};
 for(const [key,[start,end]] of Object.entries(expected)){const a=plan.activities.find(a=>a.id===acts[key]);assert(a,`Missing confirmed ${key}`);assert.equal(a.es,start,key+' ES');assert.equal(a.ef,end,key+' EF')}
 const costs=cost.rows.filter(r=>Object.values(acts).includes(r.activity_id));const planned=costs.reduce((s,r)=>s+resourceTicks(r.planned_cost),0n),actual=costs.reduce((s,r)=>s+resourceTicks(r.actual_cost),0n);assert.equal(planned,332000000n);assert.equal(actual,340000000n);
 const assignments=load.assignments.filter(r=>Object.values(acts).includes(r.activity_id));assert.equal(assignments.length,10);for(const [task,resource,quantity] of allocations){const row=assignments.find(r=>r.activity_id===acts[task]&&r.resource_id===rs[resource]);assert(row);assert.equal(resourceTicks(row.quantity),resourceTicks(quantity));const spec=specs.find(s=>s.key===task);assert.equal(row.working_days,spec.duration);assert.equal(row.working_hours,spec.duration*24);}
 for(const s of resourceSpecs){const r=load.resources.find(r=>r.id===rs[s.key]);const total=allocations.filter(a=>a[1]===s.key).reduce((sum,a)=>sum+resourceTicks(a[2]),0n);assert.equal(r.curve.reduce((sum,d)=>sum+resourceTicks(d.quantity),0n),total);assert.equal(r.curve.reduce((sum,d)=>sum+resourceTicks(d.planned_cost),0n),resourceTicks(r.planned_cost))}
 const workers=load.resources.find(r=>r.id===rs.workers);assert.equal(workers.overloaded_days,3);assert.equal(Math.max(...workers.curve.map(d=>Number(d.quantity))),9);const overloadDates=workers.curve.filter(d=>d.overloaded).map(d=>d.date);
 // Exercise edits against real APIs, then roll them back to leave the canonical example intact.
 await c.query('SAVEPOINT duration_probe');
 const cRecord=(await c.query('SELECT r.* FROM records r JOIN plan_activity_records l ON l.record_id=r.id WHERE l.activity_id=$1',[acts.C])).rows[0];
 await call(`/records/${cRecord.id}`,'PUT',{version:cRecord.version,data:{duration:5}});
 let changedPlan=await call(`/projects/${project}/plan`);assert(!changedPlan.activities.some(a=>a.id===acts.C),'Draft edit should leave published calculations');assert(!changedPlan.activities.some(a=>a.id===acts.G),'Unconfirmed predecessor should suppress downstream calculation');
 await confirm(activityTable,[cRecord.id]);changedPlan=await call(`/projects/${project}/plan`);assert.equal(changedPlan.activities.find(a=>a.id===acts.G).ef,13,'Duration edit should reschedule dependent chain');
 await c.query('ROLLBACK TO SAVEPOINT duration_probe');await c.query('RELEASE SAVEPOINT duration_probe');
 await c.query('SAVEPOINT quantity_probe');
 const existingAllocation=load.resources.find(r=>r.id===rs.workers).allocations.find(a=>a.activity_id===acts.C);
 await call(`/activities/${acts.C}/resources`,'POST',{resource_id:rs.workers,quantity:'24',version:existingAllocation.version,reason:'验证数量修改后自动重算（事务回滚）'});
 const changedLoad=await call(`/projects/${project}/resource-load`),changedCost=await call(`/projects/${project}/cost-dashboard`);
 assert.equal(Math.max(...changedLoad.resources.find(r=>r.id===rs.workers).curve.map(d=>Number(d.quantity))),10);
 assert.equal(changedCost.rows.filter(r=>Object.values(acts).includes(r.activity_id)).reduce((sum,r)=>sum+resourceTicks(r.planned_cost),0n),344000000n);
 await c.query('ROLLBACK TO SAVEPOINT quantity_probe');await c.query('RELEASE SAVEPOINT quantity_probe');
 const unchanged=(await c.query('SELECT * FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id',[original.map(a=>a.id)])).rows;assert.deepEqual(unchanged,original,'Existing activities changed');const unchangedRecords=(await c.query('SELECT * FROM records WHERE id=ANY($1::uuid[]) ORDER BY id',[baselineTables.map(r=>r.id)])).rows;assert.deepEqual(unchangedRecords,baselineTables,'Existing WBS or activity records changed');
 const report={project:meta.name,start_date:meta.start_date,wbs:5,activities:7,resources:5,allocations:10,example_duration:12,planned_cost:'33200.0000',actual_cost:'34000.0000',cost_variance:'-800.0000',edit_probes:'duration/draft dependency/quantity/rate recalculation passed and rolled back',peak_workers:9,capacity:6,overload_dates:overloadDates,commit};
 await c.query(commit?'COMMIT':'ROLLBACK');console.log(JSON.stringify(report,null,2));
} catch(e){await c.query('ROLLBACK');throw e} finally{if(server)await new Promise(r=>server.close(r));c.release();await pool.end()}
