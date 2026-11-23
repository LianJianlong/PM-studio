import {test} from 'node:test';import assert from 'node:assert/strict';import {remainingDays,remainingAllocation,remainingCostSummary} from '../shared/remaining-resources.ts';import {remainingPlan,decorateRemainingResources} from '../server/remaining-plan.ts';import {defaultProjectCalendar as c} from '../shared/project-calendar.ts';
test('remaining estimates use explicit duration or rounded unfinished hours and completed work is zero',()=>{
 assert.equal(remainingDays({duration:10,progress:40},8),6);assert.equal(remainingDays({duration:10,progress:40,remaining_duration:3.1},8),3.125);assert.equal(remainingDays({duration:10,progress:100,remaining_duration:8},8),0);
 const row=remainingAllocation({}, {rate:'200.0000'}, {quantity:'2.0000',remaining_quantity:'4.0000',actual_cost:'100.0000'},1.5,8);assert.equal(row.remaining_units,'6.0000');assert.equal(row.remaining_forecast_cost,'1200.0000');assert.equal(row.forecast_total_cost,'1300.0000');assert.equal(row.remaining_hours,12);
 assert.deepEqual(remainingCostSummary([{...row,actual_cost:'100.0000'}]),{remaining_cost:'1200.0000',actual_cost:'100.0000',forecast_total_cost:'1300.0000'});
});
test('remaining forecast uses only the future working interval and keeps original plan quantities untouched',()=>{
 const activity:any={id:'A',code:'A',name:'A',duration:5,progress:40,actual_start:'2026-11-09',remaining_duration:1.5,predecessors:[]};
 const future=remainingPlan([activity],c,'2026-11-09',{},'2026-11-12');assert.equal(future.activities[0].duration,1.5);assert.equal(future.activities[0].work_ef,4.5);assert.equal(future.activities[0].es,3+8/24);assert.equal(activity.duration,5);
 const resources=[{rate:'200.0000',allocations:[{id:'x',activity_id:'A',quantity:'2.0000',planned_cost:'2000.0000',actual_cost:'100.0000'}]}];const result=decorateRemainingResources(resources,future,[{allocation_id:'x',quantity:'4.0000',version:1}],8);assert.equal(result[0].allocations[0].quantity,'2.0000');assert.equal(result[0].allocations[0].planned_cost,'2000.0000');assert.equal(result[0].allocations[0].remaining_forecast_cost,'1200.0000');assert.equal(resources[0].allocations[0].quantity,'2.0000');
});

test('impossible mandatory dates do not fabricate future resource dates',()=>{
 const a:any={id:'A',code:'A',name:'A',duration:3,progress:0,remaining_duration:3,constraint_type:'强制完成',constraint_date:'2026-11-10',predecessors:[]};
 const future=remainingPlan([a],c,'2026-11-09',{},'2026-11-12');assert.equal(future.activities[0].remaining_window_valid,false);assert.equal(future.activities[0].duration,3);
 const decorated=decorateRemainingResources([{rate:'200.0000',allocations:[{id:'x',activity_id:'A',quantity:'2.0000',actual_cost:'0.0000'}]}],future,[],8);assert.equal(decorated[0].allocations[0].remaining_forecast_cost,'1200.0000');assert.equal(decorated[0].allocations[0].remaining_window_valid,false);
});
