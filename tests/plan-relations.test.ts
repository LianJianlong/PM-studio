import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityRelations,relationInterval,relationColumns} from '../shared/plan-relations.ts';
test('关系列由真实前置关系反向推导后置，保持多条边的版本与间隔',()=>{
  const a={id:'a',version:1,predecessors:[],custom_editable:true};
  const b={id:'b',version:2,predecessors:[{id:'a',type:'FS',lag:3}],custom_editable:true};
  const c={id:'c',version:4,predecessors:[{id:'b',type:'FF',lag:-2}],custom_editable:false};
  const edges=activityRelations('b',[a,b,c]);
  assert.deepEqual(edges.map(e=>[e.direction,e.type,e.lag,e.version,e.editable]),[['前置','FS',3,2,true],['后置','FF',-2,4,false]]);
  assert.equal(relationColumns.length,5);
  assert.deepEqual(activityRelations('missing',[a]),[]);
});
test('提前、滞后转换为排程间隔，拒绝负数、小数和超范围',()=>{
  assert.equal(relationInterval('lead',2),-2);
  assert.equal(relationInterval('lag',2),2);
  assert.equal(relationInterval('none',2),0);
  for(const value of [-1,0.5,3651,NaN]) assert.throws(()=>relationInterval('lag',value));
  assert.throws(()=>relationInterval('other',0));
});
