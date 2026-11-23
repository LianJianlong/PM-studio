import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schedule,type Activity} from '../server/schedule.ts';
import {calendarTemplate,calendarDate} from '../shared/project-calendar.ts';
const base='2026-11-01';
const activities=():Activity[]=>[
 {id:'a',code:'A',name:'A',duration:20,progress:0,start_not_before:'2026-11-10',predecessors:[]},
 {id:'b',code:'B',name:'B',duration:10,progress:0,predecessors:[{id:'a',type:'FS' as const,lag:0}]},
];
const date=(offset:number)=>calendarDate(base,Math.floor(offset+1e-8));
test('authored starts and FS dependencies use project working days with inclusive finish dates',()=>{
 const result=schedule(activities(),calendarTemplate('five'),base);
 assert.equal(date(result.activities[0].es),'2026-11-10');
 assert.equal(date(result.activities[0].ef),'2026-12-07');
 assert.equal(date(result.activities[1].es),'2026-12-08');
 assert.equal(date(result.activities[1].ef),'2026-12-21');
});
test('SS lag and later authored start are both respected',()=>{
 const tasks=activities();tasks[1]={...tasks[1],start_not_before:'2026-11-16',predecessors:[{id:'a',type:'SS',lag:2}]};
 const result=schedule(tasks,calendarTemplate('five'),base);
 assert.equal(date(result.activities[1].es),'2026-11-16');
});
test('nonworking authored starts advance to the next work shift',()=>{
 const tasks=activities();tasks[0].start_not_before='2026-11-14';tasks[0].duration=1;
 const result=schedule(tasks,calendarTemplate('five'),base);
 assert.equal(date(result.activities[0].es),'2026-11-16');
 assert.equal(date(result.activities[0].ef),'2026-11-16');
 assert.equal(date(result.activities[1].es),'2026-11-17');
});
