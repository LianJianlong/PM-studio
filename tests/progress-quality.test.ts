import test from 'node:test';import assert from 'node:assert/strict';import {progressQuality} from '../shared/progress-quality.ts';import {calendarTemplate} from '../shared/project-calendar.ts';import {schedule} from '../server/schedule.ts';
const c=calendarTemplate('five'),start='2026-11-09',a=(id:string,extra:any={})=>({id,code:id,name:id,duration:5,progress:0,predecessors:[],...extra});
test('progress integrity blocks missing actuals, future actuals, and unfinished zero remaining duration',()=>{
 const q=progressQuality([a('A',{progress:30}),a('B',{progress:100}),a('C',{actual_start:'2026-11-13'}),a('D',{remaining_duration:0})],c,start,'2026-11-12');assert(q.blocking_count>=5);assert(q.items.some(i=>i.code==='C'&&i.severity==='error'));assert(q.items.some(i=>i.code==='D'&&i.severity==='error'));
});
test('estimated remaining and out-of-sequence retained logic are warnings, never invented actuals',()=>{
 const rows=[a('A'),a('B',{progress:30,actual_start:start,predecessors:[{id:'A',type:'FS',lag:0}]})],q=progressQuality(rows,c,start,'2026-11-12');assert.equal(q.blocking_count,0);assert.equal(q.warning_count,2);assert.equal(rows[0].actual_start,undefined);const s=schedule(rows,c,start,'duration',{data_date:'2026-11-12',forecast_remaining:true});assert.equal(s.activities[1].actual_start,start);assert(s.activities[1].work_ef>=s.activities[0].work_ef+3.5);
});
test('nonworking data date rolls forward; dates before project origin never advance work before the project',()=>{
 assert.equal(progressQuality([],c,start,'2026-11-14').effective_work_date,'2026-11-16');const q=progressQuality([],c,start,'2026-11-07');assert.equal(q.effective_work_date,start);assert(q.warning_count>0);assert(progressQuality([],c,start,'2026-11-17','2026-11-12').warning_count>0);
});
test('milestones and derived LOE do not require physical remaining duration, but actual-date errors remain visible',()=>{
 const q=progressQuality([a('M',{duration:0,remaining_duration:0}),a('L',{activity_type:'LOE持续性作业',progress:50,remaining_duration:0}),a('Done',{actual_start:start,actual_finish:'2026-11-10',progress:100,remaining_duration:0})],c,start,'2026-11-12');assert.equal(q.blocking_count,0);assert.equal(q.warning_count,0);assert(progressQuality([a('M',{duration:0,progress:50,actual_start:start})],c,start,'2026-11-12').blocking_count>0);
 assert(progressQuality([a('L',{activity_type:'LOE持续性作业',actual_start:'2026-11-13'})],c,start,'2026-11-12').blocking_count>0);
});
test('explicit remaining hours must be whole hours and completed records cannot retain future work',()=>{
 assert(progressQuality([a('A',{remaining_duration:1.1})],c,start,'2026-11-12').blocking_count>0);assert.equal(progressQuality([a('A',{remaining_duration:1.125})],c,start,'2026-11-12').blocking_count,0);assert(progressQuality([a('A',{progress:100,actual_start:start,actual_finish:'2026-11-10',remaining_duration:2})],c,start,'2026-11-12').blocking_count>0);
});
