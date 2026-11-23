import {recordModel} from './runtime-metrics.ts';
import {isIP,BlockList} from 'node:net';
import {Resolver} from 'node:dns/promises';import {readFile} from 'node:fs/promises';
import http from 'node:http';import https from 'node:https';
import {HttpError,requireThat} from './auth.ts';
const defaults=['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.deepseek.com','open.bigmodel.cn','api.minimax.io'];
const privateDefaults=['localhost','127.0.0.1','::1','host.docker.internal'];
const list=(key:string,fallback:string[])=>new Set((process.env[key]??fallback.join(',')).split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
const clean=(host:string)=>host.replace(/^\[|\]$/g,'').toLowerCase();
export function validateEndpoint(value:string,kind:'ai'|'database',tls=true){
 let url:URL;try{const name=clean(value);url=kind==='ai'?new URL(value):new URL(`https://${isIP(name)===6?'['+name+']':value}`);}catch{throw new HttpError(400,'连接地址格式无效');}const host=clean(url.hostname);
 requireThat(kind!=='database'||url.pathname==='/'&&!url.port,400,'数据库主机与端口应分别填写');
 requireThat(!url.username&&!url.password&&!url.search&&!url.hash,400,'连接地址不能含凭据或查询参数');
 const privateHosts=list('OUTBOUND_PRIVATE_HOSTS',[...privateDefaults,'db']);
 const allowed=list(kind==='ai'?'AI_ALLOWED_HOSTS':'DB_ALLOWED_HOSTS',kind==='ai'?[...defaults,...privateDefaults]:[...privateDefaults,'db']);
 requireThat(allowed.has(host),400,'连接目标未获系统许可，请由系统管理员配置允许的主机');
 const local=privateHosts.has(host);
 requireThat(kind!=='ai'||url.protocol==='https:'||url.protocol==='http:'&&local,400,'远程模型必须使用HTTPS');
 requireThat(kind!=='database'||tls||local,400,'远程数据库必须启用TLS');
 return {host,local,url};
}
const blocked=new BlockList();for(const [ip,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,prefix,'ipv4');
for(const [ip,prefix]of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]] as const)blocked.addSubnet(ip,prefix,'ipv6');
const privateAddresses=new BlockList();for(const [ip,prefix]of [['127.0.0.0',8],['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10]] as const)privateAddresses.addSubnet(ip,prefix,'ipv4');privateAddresses.addSubnet('::1',128,'ipv6');privateAddresses.addSubnet('fc00::',7,'ipv6');
// Node BlockList maps IPv4 into IPv6 when checking it. Keeping the mapped
// range in the shared list would therefore reject every public IPv4 address.
const mappedAddresses=new BlockList();mappedAddresses.addSubnet('::ffff:0:0',96,'ipv6');
export function allowedTargetAddress(address:string,local:boolean){
 const family=isIP(address);if(!family)return false;
 if(family===6&&mappedAddresses.check(address,'ipv6'))return false;
 return local?privateAddresses.check(address,family===6?'ipv6':'ipv4'):!blocked.check(address,family===6?'ipv6':'ipv4');
}
export async function resolveTarget(host:string,local:boolean,signal?:AbortSignal){
 signal?.throwIfAborted();let addresses:{address:string;family:number}[]=[];
 if(isIP(host))addresses=[{address:host,family:isIP(host)}];else if(host==='localhost')addresses=[{address:'127.0.0.1',family:4},{address:'::1',family:6}];else{
  const hosts=await readFile(process.platform==='win32'?`${process.env.SystemRoot||'C:/Windows'}/System32/drivers/etc/hosts`:'/etc/hosts',{encoding:'utf8',signal}).catch(error=>{if(signal?.aborted)throw error;return '';});
  for(const line of hosts.split(/\r?\n/)){const parts=line.split('#')[0].trim().split(/\s+/);if(parts.slice(1).some(n=>n.toLowerCase()===host)&&isIP(parts[0]))addresses.push({address:parts[0],family:isIP(parts[0])});}
  if(!addresses.length){const resolver=new Resolver({timeout:5000,tries:1}),cancel=()=>resolver.cancel();signal?.addEventListener('abort',cancel,{once:true});try{const result=await Promise.allSettled([resolver.resolve4(host),resolver.resolve6(host)]);result.forEach((r,i)=>{if(r.status==='fulfilled')addresses.push(...r.value.map(address=>({address,family:i?6:4})));});signal?.throwIfAborted();}finally{signal?.removeEventListener('abort',cancel);}}
 }
 signal?.throwIfAborted();
 requireThat(addresses.length&&addresses.every(a=>allowedTargetAddress(a.address,local)),400,'目标解析到禁止访问的网络地址');
 return addresses[0];
}
async function modelRequest(urlString:string,headers:Record<string,string>,body:unknown,timeout:number,maxBytes=2_000_000,resolver:typeof resolveTarget=resolveTarget){
 let phase='DNS解析';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error(`模型调用超时：${phase}（${Math.round(timeout/1000)}秒）。若已建立连接但等待模型响应超时，请检查供应商模型服务或换用其他模型。`)),timeout);const signal=controller.signal;let abort:()=>void=()=>{};
 try{const {host,local,url}=validateEndpoint(urlString,'ai'),address=await Promise.race([resolver(host,local,signal),new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);signal.throwIfAborted();phase='建立网络连接';
 return await new Promise<string>((resolve,reject)=>{
  let finished=false;const done=(error?:Error,value?:string)=>{if(finished)return;finished=true;error?reject(error):resolve(value!);};
  const req=(url.protocol==='https:'?https:http).request(url,{method:'POST',headers,signal,lookup:((_h:any,options:any,cb:any)=>options.all?cb(null,[address]):cb(null,address.address,address.family)) as any},res=>{
   phase='读取模型响应';
   if(!res.statusCode||res.statusCode<200||res.statusCode>=300){res.destroy();done(new Error(`模型服务返回 HTTP ${res.statusCode}，请检查凭据、模型及协议`));return;}
   if(Number(res.headers['content-length']||0)>maxBytes){res.destroy();done(new Error('模型响应超过字节上限'));return;}
   const chunks:Buffer[]=[];let total=0;res.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>maxBytes){res.destroy();req.destroy();done(new Error('模型响应超过字节上限'));}else chunks.push(chunk);});res.on('end',()=>done(undefined,Buffer.concat(chunks).toString('utf8')));res.on('error',e=>done(e));
  });req.once('socket',socket=>{const connected=()=>{phase=url.protocol==='https:'?'TLS握手':'等待模型响应';},secure=()=>{phase='等待模型响应';};if(socket.connecting){socket.once('connect',connected);if(url.protocol==='https:')socket.once('secureConnect',secure);}else phase='等待模型响应';req.once('close',()=>{socket.removeListener('connect',connected);socket.removeListener('secureConnect',secure);});});req.on('finish',()=>{phase='等待模型响应';});req.on('error',()=>done(new Error(signal.aborted?String(signal.reason?.message||'模型调用超时'):'模型连接失败，请检查地址和网络')));req.end(JSON.stringify(body));
 });
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}

export async function boundedModelRequest(...args:Parameters<typeof modelRequest>){const start=performance.now();try{const result=await modelRequest(...args);recordModel(performance.now()-start);return result}catch(error){recordModel(performance.now()-start,error);throw error}}
