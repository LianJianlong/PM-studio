import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {validateEndpoint,resolveTarget,boundedModelRequest} from '../server/outbound.ts';import {hashPasswordAsync,verifyPasswordAsync} from '../server/security.ts';
import {EventEmitter} from 'node:events';import {requestBudget} from '../server/request-budget.ts';
test('request concurrency budget rejects excess work and releases each response once',()=>{
 const budget=requestBudget(2,1);let accepted=0;const response=()=>Object.assign(new EventEmitter(),{code:200,status(n:number){this.code=n;return this;},json(){return this;}});
 const first=response(),second=response(),duplicate=response(),full=response();const enter=(who:string,res:any)=>budget({user:{id:who}} as any,res,()=>accepted++);
 enter('a',first);enter('a',duplicate);assert.equal(duplicate.code,429);enter('b',second);enter('c',full);assert.equal(full.code,429);assert.equal(accepted,2);
 first.emit('finish');first.emit('close');const after=response();enter('a',after);assert.equal(after.code,200);assert.equal(accepted,3);second.emit('close');after.emit('finish');
});
test('outbound hosts cannot use numeric-prefix domains to bypass HTTPS or system whitelist',()=>{
 for(const host of ['127.example.invalid','10.example.invalid','192.168.example.invalid'])assert.throws(()=>validateEndpoint('http://'+host+'/v1','ai'));
 assert.throws(()=>validateEndpoint('evil.example','database',false));assert.equal(validateEndpoint('http://host.docker.internal:11434/v1','ai').local,true);
 assert.throws(()=>validateEndpoint('https://user:pass@api.openai.com/v1','ai'));
 const previous=process.env.DB_ALLOWED_HOSTS;try{process.env.DB_ALLOWED_HOSTS='db.example.invalid';assert.throws(()=>validateEndpoint('db.example.invalid','database',false));assert.equal(validateEndpoint('db.example.invalid','database',true).local,false);}finally{if(previous===undefined)delete process.env.DB_ALLOWED_HOSTS;else process.env.DB_ALLOWED_HOSTS=previous;}
 assert.equal(validateEndpoint('::1','database',false).host,'::1');assert.throws(()=>validateEndpoint('localhost:5432','database',false));
});
test('remote names resolving to private IPs are refused; explicitly local IP remains supported',async()=>{
 await assert.rejects(resolveTarget('127.0.0.1',false));await assert.rejects(resolveTarget('::1',false));await assert.rejects(resolveTarget('8.8.8.8',true));await assert.rejects(resolveTarget('169.254.169.254',true));assert.equal((await resolveTarget('127.0.0.1',true)).address,'127.0.0.1');
});
test('bounded model reads cancel oversized chunked bodies and never follow redirects',async()=>{
 let redirected=0;const server=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'/sink'});res.end();}else if(req.url==='/sink'){redirected++;res.end('{}');}else if(req.url==='/large'){res.write(Buffer.alloc(10000,65));res.end();}else res.end('{"ok":true}');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 try{assert.equal(await boundedModelRequest(`http://127.0.0.1:${port}/small`,{}, {},1000,20),'{"ok":true}');await assert.rejects(boundedModelRequest(`http://127.0.0.1:${port}/large`,{}, {},1000,20),/字节上限/);await assert.rejects(boundedModelRequest(`http://127.0.0.1:${port}/redirect`,{}, {},1000),/302/);assert.equal(redirected,0);}finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('async password derivation checks valid, invalid and malformed hashes',async()=>{const hash=await hashPasswordAsync('Long-random-password!');assert.equal(await verifyPasswordAsync('Long-random-password!',hash),true);assert.equal(await verifyPasswordAsync('wrong',hash),false);assert.equal(await verifyPasswordAsync('any','broken'),false);});
test('public IPv4/IPv6 stay reachable while mapped addresses cannot bypass private-network checks',async()=>{
 const {allowedTargetAddress}=await import('../server/outbound.ts');
 for(const ip of ['8.8.8.8','172.217.112.4','2001:4860:4842:400::'])assert(allowedTargetAddress(ip,false),ip);
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','fc00::1','::ffff:8.8.8.8','::ffff:127.0.0.1','::ffff:7f00:1'])assert(!allowedTargetAddress(ip,false),ip);
 assert.equal((await resolveTarget('8.8.8.8',false)).address,'8.8.8.8');
});
test('model response timeout identifies the stage after a connection is established',async()=>{
 const server=http.createServer((_req,_res)=>{});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 try{await assert.rejects(boundedModelRequest(`http://127.0.0.1:${port}/wait`,{}, {},100),/等待模型响应/);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
