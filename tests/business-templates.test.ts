import {constructionSpecs,constructionWorkflows,constructionSystems} from '../shared/construction-catalog.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableSpecs as baseTables,workflowSpecs as baseWorkflows,baseFields,reportSpecs} from '../scripts/business-catalog.ts';
import {fields} from '../server/validation.ts';
import {evaluateFormula,assertNoFormulaCycles} from '../shared/formulas.ts';
import {selectWorkflow} from '../shared/workflow-selection.ts';
import {reportPeriodWindow,resolveReportPeriod} from '../shared/report-period.ts';
const tableSpecs=constructionSpecs(baseTables,'generic'),workflowSpecs=constructionWorkflows(baseWorkflows);
test('table workflow overrides default without affecting other tables or inactive versions',()=>{
 const fallback={kind:'record',active:true,table_ids:[],created_at:'2026-10-19'},special={kind:'record',active:true,table_ids:['A'],created_at:'2026-01-01'};
 assert.equal(selectWorkflow([fallback,special],'record','A'),special);
 assert.equal(selectWorkflow([fallback,special],'record','B'),fallback);
 assert.equal(selectWorkflow([{...special,active:false}],'record','A'),undefined);
 assert.equal(selectWorkflow([special],'record','B'),undefined);
});
test('report dates follow civil days across DST, leap months and explicit overrides',()=>{
 assert.deepEqual(reportPeriodWindow('week',new Date('2026-10-25T23:30:00Z')),{dateFrom:'2026-10-26',dateTo:'2026-11-01'});
 assert.deepEqual(reportPeriodWindow('month',new Date('2024-02-12T10:00:00Z')),{dateFrom:'2024-02-01',dateTo:'2024-02-29'});
 assert.deepEqual(reportPeriodWindow('fortnight',new Date('2026-01-05T10:00:00Z')),{dateFrom:'2025-12-23',dateTo:'2026-01-05'});
 assert.equal(resolveReportPeriod({datePreset:'week',dateFrom:'2026-01-01'}).dateFrom,'2026-01-01');
});
test('business schemas have valid unique fields, resolvable references and covered workflows',()=>{
 const ids=Object.fromEntries([...tableSpecs.map(t=>t.key),'wbs','organization','activities','stock_balance','public_progress'].map(k=>[k,randomUUID()]));
 for(const spec of tableSpecs){const cols=[...baseFields(),...spec.fields].map(({target_key,...f}:any)=>({...f,...(target_key?{target_table:ids[target_key]}:{})}));
 assert.equal(new Set(cols.map(f=>f.id)).size,cols.length,spec.name);fields.parse(cols);
 for(const f of spec.fields)if(f.target_key)assert(ids[f.target_key],`${spec.key}.${f.id}`);
 assertNoFormulaCycles(Object.fromEntries(cols.filter(f=>f.type==='formula').map(f=>[f.id,f.formula])),{fields:cols.map(f=>f.id)});
 assert(workflowSpecs.some(w=>w.tables.includes(spec.key)),spec.name);
 }
 const reports=reportSpecs(ids,'QA project','EUR');assert.equal(reports.length,9);
 for(const report of reports)for(const b of Object.values(report.layout.sections).flat() as any[])if(b.source==='business_table')assert(b.tableId,report.name);
});
test('inventory and cash formulas preserve direction and exact arithmetic',()=>{
 const inventory=tableSpecs.find(t=>t.key==='movements')!.fields.find(f=>f.id==='signed_quantity');
 const cash=tableSpecs.find(t=>t.key==='cash')!.fields.find(f=>f.id==='net_flow');
 const value=(f:any,row:any)=>String(evaluateFormula(f.formula,row));
 assert.equal(value(inventory,{direction:'入库',quantity:'100.1'}),'100.1');
 assert.equal(value(inventory,{direction:'出库',quantity:'30.05'}),'-30.05');
 assert.equal(value(cash,{direction:'支出',amount:'200.12'}),'-200.12');
});
test('hospital and stadium catalogs match their specialties without business measurements',()=>{
 for(const profile of ['generic','hospital','stadium'] as const){const systems=constructionSystems(profile),specs=constructionSpecs(baseTables,profile),ids=Object.fromEntries([...specs.map(t=>t.key),'wbs','organization','activities','stock_balance','public_progress'].map(k=>[k,randomUUID()]));
  assert.equal(new Set(systems.map(s=>s.key)).size,systems.length);
  for(const spec of specs){const cols=[...baseFields(),...spec.fields].map(({target_key,...f}:any)=>({...f,...(target_key?{target_table:ids[target_key]}:{})}));fields.parse(cols);assert.equal(new Set(cols.map(f=>f.id)).size,cols.length,spec.name);}
  for(const report of reportSpecs(ids,'QA','EUR',profile))for(const block of Object.values(report.layout.sections).flat() as any[]){if(block.source!=='business_table')continue;const key=Object.keys(ids).find(k=>ids[k]===block.tableId);assert(key);const spec=specs.find(t=>t.key===key);if(block.detailFields)for(const field of block.detailFields)assert([...baseFields(),...spec!.fields].some(f=>f.id===field),`${key}.${field}`);}
 }
 assert(constructionSystems('hospital').some(s=>s.name==='医用气体与真空吸引'&&s.materials.some(m=>m[0]==='医用脱脂铜管')));
 assert(constructionSystems('stadium').some(s=>s.name==='比赛照明与场景控制'&&s.materials.some(m=>m[0]==='比赛投光灯')));
 assert(!constructionSystems('stadium').some(s=>s.key.startsWith('h-')));
});
