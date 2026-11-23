import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {networkDocument} from '../server/network-plan-model.ts';
import {schedule} from '../server/schedule.ts';
const a=randomUUID(),b=randomUUID();
const document=()=>({name:'阶段计划',granularity:'总控计划',start_date:'2026-10-08',activities:[
  {id:a,code:'1',name:'准备',duration:2,progress:0,predecessors:[]},
  {id:b,code:'2',name:'施工',duration:4,progress:0,predecessors:[{id:a,type:'FS',lag:1}]},
]});
test('独立网络文档排程与副本互不影响，细化后单独计算',()=>{
  const coarse=networkDocument.parse(document());
  const fine=structuredClone(coarse);fine.activities[1].duration=9;
  assert.equal(schedule(coarse.activities).work_duration,7);
  assert.equal(schedule(fine.activities).work_duration,12);
  assert.equal(coarse.activities[1].duration,4);
});
test('网络计划拒绝重复作业、自依赖、无效引用和错误数学输入',()=>{
  for(const mutate of [
    (d:any)=>d.activities[1].id=a,
    (d:any)=>d.activities[1].code='1',
    (d:any)=>d.activities[1].predecessors[0].id=b,
    (d:any)=>d.activities[1].predecessors[0].id=randomUUID(),
    (d:any)=>d.activities[1].duration=-0.2,
    (d:any)=>d.activities[1].predecessors.push({...d.activities[1].predecessors[0]}),
  ]) {const d=document();mutate(d);assert.throws(()=>networkDocument.parse(d));}
  const cyclic=networkDocument.parse({...document(),activities:document().activities.map((x,i)=>i===0?{...x,predecessors:[{id:b,type:'FS',lag:0}]}:x)});
  assert.throws(()=>schedule(cyclic.activities),/循环/);
});

test('独立网络支持图纸中的小数工期和时距，主计划原有规则保持独立',()=>{const d=document();d.activities[0].duration=0.5;d.activities[1].predecessors[0].lag=0.25;assert.equal(schedule(networkDocument.parse(d).activities).work_duration,4.75);});

test('swimlane metadata validates independently from task logic and survives a dm document round trip',async()=>{
 const {swimlaneBands}=await import('../shared/network-swimlanes.ts');const before=networkDocument.parse(document()),lanes=[{id:'phase-a',name:'Preparation',height:258},{id:'area-b',name:'Area B',height:172}];const after=networkDocument.parse(JSON.parse(JSON.stringify({...before,swimlanes:lanes})));assert.deepEqual(after.activities,before.activities);assert.deepEqual(after.swimlanes,lanes);assert.deepEqual(swimlaneBands(lanes).map(b=>[b.top,b.bottom]),[[70,328],[328,500]]);assert.throws(()=>networkDocument.parse({...before,swimlanes:[lanes[0],lanes[0]]}));assert.throws(()=>networkDocument.parse({...before,swimlanes:[{id:'a',name:'',height:100}]}));assert.throws(()=>networkDocument.parse({...before,swimlanes:[{id:'a',name:'Valid',height:0}]}));assert.equal(schedule(after.activities).work_duration,schedule(before.activities).work_duration);
});
test('native dm conversion preserves named swimlanes',async()=>{const {convertDiagram}=await import('../server/diagram-import.ts');const doc={...document(),format:'project-studio-network-plan',version:1,swimlanes:[{id:'stage-a',name:'Construction',height:344}]};const converted=convertDiagram(doc,'2026-11-21');assert.deepEqual(converted.document.swimlanes,doc.swimlanes);});
