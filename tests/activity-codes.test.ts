import {test} from 'node:test';import assert from 'node:assert/strict';import {codeRule,codeSuggestions,renumberActivityCodes} from '../shared/activity-codes.ts';
const rule=codeRule({code_prefix:'A-',code_start:'10',code_step:'10',code_width:4});
test('next activity codes respect custom IDs, highest matching numeric value and gap filling',()=>{
 assert.deepEqual(codeSuggestions(rule,['A-0010','A-0030','A-0015A','OTHER-999']),['A-0040','A-0050','A-0060','A-0070','A-0080']);
 assert.deepEqual(codeSuggestions({...rule,code_fill_gaps:true},['A-0010','A-0030'],3),['A-0020','A-0040','A-0050']);
});
test('renumber uses supplied display order, permits swaps and rejects external collisions',()=>{
 const rows=[{id:'second',code:'A-0020'},{id:'first',code:'A-0010'}];const p=renumberActivityCodes(rule,rows,[]);assert.deepEqual(p.map(x=>[x.id,x.before,x.after]),[['second','A-0020','A-0010'],['first','A-0010','A-0020']]);
 assert.throws(()=>renumberActivityCodes(rule,rows,['A-0010']));assert.equal(renumberActivityCodes(rule,[{id:'a',code:'A-0010'}],['A-0010'])[0].changed,false);
});
test('large code suffixes stay exact and cannot overflow',()=>{
 assert.deepEqual(codeSuggestions({...rule,code_start:'999999999998',code_step:'1'},[],2),['A-999999999998','A-999999999999']);assert.throws(()=>codeSuggestions({...rule,code_start:'999999999999',code_step:'1'},[],2));
});
