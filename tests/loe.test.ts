import {test} from 'node:test';import assert from 'node:assert/strict';import {schedule,type Activity} from '../server/schedule.ts';import {LOE,completeLoeScope} from '../shared/loe.ts';import {defaultProjectCalendar as c,calendarDate} from '../shared/project-calendar.ts';
const task=(id:string,duration:number,deps:string[]=[],more:any={}):Activity=>({id,code:id,name:id,duration,progress:0,predecessors:deps.map(id=>({id,type:'FS',lag:0})),...more});
const input=()=>[task('A',2),task('B',3,['A']),task('L',999,[],{activity_type:LOE,loe_scope:['A','B']})];
test('LOE derives its span from ordinary work, ignores entered duration and cannot drive another task',()=>{
 const rows=input();rows[1].predecessors.push({id:'L',type:'FS',lag:100});const p=schedule(rows,c,'2026-11-09');const l=p.activities.find(a=>a.id==='L')!;assert.equal(l.duration,5);assert.equal(l.work_es,0);assert.equal(l.work_ef,5);assert.equal(p.activities.find(a=>a.id==='B')!.work_es,2);assert.equal(l.critical,false);assert(p.critical_paths.every(x=>!x.activity_ids.includes('L')));assert.equal(p.duration_summary.work_span,5);
});
test('delaying an endpoint extends support work through the working calendar without creating a logical cycle',()=>{
 const rows=input();rows[1].duration=6;const p=schedule(rows,c,'2026-11-09');const l=p.activities[2];assert.equal(l.duration,8);assert.equal(calendarDate('2026-11-09',l.ef),'2026-11-18');assert.equal(p.duration_summary.calendar_days,10);
});
test('LOE retains actual dates, excludes duplicate physical-progress weight, and accepts only ordinary scope',()=>{
 const rows=input();rows[0].progress=100;rows[2].progress=100;rows[2].actual_start='2026-11-10';rows[2].actual_finish='2026-11-13';const p=schedule(rows,c,'2026-11-09');assert.equal(p.progress,40);assert.equal(p.activities[2].duration,4);assert.equal(p.activities[2].remaining_duration,0);assert.equal(calendarDate('2026-11-09',p.activities[2].es),'2026-11-10');
 assert.throws(()=>schedule([task('L',0,[],{activity_type:LOE,loe_scope:['L']})]));assert.throws(()=>schedule([task('L',0,[],{activity_type:LOE,constraint_type:'强制开始'})]));
});
test('unconfigured or unpublished LOE is excluded without excluding its ordinary successors',()=>{
 const rows=input();rows[2].loe_scope=[];const p=schedule(rows,c,'2026-11-09');assert.equal(p.activities[2].duration,0);assert(p.activities[2].constraint_messages.length);assert.equal(p.duration_summary.work_span,5);
 const kept=completeLoeScope([task('A',2),task('B',3,['L'])],new Set(['L']));assert.equal(kept.length,2);assert.equal(kept[1].predecessors.length,0);
 const scope=completeLoeScope([task('B',3),task('L',0,[],{activity_type:LOE,loe_scope:['missing']})]);assert.deepEqual(scope.map(x=>x.id),['B']);
});
test('remaining forecast anchors LOE to remaining scope and does not manufacture reported progress',()=>{
 const rows=input();const p=schedule(rows,c,'2026-11-09','duration',{data_date:'2026-11-12',forecast_remaining:true});const l=p.activities[2];assert.equal(l.work_es,3);assert.equal(l.work_ef,8);assert.equal(l.duration,5);assert.equal(l.progress,0);assert.equal(l.remaining_duration,5);
});
