import {test} from 'node:test';import assert from 'node:assert/strict';
import {probeDatabase} from '../server/database-probe.ts';import {storageTargetBody} from '../shared/storage-target.ts';
const config=storageTargetBody.parse({name:'QA',host:'localhost',port:5432,database:'qa',user:'studio_app',password:'QA_NOT_REAL',tls:false,schema:'public'});
test('PostgreSQL connection test pins DNS, forces read only and closes without activating storage',async()=>{
 const sql:string[]=[];let ended=false;const result=await probeDatabase(config,'storage',{postgres:options=>{assert.equal(options.host,'127.0.0.1');assert.equal(options.connectionTimeoutMillis,7000);assert.equal(options.options,'-c default_transaction_read_only=on');return {connect:async()=>{},query:async(text:string)=>{sql.push(text);return {rows:text.includes('current_database')?[{database:'qa',privileged:false}]:text.includes('pg_database')?[{name:'qa'},{name:'other'}]:text.includes('schemata')?[{name:'public'},{name:'engineering'}]:[]}},end:async()=>{ended=true}}}});
 assert(ended);assert.equal(result.connected,true);assert.equal(result.activated,false);assert.equal(result.schema_exists,true);assert.deepEqual(result.schemas,['public','engineering']);assert.equal(sql[0],'BEGIN READ ONLY');assert.equal(sql.at(-1),'ROLLBACK');assert(sql.every(s=>!/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(s)));
});
test('database tests hide driver secrets, close failed clients and block privileged logins',async()=>{
 let closed=false;await assert.rejects(probeDatabase(config,'storage',{postgres:()=>({connect:async()=>{throw Object.assign(Error('password='+config.password),{code:'28P01'})},end:async()=>{closed=true}})}),e=>!(e as Error).message.includes(config.password!)&&(e as any).status===400);assert(closed);
 await assert.rejects(probeDatabase({...config,user:'postgres'},'storage'),e=>(e as any).status===403);
 await assert.rejects(probeDatabase(config,'query'),e=>(e as any).status===403);
});
test('remote MySQL probe uses TLS and a pinned socket with readonly metadata queries',async()=>{
 const before=process.env.DB_ALLOWED_HOSTS;process.env.DB_ALLOWED_HOSTS='db.example.invalid';try{const sql:string[]=[];let closed=false;const result=await probeDatabase({...config,engine:'mysql',host:'db.example.invalid',port:3306,user:'readonly',tls:true},'query',{resolve:async()=>({address:'8.8.8.8',family:4}),mysql:async options=>{assert.equal(options.host,'db.example.invalid');assert.equal(options.multipleStatements,false);assert.equal(options.ssl.verifyIdentity,true);return {query:async(q:any)=>{sql.push(q.sql);assert.equal(q.timeout,5000);return [[{Database:'qa'}],[]]},rollback:async()=>{sql.push('ROLLBACK')},end:async()=>{closed=true}}}});assert(closed);assert.equal(result.schema,'qa');assert.equal(result.schema_exists,true);assert.deepEqual(sql,['START TRANSACTION READ ONLY','SHOW DATABASES','ROLLBACK']);}finally{if(before===undefined)delete process.env.DB_ALLOWED_HOSTS;else process.env.DB_ALLOWED_HOSTS=before}
});
test('a missing schema is reported without pretending that it was created',async()=>{
 const result=await probeDatabase({...config,schema:'missing'},'storage',{postgres:()=>({connect:async()=>{},query:async(text:string)=>({rows:text.includes('current_database')?[{database:'qa',privileged:false}]:text.includes('schemata')?[{name:'public'}]:[]}),end:async()=>{}})});assert.equal(result.schema_exists,false);assert.equal(result.activated,false);
});
