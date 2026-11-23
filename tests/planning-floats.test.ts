import {test} from 'node:test';import assert from 'node:assert/strict';
import {schedule} from '../server/schedule.ts';import {naturalCalendar} from '../shared/project-calendar.ts';
const work=(id:string,duration:number,preds:string[]=[])=>({id,code:id,name:id,duration,progress:0,predecessors:preds.map(id=>({id,type:'FS' as const,lag:0}))});
test('free float differs from total float upstream of a shorter parallel branch',()=>{
 const rows=[work('A',2),work('B',3,['A']),work('C',4,['A']),work('D',2,['B']),work('E',2,['C']),work('F',2,['D','E']),work('G',2,['F'])];
 const result=schedule(rows);assert.equal(result.duration,12);
 assert.deepEqual(result.activities.map(a=>[a.id,a.float,a.free_float,a.critical]),[['A',0,0,true],['B',1,0,false],['C',0,0,true],['D',1,1,false],['E',0,0,true],['F',0,0,true],['G',0,0,true]]);
 const longer=schedule(rows.map(a=>a.id==='C'?{...a,duration:5}:a));assert.equal(longer.duration,13);assert.equal(longer.activities.find(a=>a.id==='B')?.float,2);
});
test('float is measured in working days even when display dates include weekends',()=>{
 const week=naturalCalendar.week.map((periods,index)=>index===0||index===6?[]:periods);const calendar={...naturalCalendar,name:'Weekdays',week};
 const rows=[work('A',1),work('B',1,['A']),work('C',3,['A'])];
 const raw=schedule(rows),dated=schedule(rows,calendar,'2026-11-06');
 assert.deepEqual(dated.activities.map(a=>[a.float,a.free_float,a.critical]),raw.activities.map(a=>[a.float,a.free_float,a.critical]));assert(dated.duration>dated.work_duration);
});
test('generalized dependency floats respect lagged SS/FF/SF constraints and terminal float',()=>{
 for(const type of ['SS','FF','SF'] as const){const rows=[work('A',4),{...work('B',2),predecessors:[{id:'A',type,lag:1}]},work('C',10)];const result=schedule(rows);for(const a of result.activities){assert(a.free_float>=0);assert(a.free_float<=a.float+1e-8);assert.equal(a.critical,Math.abs(a.float)<1e-8)}}
});
