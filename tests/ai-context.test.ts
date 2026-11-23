import {test} from 'node:test';import assert from 'node:assert/strict';import {compactAIHistory,hasWriteIntent} from '../shared/ai-context.ts';
test('chat context keeps bounded recent key information and drops old tool dumps',()=>{const history=Array.from({length:8},(_,i)=>({role:'user' as const,text:`任务${i}\n`+'x'.repeat(9000)}));const compact=compactAIHistory(history);assert.equal(compact.length,4);assert(compact[0].text.startsWith('任务4'));assert(compact.every(m=>m.text.length<=1200));assert.equal(compactAIHistory([{role:'assistant',text:'待确认\n```json\n{"huge":"dump"}\n```\n尚未写入'}])[0].text.includes('"huge"'),false)});
test('write intent recognises Chinese and English CRUD and does not infer ordinary queries',()=>{for(const p of ['在WBS新增一条','修改名称','补充表内容','delete row'])assert(hasWriteIntent(p));for(const p of ['查询WBS','列出当前项目表','hello'])assert(!hasWriteIntent(p))});
import {normalizeTableToolArgs} from '../shared/ai-context.ts';
test('table tools normalise envelope aliases and empty optional targets but preserve all business values',()=>{const input={table_id:'',table_name:'WBS',action:'list',rows:[{data:{name:'',table_id:'business-value'}}]};assert.deepEqual(normalizeTableToolArgs('table_records',input),{table_name:'WBS',action:'query',rows:input.rows});assert.equal(input.action,'list');assert.equal(normalizeTableToolArgs('table_schema',{action:'rename',column_id:'title'}).action,'update');assert.equal(normalizeTableToolArgs('table_records',{action:'unknown'}).action,'unknown')});

test('queries and discussion about changes remain read-only, while explicit follow-up mutations require confirmation',()=>{
 for(const p of ['查询最近更新的数据','汇总已删除记录的数量','如何修改WBS名称？','@[修改记录](project:x;table:y) 查询所有内容','请总结新增任务的进展','show updated records']) assert.equal(hasWriteIntent(p),false,p);
 for(const p of ['查询WBS，然后修改名称','汇总数据并更新备注','@[数据](project:x;table:y) 补充工作范围']) assert.equal(hasWriteIntent(p),true,p);
});

import {visibleAIAnswer} from '../shared/ai-context.ts';
test('assistant display hides embedded reasoning without changing result tables',()=>{
 assert.equal(visibleAIAnswer('<think>private steps</think>结果\n|名称|数量|'),'结果\n|名称|数量|');
 assert.equal(visibleAIAnswer('结果<think>unfinished'),'结果');
 assert.equal(visibleAIAnswer('<analysis>steps</analysis>回答'),'回答');
 assert.equal(visibleAIAnswer('普通回答'),'普通回答');
});
