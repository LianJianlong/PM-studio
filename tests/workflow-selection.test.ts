import {test} from 'node:test';import assert from 'node:assert/strict';import {availableWorkflows} from '../shared/workflow-selection.ts';
test('workflow picker lists only active same-kind generic and matching-table named flows',()=>{
 const flows=[{id:'a',kind:'record',active:true,table_ids:[]},{id:'b',kind:'record',active:true,table_ids:['t']},{id:'c',kind:'record',active:true,table_ids:['other']},{id:'d',kind:'stage',active:true,table_ids:[]},{id:'e',kind:'record',active:false,table_ids:['t']}];assert.deepEqual(availableWorkflows(flows,'record','t').map(f=>f.id),['a','b']);assert.deepEqual(availableWorkflows(flows,'record').map(f=>f.id),['a']);
});
