import test from 'node:test';import assert from 'node:assert/strict';import {actualRemainingDuration,actualRemainingUnits} from '../shared/actual-remaining.ts';import {calendarTemplate} from '../shared/project-calendar.ts';import {remainingAllocation} from '../shared/remaining-resources.ts';import {decorateRemainingResources} from '../server/remaining-plan.ts';
const c=calendarTemplate('five');
test('elapsed duration uses actual dates and the project calendar, remaining work is separate',()=>{
 const row={duration:5,progress:30,actual_start:'2026-11-09',remaining_duration:3.5};const r=actualRemainingDuration(row,c,'2026-11-12');assert.equal(r.original_work_hours,40);assert.equal(r.actual_elapsed_hours,24);assert.equal(r.remaining_work_hours,28);assert.equal(r.actual_duration_basis,'data_date_start');
 const done=actualRemainingDuration({...row,progress:100,actual_finish:'2026-11-16'},c,'2026-11-16');assert.equal(done.actual_elapsed_hours,48);assert.equal(done.remaining_work_hours,0);assert.equal(actualRemainingDuration({duration:0,progress:100,actual_start:'2026-11-09',actual_finish:'2026-11-09'},c,'2026-11-12').actual_elapsed_hours,0);
 assert.equal(actualRemainingDuration({duration:2,progress:0},c,'2026-11-12').actual_elapsed_hours,null);assert.equal(actualRemainingDuration({...row,actual_start:'2026-11-13'},c,'2026-11-12').actual_elapsed_hours,null);
});
test('unreported actual units remain unknown, explicit zero is valid and totals use exact resource units',()=>{
 assert.deepEqual(actualRemainingUnits(null,'3.5000'),{actual_units:null,actual_units_reported:false,forecast_total_units:null});assert.equal(actualRemainingUnits('0.0000','3.5000').forecast_total_units,'3.5000');assert.equal(actualRemainingUnits('4.0001','3.5000').forecast_total_units,'7.5001');
 const forecast=remainingAllocation({}, {rate:'100.0000'},{quantity:'2.0000',remaining_quantity:'1.0000',actual_cost:'90.0000'},3.5);assert.equal(forecast.remaining_forecast_cost,'350.0000');assert.equal(forecast.forecast_total_cost,'440.0000');
});
test('inactive resources retain actual cost but never create remaining resource usage',()=>{
 const r=decorateRemainingResources([{active:false,rate:'100.0000',allocations:[{id:'x',activity_id:'a',quantity:'2.0000',actual_cost:'90.0000'}]}],{activities:[{id:'a',duration:3.5}]},[],8)[0].allocations[0];assert.equal(r.remaining_units,'0.0000');assert.equal(r.remaining_forecast_cost,'0.0000');assert.equal(r.forecast_total_cost,'90.0000');
});
