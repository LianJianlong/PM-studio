import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequestQueue} from '../shared/request-queue.ts';
test('refresh bursts stay within concurrency limit and failed requests release slots',async()=>{
 const queue=createRequestQueue(4);let active=0,peak=0;const started:number[]=[];
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>queue(async()=>{started.push(i);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;if(i===3)throw Error('failure');return i;})));
 assert.equal(peak,4);assert.equal(active,0);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.deepEqual(started,Array.from({length:20},(_,i)=>i));assert.equal(await queue(async()=>42),42);
});
