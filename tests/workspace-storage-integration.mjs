// Real metadata APIs and SQL trigger; existing local runtime DB is probed readonly. No new remote DB.
import express from 'express';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {parseEnv} from 'node:util';import pg from 'pg';
import {workspaceStorage} from '../server/workspace-storage.ts';import {governance} from '../server/governance.ts';import {uid,requestTransaction,requestActor,pool} from '../server/db.ts';import {decrypt} from '../server/security.ts';
const env=parseEnv(await fs.readFile('.env.migrate','utf8')),c=new pg.Client({connectionString:env.DATABASE_URL});await c.connect();await c.query('BEGIN');let server;
try{
 const admin=(await c.query('SELECT id FROM users WHERE system_admin AND active LIMIT 1')).rows[0].id,viewer=uid();await c.query('INSERT INTO users(id,username,name,password_hash) VALUES($1,$2,$3,$4)',[viewer,'qa_storage_'+viewer,'QA storage','disabled']);
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:req.headers['x-user']||admin};requestActor.run(req.user.id,()=>requestTransaction.run(c,next))});app.use(workspaceStorage,governance);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(method,path,body,user=admin)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{'content-type':'application/json','x-user':user},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const cfg={name:'QA reserved database',engine:'postgres',host:'does-not-exist.invalid',port:5432,database:'qa_only',user:'qa_runtime',password:'QA_ONLY_NOT_REAL',tls:true};
 assert.equal((await call('POST','/storage-targets',cfg,viewer)).status,403);
 const created=await call('POST','/storage-targets',cfg);assert.equal(created.status,201,JSON.stringify(created));assert.equal(created.data.connected,false);const target=created.data.id;
 let row=(await c.query('SELECT * FROM storage_targets WHERE id=$1',[target])).rows[0];assert(!row.config_cipher.includes(cfg.password));assert.equal(decrypt(row.config_cipher).password,cfg.password);
 const list=await call('GET','/storage-targets');assert(!JSON.stringify(list).includes(cfg.password));assert(!JSON.stringify(list).includes(cfg.host));assert.equal(list.data.remote_activation_supported,false);
 assert.equal((await call('GET','/storage-targets',null,viewer)).data.targets.length,1);assert.equal((await call('GET','/storage-targets/'+target,null,viewer)).status,403);
 const detail=await call('GET','/storage-targets/'+target);assert.equal(detail.data.has_password,true);assert(!Object.hasOwn(detail.data,'password'));
 const {password,...publicCfg}=cfg;assert.equal((await call('PUT','/storage-targets/'+target,{...publicCfg,name:'QA updated',version:1})).data.version,2);assert.equal((await call('PUT','/storage-targets/'+target,{...publicCfg,version:1})).status,409);row=(await c.query('SELECT * FROM storage_targets WHERE id=$1',[target])).rows[0];assert.equal(decrypt(row.config_cipher).password,cfg.password);
 assert.equal((await call('PUT','/storage-targets/'+target,{...publicCfg,host:'localhost',version:2})).status,400);
 assert.equal((await call('POST','/workspaces',{name:'QA unauthorized',storage_target_id:target},viewer)).status,403);
 assert.equal((await call('POST','/storage-targets/test',cfg,viewer)).status,403);
 assert.equal((await call('POST','/storage-targets/test',{...publicCfg,target_id:target,version:1})).status,409);
 assert.equal((await call('POST','/storage-targets/test',{...publicCfg,host:'localhost',target_id:target,version:2})).status,400);
 const runtime=parseEnv(await fs.readFile('.env','utf8')),urlConfig=new URL(runtime.DATABASE_URL),probeBody={name:'QA readonly test',engine:'postgres',host:urlConfig.hostname,port:Number(urlConfig.port||5432),database:decodeURIComponent(urlConfig.pathname.slice(1)),user:decodeURIComponent(urlConfig.username),password:decodeURIComponent(urlConfig.password),tls:false,schema:'public'};
 const probe=await call('POST','/storage-targets/test',probeBody);assert.equal(probe.status,200,JSON.stringify(probe));assert(probe.data.connected&&probe.data.read_only&&!probe.data.activated);assert(probe.data.schemas.includes('public'));assert(!JSON.stringify(probe).includes(probeBody.password));
 const workspace=await call('POST','/workspaces',{name:'QA reserved workspace',storage_target_id:target});assert.equal(workspace.status,201);assert.equal(workspace.data.storage_state,'reserved');
 assert.equal((await call('POST','/workspaces/'+workspace.data.id+'/projects',{name:'Must not leak to primary',start_date:'2026-11-21',use_standard_template:false})).status,409);assert.equal((await c.query('SELECT count(*)::int n FROM projects WHERE workspace_id=$1',[workspace.data.id])).rows[0].n,0);
 await c.query('SAVEPOINT guard_check');await assert.rejects(c.query('INSERT INTO projects(id,workspace_id,name,start_date) VALUES($1,$2,$3,$4)',[uid(),workspace.data.id,'QA bypass','2026-11-21']),e=>e.code==='23514');await c.query('ROLLBACK TO SAVEPOINT guard_check');
 assert.equal((await call('DELETE','/storage-targets/'+target,{version:2})).status,409);
 const primary=await call('POST','/workspaces',{name:'QA current primary'});assert.equal(primary.data.storage_state,'active');assert.equal((await call('POST','/workspaces/'+primary.data.id+'/projects',{name:'QA primary project',start_date:'2026-11-21',use_standard_template:false})).status,201);
 const unused=await call('POST','/storage-targets',{...publicCfg,engine:'mysql',schema:'qa_only'});assert.equal((await call('DELETE','/storage-targets/'+unused.data.id,{version:1})).status,200);
 console.log('PASS encrypted reserved interface, existing local PostgreSQL readonly test, no new remote database, ACL, secret redaction, optimistic versions, workspace selection, default primary, API+SQL guard against wrong-database writes. All fixtures rolled back.');
}finally{await c.query('ROLLBACK');await c.end();if(server)await new Promise(r=>server.close(r));await pool.end()}
