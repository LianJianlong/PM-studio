import {test} from 'node:test';import assert from 'node:assert/strict';import {relaxRequiredColumns} from '../shared/required-field-policy.ts';
const fields=(ids:string[])=>ids.map(id=>({id,type:'text',required:true}));
test('stock and earned value tables retain five business-critical fields without adding constraints',()=>{
 const stock=fields(['code','name','date','material_code','material_name','unit','warehouse','direction','quantity']);const changed=relaxRequiredColumns(stock,'movements');assert.deepEqual(changed.filter(f=>f.required).map(f=>f.id),['date','material_code','unit','direction','quantity']);assert.equal(stock[0].required,true);assert.deepEqual(relaxRequiredColumns(changed,'movements'),changed);
 const earned=relaxRequiredColumns(fields(['code','name','date','currency','pv','ev','ac']),'earned_snapshots');assert.deepEqual(earned.filter(f=>f.required).map(f=>f.id),['date','currency','pv','ev','ac']);
});
test('already concise schemas and optional values stay unchanged; custom tables cap only existing requirements',()=>{
 const small=fields(['code','name']);assert.equal(relaxRequiredColumns(small),small);
 const custom=[...fields(['note','name','date','code','quantity','amount','misc']),{id:'optional',type:'text',required:false}];const next=relaxRequiredColumns(custom);assert.equal(next.filter(f=>f.required).length,5);assert.equal(next.at(-1)?.required,false);assert.deepEqual(next.map(f=>f.id),custom.map(f=>f.id));
});
import {tableSpecs,baseFields} from '../shared/business-catalog.ts';
import {constructionSpecs} from '../shared/construction-catalog.ts';
test('all future construction project profiles use at most five required input fields',()=>{
 for(const profile of ['generic','hospital','stadium'] as const)for(const spec of constructionSpecs(tableSpecs,profile)){
  const columns=[...baseFields(),...spec.fields];const next=relaxRequiredColumns(columns,spec.key);
  assert(next.filter(f=>f.required).length<=5,profile+':'+spec.key);
 }
});
