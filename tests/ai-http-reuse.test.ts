import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {boundedModelRequest} from '../server/outbound.ts';
test('repeated local-model calls do not retain TLS phase listeners on reused HTTP sockets',async()=>{
 const server=http.createServer(async(req,res)=>{for await(const _chunk of req){}res.setHeader('Content-Type','application/json');res.end('{"ok":true}')});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;
 try{for(let i=0;i<20;i++)assert.equal(await boundedModelRequest(`http://127.0.0.1:${port}/v1`,{}, {},1000),'{"ok":true}');await new Promise(r=>setImmediate(r));const sockets=Object.entries(http.globalAgent.freeSockets).filter(([key])=>key.includes(':'+port+':')).flatMap(([,v])=>v||[]);assert(sockets.length>0);for(const socket of sockets)assert.equal(socket.listenerCount('secureConnect'),0);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
});
