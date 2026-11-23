import {test} from 'node:test';import assert from 'node:assert/strict';import {normalizeBusinessReadShape} from '../shared/ai-read-arguments.ts';
test('read aliases preserve explicit identities and normalize a model aggregate envelope',()=>{
 const id='00000000-0000-4000-8000-000000000001';assert.deepEqual(normalizeBusinessReadShape({mode:'aggregate',dataset:id,metric:'sum',field:'amount'}),{mode:'aggregate',table_id:id,metric:'amount',aggregation:'sum',dimension:'__status__'});
 assert.deepEqual(normalizeBusinessReadShape({mode:'query',table:'采购订单',search:'PO-01'}),{mode:'search',table_name:'采购订单',search:'PO-01'});
});
test('normalization cannot turn a mutation into a read or change numeric/business values',()=>{
 const input={mode:'update',table_id:'known',data:{amount:'9007199254740993.1234'}};assert.deepEqual(normalizeBusinessReadShape(input),input);assert.deepEqual(normalizeBusinessReadShape({mode:'plan',dataset:'resources'}),{mode:'plan',dataset:'resources'});
 const value={mode:'aggregate',table_id:'first',dataset:'00000000-0000-4000-8000-000000000001',metric:'amount',aggregation:'average',dimension:'department'};assert.throws(()=>normalizeBusinessReadShape(value),/Conflicting/);
});
