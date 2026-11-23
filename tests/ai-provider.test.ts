import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerRequest,parseProvider,appendResults,initialMessages,ensureProviderReady} from '../server/ai-provider.ts';
import {safeBusinessPath,normalizeBusinessPath,aiTools,type AIConfig} from '../shared/ai.ts';
const c:AIConfig={provider:'openai',protocol:'responses',base_url:'https://example.test/v1',model:'test',api_key:'fake-test-key',enabled:true,max_tokens:1024,timeout_seconds:10};
test('AI business paths reject SSRF, traversal, credential and authorization endpoints',()=>{for(const p of ['https://evil.test/records','//evil.test/records','/records/../ai','/records/%2e%2e/ai','/ai/configs','/workspaces/id/connections','/workspaces/id/users','/records/id\\x'])assert.equal(safeBusinessPath(p),false,p);for(const p of ['/tables/id/records?page=1','/records/id','/projects/id/activities/id','/objects/projects/id/tables'])assert.equal(safeBusinessPath(p),true,p);});
test('Responses API formats tool schemas and returns function results without remote state',()=>{const messages=initialMessages(c,'查询'),r=providerRequest(c,'s',messages,aiTools);assert.equal(r.url,'https://example.test/v1/responses');assert.equal(r.body.store,false);assert.equal(r.body.tools[0].name,'business_api');const parsed=parseProvider(c,{output:[{type:'function_call',call_id:'call1',name:'business_api',arguments:'{"method":"GET","path":"/projects/id/tables"}'}]});appendResults(c,messages,parsed.raw,parsed.calls,[{ok:false,status:403}]);assert.equal(messages.at(-1).call_id,'call1');assert.match(messages.at(-1).output,/403/);});
test('Claude retains native content and tool_use_id when returning results',()=>{const config={...c,provider:'claude' as const,protocol:'claude' as const};const messages=initialMessages(config,'查询'),r=providerRequest(config,'s',messages,aiTools);assert.equal(r.headers['x-api-key'],c.api_key);assert.ok(r.body.tools[0].input_schema);const p=parseProvider(config,{content:[{type:'text',text:'查询中'},{type:'tool_use',id:'t1',name:'api_catalog',input:{}}]});appendResults(config,messages,p.raw,p.calls,[{catalog:'test'}]);assert.equal(messages.at(-1).content[0].tool_use_id,'t1');});
test('Gemini preserves thought signatures and native function call IDs',()=>{const config={...c,provider:'gemini' as const,protocol:'gemini' as const};const messages=initialMessages(config,'查询');const p=parseProvider(config,{candidates:[{content:{role:'model',parts:[{thoughtSignature:'signed',functionCall:{id:'g1',name:'api_catalog',args:{}}}]}}]});appendResults(config,messages,p.raw,p.calls,[{catalog:'test'}]);assert.equal(messages[1].parts[0].thoughtSignature,'signed');assert.equal(messages[2].parts[0].functionResponse.id,'g1');assert.equal(providerRequest(config,'s',messages,aiTools).headers['x-goog-api-key'],c.api_key);assert.equal(providerRequest(config,'s',messages,aiTools).body.tools[0].functionDeclarations[0].parametersJsonSchema.additionalProperties,false);});
test('Compatible chat retains reasoning and tool call IDs; Ollama can omit key',()=>{const config={...c,provider:'ollama' as const,protocol:'chat' as const,api_key:''};const messages=initialMessages(config,'查询'),p=parseProvider(config,{choices:[{message:{role:'assistant',content:null,reasoning_content:'reasoning',tool_calls:[{id:'o1',function:{name:'api_catalog',arguments:'{}'}}]}}]});appendResults(config,messages,p.raw,p.calls,[{catalog:'test'}]);assert.equal(messages[1].reasoning_content,'reasoning');assert.equal(messages[2].tool_call_id,'o1');assert.equal(providerRequest(config,'s',messages,aiTools).headers.Authorization,undefined);});
test('Malformed envelopes fail and malformed tool JSON is marked before execution',()=>{assert.throws(()=>parseProvider(c,{}));const parsed=parseProvider(c,{output:[{type:'function_call',call_id:'x',name:'business_api',arguments:'not-json'}]});assert.equal(parsed.calls[0].arguments.__invalid_tool_json,true);assert.throws(()=>parseProvider({...c,protocol:'chat'},{choices:[]}));assert.equal(safeBusinessPath('/projects/id/ai/chat'),false);assert.equal(safeBusinessPath('/projects/id/ai/tool'),false);assert.equal(safeBusinessPath('/projects/id/workflow-definitions'),true)});
test('Ollama thinking can be disabled without exposing reasoning or changing other providers',()=>{
  const config={...c,provider:'ollama' as const,protocol:'chat' as const,api_key:'',thinking:false};
  const r=providerRequest(config,'s',initialMessages(config,'查询'),aiTools);
  assert.equal(r.body.think,false);assert.equal(r.body.reasoning_effort,'none');assert.ok(r.body.tools);
  assert.equal(providerRequest({...config,thinking:true},'s',[],[]).body.think,true);
  assert.equal(providerRequest({...config,thinking:undefined},'s',[],[]).body.think,undefined);
  assert.equal(providerRequest({...config,provider:'compatible'},'s',[],[]).body.think,undefined);
});
test('Cold start uses its own 600 second budget and single-flight warmup, without consuming inference budget',async()=>{
  const config={...c,provider:'ollama' as const,protocol:'chat' as const,cold_start_seconds:600,timeout_seconds:120};
  let release!:()=>void,calls=0;
  const request=async(url:string,_headers:any,body:any,timeout:number)=>{
    calls++;assert.equal(url,'https://example.test/api/generate');assert.equal(timeout,600000);
    assert.equal(body.prompt,'');assert.equal(body.keep_alive,'10m');
    await new Promise<void>(resolve=>{release=resolve});return '{"done":true}';
  };
  const first=ensureProviderReady(config,request),second=ensureProviderReady(config,request);
  assert.equal(calls,1);release();await Promise.all([first,second]);assert.equal(config.timeout_seconds,120);
  await assert.rejects(ensureProviderReady(config,async()=>'{"error":"not ready"}'),/预热失败/);
  await ensureProviderReady(config,async()=>'{"done":true}');
});
test('Data tools discover metadata without treating ordinary field names or search text as credential endpoints',()=>{
  assert.equal(safeBusinessPath('/objects/tables/id/columns/users'),true);
  assert.equal(safeBusinessPath('/tables/id/records?search=users%20name'),true);
  assert.equal(safeBusinessPath('/workspaces/id/users/password'),false);
  assert.equal(safeBusinessPath('/projects/id/ai/chat'),false);
  assert.equal(safeBusinessPath('/public/views/00000000-0000-4000-8000-000000000001'),true);
  assert.equal(safeBusinessPath('/tables/id/records?search=x#fragment'),false);
});
test('Model relative business paths normalize locally without allowing URLs, traversal or credentials',()=>{
  assert.equal(normalizeBusinessPath('projects/id/tables'),'/projects/id/tables');
  assert.equal(normalizeBusinessPath(' /tables/id/records '),'/tables/id/records');
  for(const value of ['https://evil.test/records','//evil.test/records','records/../ai','projects/id/ai/chat','workspaces/id/users','tables/%2e%2e/records'])
    assert.equal(safeBusinessPath(normalizeBusinessPath(value)),false,value);
});
test('Protected credentials and recursive model routes cannot bypass policy with mixed case',()=>{
  for(const path of ['/workspaces/id/USERS','/workspaces/id/AI-CONFIGS','/workspaces/id/Connections','/projects/id/AI/chat'])assert.equal(safeBusinessPath(path),false,path);
  assert.equal(safeBusinessPath('/objects/tables/id/columns/Users'),true);
});
test('Ollama missing cold-start configuration receives a thirty-minute independent budget',async()=>{
 const config={...c,provider:'ollama' as const,protocol:'chat' as const,timeout_seconds:600};let seen=0;
 await ensureProviderReady(config,async(_url,_headers,_body,timeout)=>{seen=timeout;return '{"done":true}'});
 assert.equal(seen,1800000);assert.equal(config.timeout_seconds,600);
});
test('malformed tool arguments become a repairable tool error',()=>{const result=parseProvider({...c,protocol:'chat'},{choices:[{message:{content:'',tool_calls:[{id:'bad',function:{name:'prepare_plan',arguments:'{bad'}}]}}]});assert.equal(result.calls[0].arguments.__invalid_tool_json,true);assert.equal(result.raw.tool_calls[0].function.arguments,'{}')});
test('structured workbench forces one declared tool for each provider protocol',()=>{for(const protocol of ['chat','responses','claude','gemini'] as const){const body=providerRequest({...c,protocol},'s',initialMessages({...c,protocol},'task'),[{name:'submit_draft',description:'draft',parameters:{type:'object'}}],'submit_draft').body;assert(protocol==='gemini'?body.toolConfig.functionCallingConfig.allowedFunctionNames.includes('submit_draft'):JSON.stringify(body.tool_choice).includes('submit_draft'));}});
test('Gemini display model names and models prefix normalize to API model IDs',()=>{
 const config={...c,provider:'gemini' as const,protocol:'gemini' as const,model:'Gemini 3.8 flash'};
 assert.equal(providerRequest(config,'s',initialMessages(config,'test'),[]).url,'https://example.test/v1/models/gemini-3.8-flash:generateContent');
 assert.equal(providerRequest({...config,model:'models/gemini-3.8-flash'},'s',[],[]).url,'https://example.test/v1/models/gemini-3.8-flash:generateContent');
});
