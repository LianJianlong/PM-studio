import {test} from 'node:test';import assert from 'node:assert/strict';import {pool,tx} from '../server/db.ts';
test('transaction finalization flushes dirty LOE state before commit',async()=>{
 const events:string[]=[];const original=pool.connect;
 (pool as any).connect=async()=>({query:async(sql:string)=>{events.push(sql);return {rows:sql.includes('current_setting')?[{value:'[]'}]:[]}},release:()=>events.push('RELEASE')});
 try{const value=await tx(async()=>{events.push('BUSINESS');return 7});assert.equal(value,7);assert.equal(events.filter(s=>s.includes('current_setting')).length,2);assert(events.indexOf('BUSINESS')<events.indexOf('COMMIT'));assert.equal(events.at(-1),'RELEASE');assert(!events.includes('ROLLBACK'));}finally{(pool as any).connect=original}
});
test('a failed derived-state flush rolls back the business write instead of committing stale costs',async()=>{
 const events:string[]=[];const original=pool.connect;
 (pool as any).connect=async()=>({query:async(sql:string)=>{events.push(sql);return {rows:sql.includes('current_setting')?[{value:'invalid-json'}]:[]}},release:()=>events.push('RELEASE')});
 try{await assert.rejects(()=>tx(async()=>{events.push('BUSINESS')}));assert(events.includes('ROLLBACK'));assert(!events.includes('COMMIT'));assert.equal(events.at(-1),'RELEASE');}finally{(pool as any).connect=original}
});
