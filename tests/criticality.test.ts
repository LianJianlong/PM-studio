import test from 'node:test';import assert from 'node:assert/strict';
import {schedule,type Activity} from '../server/schedule.ts';import {calendarTemplate} from '../shared/project-calendar.ts';import {cpmReport} from '../shared/cpm-report.ts';import {scheduleNetwork} from '../server/network-schedule.ts';
const a=(id:string,duration:number,extra:Partial<Activity>={}):Activity=>({id,code:id,name:id,duration,progress:0,predecessors:[],...extra});const c=calendarTemplate('five'),start='2026-11-09';
test('both criticality definitions remain visible while only selected definition controls critical flags',()=>{
 const tasks=[a('A',5),a('B',3),a('C',1,{predecessors:[{id:'A',type:'FS',lag:0}]})];
 const byFloat=schedule(tasks,c,start,'duration',{critical_threshold:3,near_critical_hours:32});const b=byFloat.activities[1];assert(b.float_critical);assert(!b.on_longest_path);assert(b.critical);assert(!b.near_critical);assert.equal(b.critical_reason,'float');
 const byLongest=schedule(tasks,c,start,'duration',{critical_method:'longest',critical_threshold:3,near_critical_hours:24});const n=byLongest.activities[1];assert(n.float_critical);assert(!n.on_longest_path);assert(!n.critical);assert(n.near_critical);assert.equal(cpmReport(byLongest).summary.near_critical,1);
});
test('near critical thresholds are working hours, inclusive at boundary, can be disabled, exclude completed and LOE',()=>{
 const tasks=[a('A',5),a('B',3),a('Done',3,{progress:100}),a('Support',0,{activity_type:'LOE持续性作业',loe_scope:['A','B']})];
 assert(schedule(tasks,c,start,'duration',{near_critical_hours:16}).activities[1].near_critical);
 assert(!schedule(tasks,c,start,'duration',{near_critical_hours:15}).activities[1].near_critical);
 const off=schedule(tasks,c,start,'duration',{near_critical_hours:0});assert(off.activities.every(a=>!a.near_critical));
 const result=schedule(tasks,c,start,'duration',{near_critical_hours:16});assert(!result.activities[2].near_critical);assert(!result.activities[3].near_critical);assert(!result.activities[3].float_critical);assert.equal(result.activities[3].critical_reason,'loe');
});
test('negative float remains an independent risk even off the longest path and never counts as near critical',()=>{
 const r=schedule([a('A',5),a('B',3,{constraint_type:'完成不晚于',constraint_date:'2026-11-10'})],c,start,'duration',{critical_method:'longest',near_critical_hours:80});const b=r.activities[1];assert(b.float<0);assert(!b.critical);assert(b.float_critical);assert(!b.near_critical);assert.equal(cpmReport(r).summary.negative,1);
});
test('near-critical hours do not change at weekends or when day conversion differs',()=>{
 const short=calendarTemplate('five');short.hours_per_day=4;short.week=short.week.map(ps=>ps.length?[['08:00','12:00']]:[]);
 assert(schedule([a('A',5),a('B',3)],short,start,'duration',{near_critical_hours:8}).activities[1].near_critical);
 assert(!schedule([a('A',5),a('B',3)],c,start,'duration',{near_critical_hours:8}).activities[1].near_critical);
});
test('network decision inactive alternatives never carry near or criticality markers',()=>{
 const tasks=[a('root',1),a('yes',3,{predecessors:[{id:'root',type:'FS',lag:0}]}),a('no',2,{predecessors:[{id:'root',type:'FS',lag:0}]})];
 const r=scheduleNetwork(tasks,[{id:'decision',type:'event',label:'choose',branches:['yes','no'],selected:'yes',probability:50}],c,start,{near_critical_hours:80});const n=r.activities.find(a=>a.id==='no')!;assert(n.inactive);assert(!n.critical);assert(!n.near_critical);assert(!n.on_longest_path);
});
