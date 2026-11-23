import {test} from 'node:test';import assert from 'node:assert/strict';import {schedule,type Activity} from '../server/schedule.ts';
import {defaultProjectCalendar as c,calendarDate} from '../shared/project-calendar.ts';import {durationText} from '../shared/duration-summary.ts';import {inspectSchedule} from '../shared/plan-inspection.ts';import {compareScheduleDelay,compareScenario} from '../shared/delay-analysis.ts';
const a=(id:string,duration:number,predecessors:string[]=[],extra:Partial<Activity>={}):Activity=>({id,code:id,name:id,duration,progress:0,predecessors:predecessors.map(id=>({id,type:'FS',lag:0})),...extra});
const start='2026-11-09';
test('duration summary distinguishes drawing offset, project lead-in blank and actual working span',()=>{
 const plan=schedule([a('A',20,[],{start_not_before:'2026-11-10'}),a('B',10,['A'])],c,start);
 assert.equal(plan.duration,42+17/24);assert.equal(plan.work_duration,31);assert.equal(plan.duration_summary.work_span,30);assert.equal(plan.duration_summary.calendar_days,42);assert.equal(durationText(plan.duration_summary.work_span,8),'30天');
 assert.equal(durationText(5.25,8),'5天2小时');assert.equal(durationText(0.1,8),'1小时');assert(!durationText(42.7083333,8).includes('.'));
});
test('bounded multiple paths rank the driving and near-critical diamond chains without replacing critical flags',()=>{
 const p=schedule([a('A',1),a('B',5,['A']),a('C',3,['A']),a('D',1,['B','C'])],c,start,'duration',{path_count:5});
 assert.deepEqual(p.critical_paths.map(p=>[p.codes,p.gap_work_days]),[[['A','B','D'],0],[['A','C','D'],2]]);
 assert.equal(p.activities.find(a=>a.id==='C')!.critical,false);assert.equal(p.activities.find(a=>a.id==='D')!.float_paths.length,2);
 const target=schedule([a('A',1),a('B',5,['A']),a('C',3,['A']),a('D',1,['B','C'])],c,start,'duration',{path_count:1,path_end_id:'C'});assert.deepEqual(target.critical_paths[0].codes,['A','C']);
});
test('mandatory start fixes early and late start, exposes violated logic and propagates predecessor negative float',()=>{
 const p=schedule([a('A',5),a('B',2,['A'],{constraint_type:'强制开始',constraint_date:'2026-11-11'})],c,start);
 const b=p.activities[1];assert.equal(b.work_es,2);assert.equal(b.work_ls,2);assert.equal(b.hard_applied,true);assert.equal(p.logic_violations[0].shortfall_work_days,3);assert.equal(p.activities[0].float,-3);assert(inspectSchedule(p).items.some(i=>i.message.includes('关系不满足')));
});
test('mandatory finish honors finish-day boundary even before the project origin; actual history remains unchanged on conflict',()=>{
 const p=schedule([a('A',3,[],{constraint_type:'强制完成',constraint_date:'2026-11-10'})],c,start);assert.equal(calendarDate(start,p.activities[0].es),'2026-11-06');assert.equal(calendarDate(start,p.activities[0].ef),'2026-11-10');assert.equal(p.duration_summary.work_span,3);
 const actual=schedule([a('A',2,[],{actual_start:'2026-11-09',progress:30,constraint_type:'强制开始',constraint_date:'2026-11-11'})],c,start);assert.equal(calendarDate(start,actual.activities[0].es),'2026-11-09');assert.equal(actual.activities[0].hard_applied,false);assert(actual.activities[0].constraint_messages.length);
});
test('missing configured path end warns without crashing published calculations',()=>{
 const p=schedule([a('A',5)],c,start,'duration',{path_end_id:'missing'});assert.equal(p.critical_paths.length,0);assert(p.path_warnings.length);assert.equal(p.duration_summary.days,5);
});
test('delay comparison separates calendar delay and working duration change, and scenario analysis identifies propagation',()=>{
 const original=schedule([a('A',5),a('B',3),a('C',2,['A','B'])],c,start);const changed=schedule([a('A',5),a('B',6),a('C',2,['A','B'])],c,start);
 const rows=compareScheduleDelay(changed,{snapshot:{start_date:start,activities:original.activities}},start,8);assert.equal(rows.find((r:any)=>r.id==='B').duration_change_hours,24);assert(rows.find((r:any)=>r.id==='B').reasons.includes('原定工期增加'));
 const affected=compareScenario(original,changed,start,8);assert.equal(affected.find((r:any)=>r.id==='C').work_delay_hours,8);
});

test('mandatory dates before project origin do not fabricate a required-finish violation',()=>{
 const p=schedule([a('A',2,[],{constraint_type:'强制完成',constraint_date:'2026-11-05'})],c,start,'duration',{must_finish_by:'2026-11-05'});
 assert.equal(p.deadline_missed,false);assert.equal(p.duration_summary.days,2);assert(p.activities[0].constraint_messages.some(m=>m.includes('项目起点之前')));
});
