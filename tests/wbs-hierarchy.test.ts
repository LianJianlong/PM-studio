import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {orderWbs,wbsLevelColor,wbsMoveTarget,wbsDemoteCandidates,wbsDefaultDemoteParent} from '../shared/wbs-hierarchy.ts';

test('WBS follows parent hierarchy and preserves sibling entry order',()=>{
  const rows = [
    {id:'root-a',data:{code:'A',name:'A'}},
    {id:'root-b',data:{code:'B',name:'B'}},
    {id:'child-a1',data:{code:'A.1',name:'A.1',parent:['root-a']}},
    {id:'grandchild',data:{code:'A.1.1',name:'A.1.1',parent:['child-a1']}},
    {id:'child-a2',data:{code:'A.2',name:'A.2',parent:['root-a']}},
  ];
  assert.deepEqual(orderWbs(rows).map(({row,depth})=>[row.id,depth]),[
    ['root-a',0],['child-a1',1],['grandchild',2],['child-a2',1],['root-b',0]
  ]);
  assert.equal(wbsLevelColor(1),wbsLevelColor(1));
  assert.notEqual(wbsLevelColor(1),wbsLevelColor(2));
});

test('WBS cycles cannot loop and every visible node appears once',()=>{
  const rows=[{id:'a',data:{parent:['b']}},{id:'b',data:{parent:['a']}},{id:'c',data:{parent:['hidden']}}];
  assert.deepEqual(new Set(orderWbs(rows).map(x=>x.row.id)),new Set(['a','b','c']));
});

test('WBS depth is not capped by display rules or recursive stack size',()=>{
  const rows=Array.from({length:5000},(_,i)=>({id:`node-${i}`,data:i?{parent:[`node-${i-1}`]}:{}}));
  const ordered=orderWbs(rows);
  assert.equal(ordered.length,5000);
  assert.equal(ordered.at(-1)?.depth,4999);
  assert.equal(new Set(Array.from({length:100},(_,i)=>wbsLevelColor(i))).size,100);
});

test('WBS defaults to code order and custom sort reorders siblings without moving children away',()=>{
  const rows=[
    {id:'b',data:{code:'WBS-10',name:'Zulu'}},
    {id:'a',data:{code:'WBS-2',name:'Alpha'}},
    {id:'child-b',data:{code:'WBS-10.1',name:'Child',parent:['b']}},
  ];
  assert.deepEqual(orderWbs(rows).map(x=>x.row.id),['a','b','child-b']);
  assert.deepEqual(orderWbs(rows,'name',-1).map(x=>x.row.id),['b','child-b','a']);
});

test('WBS promote moves up; demote defaults to the preceding code and excludes descendants',()=>{
  const nodes=[
    {id:'root-a',code:'WBS-001',depth:0,parent_id:null},
    {id:'child-a1',code:'WBS-001.1',depth:1,parent_id:'root-a'},
    {id:'child-a2',code:'WBS-001.2',depth:1,parent_id:'root-a'},
    {id:'root-b',code:'WBS-002',depth:0,parent_id:null},
  ];
  assert.equal(wbsMoveTarget(nodes,'child-a2'),null);
  assert.equal(wbsDefaultDemoteParent(nodes,'child-a2'),'child-a1');
  assert.equal(wbsDefaultDemoteParent(nodes,'root-b'),'child-a2');
  assert.deepEqual(wbsDemoteCandidates(nodes,'root-b').map(x=>x.id),['root-a','child-a1','child-a2']);
  assert.equal(wbsMoveTarget(nodes,'root-a'),undefined);
  assert.deepEqual(wbsDemoteCandidates(nodes,'root-a').map(x=>x.id),['root-b']);
});
