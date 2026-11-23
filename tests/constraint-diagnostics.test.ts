import test from 'node:test';import assert from 'node:assert/strict';import {schedule,type Activity} from '../server/schedule.ts';import {calendarTemplate} from '../shared/project-calendar.ts';import {inspectSchedule} from '../shared/plan-inspection.ts';
const c=calendarTemplate('five'),start='2026-11-09',a=(id:string,duration:number,extra:Partial<Activity>={}):Activity=>({id,code:id,name:id,duration,progress:0,predecessors:[],...extra});
test('soft start constraints never invent a later finish for an already actual-started activity',()=>{
 const result=schedule([a('A',2,{actual_start:start,progress:50,remaining_duration:1,constraint_type:'开始不早于',constraint_date:'2026-11-16'})],c,start);
 assert.equal(result.activities[0].work_es,0);assert.equal(result.activities[0].work_ef,2);assert(result.constraint_diagnostics[0].actual_conflict);assert(!result.constraint_diagnostics[0].blocking);assert(inspectSchedule(result).items.some(x=>x.message.includes('实际日期冲突')));
});
test('soft finish upper bound reports negative float without truncating the logical duration',()=>{
 const result=schedule([a('A',5,{constraint_type:'完成不晚于',constraint_date:'2026-11-11'})],c,start);const d=result.constraint_diagnostics[0];assert.equal(result.work_duration,5);assert.equal(d.shortfall_hours,16);assert.equal(d.total_float_hours,-16);assert.equal(d.phase,'late');assert(!d.blocking);
});
test('mandatory conflict with actual history, nonworking dates, and remaining window is blocked diagnostically',()=>{
 const actual=schedule([a('A',2,{actual_start:start,progress:10,constraint_type:'强制开始',constraint_date:'2026-11-10'})],c,start);assert.equal(actual.activities[0].actual_start,start);assert(actual.constraint_diagnostics[0].blocking);
 const weekend=schedule([a('A',2,{constraint_type:'强制开始',constraint_date:'2026-11-14'})],c,start);assert(weekend.constraint_diagnostics[0].non_working);assert(weekend.constraint_diagnostics[0].blocking);
 const remain=schedule([a('A',5,{actual_start:start,progress:20,remaining_duration:4,constraint_type:'强制完成',constraint_date:'2026-11-12'})],c,start,'duration',{data_date:'2026-11-12',forecast_remaining:true});assert(remain.constraint_diagnostics[0].remaining_conflict);assert(remain.constraint_diagnostics[0].blocking);
});
test('mandatory logical collision remains explicit while a feasible soft lower bound respects relationships',()=>{
 const result=schedule([a('A',5),a('B',2,{predecessors:[{id:'A',type:'FS',lag:0}],constraint_type:'强制开始',constraint_date:'2026-11-11'})],c,start);assert.equal(result.constraint_diagnostics[0].logic_conflicts,1);assert(!result.constraint_diagnostics[0].blocking);assert(result.logic_violations.length);
 const soft=schedule([a('A',5),a('B',2,{predecessors:[{id:'A',type:'FS',lag:0}],constraint_type:'开始不早于',constraint_date:'2026-11-11'})],c,start);assert.equal(soft.constraint_diagnostics[0].status,'satisfied');assert.equal(soft.activities[1].work_es,5);
});
