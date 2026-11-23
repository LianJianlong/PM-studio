import test from 'node:test';import assert from 'node:assert/strict';
import {schedule,type Activity} from '../server/schedule.ts';
import {cpmReport} from '../shared/cpm-report.ts';
import {inspectSchedule} from '../shared/plan-inspection.ts';
import {calendarTemplate} from '../shared/project-calendar.ts';
const a=(id:string,duration:number,extra:Partial<Activity>={}):Activity=>({id,code:id,name:id,duration,progress:0,predecessors:[],...extra});
const c=calendarTemplate('five'),start='2026-11-09';
test('CPM relationship checks compare working time across weekends, not chart offsets',()=>{
 const result=schedule([a('A',5),a('B',1,{actual_start:'2026-11-17',predecessors:[{id:'A',type:'FS',lag:1}]})],c,start);
 const edge=cpmReport(result).relationships[0];assert.equal(edge.gap_work_days,0);assert.equal(edge.historical_conflict,false);
 assert(!inspectSchedule(result).items.some(x=>x.message.includes('冲突')));
});
test('remaining FS driving link is separated from out-of-sequence actual start',()=>{
 const result=schedule([a('A',5),a('B',4,{actual_start:'2026-11-10',progress:50,remaining_duration:2,predecessors:[{id:'A',type:'FS',lag:0}]})],c,start,'duration',{data_date:'2026-11-12',forecast_remaining:true,critical_method:'longest'});
 const report=cpmReport(result),edge=report.relationships[0];assert.equal(edge.historical_gap_work_days,-7);assert.equal(edge.gap_work_days,0);assert(edge.historical_conflict);assert(edge.driving);assert.equal(report.summary.violations,0);assert.equal(result.logic_violations.length,0);assert.equal(result.historical_logic_violations.length,1);
 assert(result.activities.every(a=>a.critical));assert.equal(result.activities[1].actual_start,'2026-11-10');
 const items=inspectSchedule(result).items;assert(items.some(i=>i.message.includes('历史顺序冲突')));assert(!items.some(i=>i.message.includes('当前排程关系不满足')));
});
test('mandatory dates break driving longest path even when a relationship happens to be tight',()=>{
 const result=schedule([a('A',2),a('B',1,{constraint_type:'强制开始',constraint_date:'2026-11-11',predecessors:[{id:'A',type:'FS',lag:0}]})],c,start,'duration',{critical_method:'longest'});
 const edge=cpmReport(result).relationships[0];assert.equal(edge.gap_work_days,0);assert(edge.fixed);assert(!edge.driving);assert(!result.activities[0].critical);assert(result.activities[1].critical);assert.deepEqual(result.critical_paths[0].codes,['B']);
});
test('CPM handles a reversed 12000-activity chain without recursive stack overflow',()=>{
 const input=Array.from({length:12000},(_,i)=>a(String(i),1,{predecessors:i?[{id:String(i-1),type:'FS',lag:0}]:[]})).reverse();
 const result=schedule(input,undefined,undefined,'duration',{critical_method:'longest',path_count:1});assert.equal(result.work_duration,12000);assert(result.activities.every(a=>a.float===0&&a.critical));assert.equal(result.critical_paths[0].activity_ids.length,12000);
});
test('cycle errors identify activity codes; duplicate relationship and invalid remaining work are rejected',()=>{
 assert.throws(()=>schedule([a('ACT-A',1,{predecessors:[{id:'ACT-B',type:'FS',lag:0}]}),a('ACT-B',1,{predecessors:[{id:'ACT-A',type:'SS',lag:0}]})]),/ACT-A → ACT-B → ACT-A/);
 assert.throws(()=>schedule([a('A',1),a('B',2,{predecessors:[{id:'A',type:'FS',lag:0},{id:'A',type:'FS',lag:1}]})]),/重复/);
 assert.throws(()=>schedule([a('A',1,{remaining_duration:NaN})]),/剩余工期无效/);
});
test('mixed FS SS FF SF positive and negative lags satisfy early and late event inequalities',()=>{
 const types=['FS','SS','FF','SF'] as const;
 for(let run=0;run<25;run++){
  const input=Array.from({length:12},(_,i)=>a(String(i),1+((i*7+run)%5),{predecessors:i?[{id:String(i-1),type:types[(i+run)%4],lag:((i*3+run)%5)-2},...(i>2?[{id:String(i-3),type:types[(i+run+1)%4],lag:((i+run)%3)-1}]:[])]:[]}));
  const result=schedule(input),byId=new Map(result.activities.map(a=>[a.id,a]));
  for(const row of result.activities){assert(row.free_float>=0);assert(Math.abs(row.float-(row.ls-row.es))<1e-7);for(const edge of row.predecessors){const p=byId.get(edge.id)!;for(const late of [false,true]){const from=edge.type[0]==='F'?(late?p.lf:p.ef):(late?p.ls:p.es),to=edge.type[1]==='F'?(late?row.lf:row.ef):(late?row.ls:row.es);assert(to-from-edge.lag>=-1e-7,`${run}:${p.code}->${row.code} ${edge.type}`);}}}
  assert(cpmReport(result).relationships.every(r=>r.gap_work_days>=-1e-7));
 }
});
