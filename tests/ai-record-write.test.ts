import {test} from 'node:test';import assert from 'node:assert/strict';import {normalizeAIRecordWrite} from '../shared/ai-record-write.ts';
const path='/tables/2069ed23-1b85-424d-aaee-3c664548a846/records';
test('AI batch create preserves all values and selects atomic import endpoint',()=>{const rows=[{title:'项目启动'},{title:'需求分析'}],input={method:'POST',path,body:{records:rows}};assert.deepEqual(normalizeAIRecordWrite(input),{method:'POST',path:path.replace('/records','/import'),body:{rows}});assert.deepEqual(input.body,{records:rows})});
test('single creates, other routes and versions remain unchanged',()=>{for(const input of [{method:'POST',path,body:{data:{title:'事项'}}},{method:'PUT',path:'/records/id',body:{version:2,data:{title:'事项'}}}])assert.equal(normalizeAIRecordWrite(input),input)});
test('ambiguous, malformed and empty batches are rejected without guessing',()=>{for(const body of [{records:[]},{records:['x']},{records:[{title:'x'}],data:{title:'y'}},{records:Array(5001).fill({})}])assert.throws(()=>normalizeAIRecordWrite({method:'POST',path,body}))});

test('batch creation supports more than the former1000-row limit',()=>{const rows=Array.from({length:5000},(_,i)=>({title:String(i)}));assert.equal((normalizeAIRecordWrite({method:'POST',path,body:{records:rows}}).body as any).rows.length,5000)});
