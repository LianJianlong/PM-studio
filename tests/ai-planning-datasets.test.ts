import {test} from 'node:test';import assert from 'node:assert/strict';
import {compilePlanningResources,normalizePlanningResourceTask} from '../server/ai-planning-datasets.ts';
import {planningDataset} from '../shared/ai-planning-datasets.ts';
const rows=[{id:'resource-1',data:{name:'塔吊',kind:'equipment',unit:'台',capacity:'2',rate:'100',version:4}}];
test('planning resource changes bind actual IDs and frozen versions and preserve untouched values',()=>{
 const task={summary:'修改数量',operations:[{action:'update' as const,id:'塔吊',data:{capacity:'3'}}]};
 const op=compilePlanningResources('project-1',task,rows).operations[0];
 assert.equal(op.path,'/projects/project-1/resources/resource-1');assert.equal(op.method,'PUT');assert.deepEqual(op.body,{kind:'equipment',name:'塔吊',unit:'台',rate:'100',capacity:'3',version:4});assert.equal(rows[0].data.capacity,'2');
});
test('planning resource compiler rejects unknown fields, duplicate or ambiguous targets, and foreign IDs',()=>{
 const compile=(operations:any[],input=rows)=>compilePlanningResources('p',{summary:'操作',operations},input);
 assert.throws(()=>compile([{action:'update',id:'foreign',data:{name:'x'}}]));
 assert.throws(()=>compile([{action:'update',id:'resource-1',data:{project_id:'other'}}]));
 assert.throws(()=>compile([{action:'delete',id:'塔吊'},{action:'delete',id:'resource-1'}]));
 assert.throws(()=>compile([{action:'delete',id:'塔吊'}],[...rows,{id:'resource-2',data:{...rows[0].data}}]));
 assert.equal(planningDataset('allocations')?.editable,false);assert.equal(planningDataset('resources')?.editable,true);
});

test('resource envelopes normalize aliases without inventing values or accepting contradictions',()=>{
 assert.deepEqual(normalizePlanningResourceTask({summary:'新增',operations:[{action:'resource.create',name:'塔吊',kind:'equipment',capacity:'2'}]}),{summary:'新增',operations:[{action:'create',data:{name:'塔吊',kind:'equipment',capacity:'2'}}]});
 assert.throws(()=>normalizePlanningResourceTask({operations:[{action:'create',name:'A',data:{name:'B'}}]}));
});
