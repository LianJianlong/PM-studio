import {test} from 'node:test';import assert from 'node:assert/strict';
import {AIReferenceLabels,displayAIText} from '../shared/ai-reference-labels.ts';
const project='e24ae424-7b9f-4069-b648-d20e7c2403e2',table='86845858-3217-44e1-9781-9052c8cf8224';
const raw=`@[计划管理 / WBS](project:${project};table:${table})`;
test('visible references contain names while transport retains original project and table IDs',()=>{
 const labels=new AIReferenceLabels(),visible=labels.display(raw+' 请归纳');assert.equal(visible,'@[计划管理 / WBS] 请归纳');assert.equal(labels.expand(visible),raw+' 请归纳');assert(!visible.includes(project));
 const second=`@[计划管理 / 资源池](project:${project};dataset:resources)`;
 const both=labels.display(raw+' 与 '+second);assert.equal(labels.expand(both),raw+' 与 '+second);
 assert.equal(labels.expand(both.replace('@[计划管理 / WBS] 与 ','')),second);
});
test('same-name references stay independently bound after deleting a preceding reference',()=>{
 const labels=new AIReferenceLabels();const second=raw.replace(table,'2069ed23-1b85-424d-aaee-3c664548a846');const visible=labels.display(raw+' '+second);const rest=visible.replace('@[计划管理 / WBS] ','');assert.equal(labels.expand(rest),second);assert.equal(labels.expand(raw),raw);
});
test('legacy reference labels and operation summaries do not reveal internal UUIDs',()=>{
 const legacy=`@[工程 / 日报 / 工作记录 · ${table}](project:${project};table:${table})`;
 assert.equal(displayAIText(legacy),'@[工程 / 日报 / 工作记录]');assert(!displayAIText('已修改记录 '+table).includes(table));assert.equal(displayAIText('新增采购设备表，字段：名称、状态'),'新增采购设备表，字段：名称、状态');
});
