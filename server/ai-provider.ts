import {normalizeGeminiModel} from '../shared/ai-config.ts';
import {aiTiming} from "../shared/ai-timing.ts";
import type {AIConfig} from '../shared/ai.ts';
import {boundedModelRequest} from './outbound.ts';
export type ToolCall={id:string;name:string;arguments:any};
export function providerRequest(config:AIConfig,system:string,messages:any[],tools:any[],toolName?:string){
  const base=config.base_url.replace(/\/$/,'');
  const headers:Record<string,string>={'Content-Type':'application/json'};
  let url=base,body:any;
  if(config.protocol==='claude'){
    headers['x-api-key']=config.api_key||'';headers['anthropic-version']='2023-06-01';url+='/messages';
    body={model:config.model,max_tokens:config.max_tokens,system,messages,...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters}))}:{})};
  }else if(config.protocol==='gemini'){
    headers['x-goog-api-key']=config.api_key||'';url+=`/models/${encodeURIComponent(normalizeGeminiModel(config.model))}:generateContent`;
    body={systemInstruction:{parts:[{text:system}]},contents:messages,generationConfig:{maxOutputTokens:config.max_tokens},...(tools.length?{tools:[{functionDeclarations:tools.map(t=>({name:t.name,description:t.description,parametersJsonSchema:t.parameters}))}]}:{})};
  }else {
    if(config.api_key)headers.Authorization='Bearer '+config.api_key;
    if(config.protocol==='responses'){
      url+='/responses';body={model:config.model,instructions:system,input:messages,max_output_tokens:config.max_tokens,store:false,...(tools.length?{tools:tools.map(t=>({type:'function',...t,strict:false}))}:{})};
    }else {url+='/chat/completions';body={model:config.model,messages:[{role:'system',content:system},...messages],max_tokens:config.max_tokens,
      ...(config.provider==='ollama'&&typeof config.thinking==='boolean'?{think:config.thinking,...(!config.thinking?{reasoning_effort:'none'}:{})}:{}),
      ...(tools.length?{tools:tools.map(t=>({type:'function',function:t}))}:{})};}
  }
  if(toolName&&tools.length){
    if(config.protocol==='claude')body.tool_choice={type:'tool',name:toolName};
    else if(config.protocol==='gemini')body.toolConfig={functionCallingConfig:{mode:'ANY',allowedFunctionNames:[toolName]}};
    else if(config.protocol==='responses')body.tool_choice={type:'function',name:toolName};
    else body.tool_choice={type:'function',function:{name:toolName}};
  }
  return {url,headers,body};
}
export function initialMessages(config:AIConfig,prompt:string):any[]{return config.protocol==='gemini'?[{role:'user',parts:[{text:prompt}]}]:[{role:'user',content:prompt}];}
export function parseProvider(config:AIConfig,value:any):{text:string;calls:ToolCall[];raw:any}{
  const parse=(v:any,holder?:any,key?:string)=>{if(typeof v!=='string')return v;try{return JSON.parse(v)}catch{if(holder&&key)holder[key]='{}';return {__invalid_tool_json:true}}};
  if(config.protocol==='claude'){const raw=value.content;if(!Array.isArray(raw))throw Error('invalid');return {raw,text:raw.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('\n'),calls:raw.filter((x:any)=>x.type==='tool_use').map((x:any)=>({id:x.id,name:x.name,arguments:x.input}))};}
  if(config.protocol==='gemini'){const raw=value.candidates?.[0]?.content;if(!raw?.parts)throw Error('invalid');return {raw,text:raw.parts.filter((x:any)=>x.text&&!x.thought).map((x:any)=>x.text).join('\n'),calls:raw.parts.filter((x:any)=>x.functionCall).map((x:any,i:number)=>({id:x.functionCall.id||String(i),name:x.functionCall.name,arguments:x.functionCall.args||{}}))};}
  if(config.protocol==='responses'){const raw=value.output;if(!Array.isArray(raw))throw Error('invalid');return {raw,text:raw.flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('\n'),calls:raw.filter((x:any)=>x.type==='function_call').map((x:any)=>({id:x.call_id,name:x.name,arguments:parse(x.arguments,x,'arguments')}))};}
  const raw=value.choices?.[0]?.message;if(!raw)throw Error('invalid');return {raw,text:raw.content||'',calls:(raw.tool_calls||[]).map((x:any)=>({id:x.id,name:x.function.name,arguments:parse(x.function.arguments,x.function,'arguments')}))};
}
export function appendResults(config:AIConfig,messages:any[],raw:any,calls:ToolCall[],results:any[]){
  if(config.protocol==='claude')messages.push({role:'assistant',content:raw},{role:'user',content:calls.map((c,i)=>({type:'tool_result',tool_use_id:c.id,content:JSON.stringify(results[i])}))});
  else if(config.protocol==='gemini')messages.push(raw,{role:'user',parts:calls.map((c,i)=>({functionResponse:{name:c.name,...(raw.parts.find((x:any)=>x.functionCall?.id===c.id)?{id:c.id}:{}),response:{result:results[i]}}}))});
  else if(config.protocol==='responses')messages.push(...raw,...calls.map((c,i)=>({type:'function_call_output',call_id:c.id,output:JSON.stringify(results[i])})));
  else messages.push(raw,...calls.map((c,i)=>({role:'tool',tool_call_id:c.id,content:JSON.stringify(results[i])})));
}
export async function callProvider(config:AIConfig,system:string,messages:any[],tools:any[],toolName?:string){
  const r=providerRequest(config,system,messages,tools,toolName);
  const bytes=await boundedModelRequest(r.url,r.headers,r.body,config.timeout_seconds*1000);
  try{return parseProvider(config,JSON.parse(bytes));}catch{throw Error('模型响应或工具参数格式不兼容，请检查协议及模型工具能力');}
}
const warming=new Map<string,Promise<void>>();
export async function ensureProviderReady(config:AIConfig,request=boundedModelRequest) {
  if(config.provider!=='ollama')return;
  const cold=aiTiming(config).cold;
  const base=config.base_url.replace(/\/$/,'');
  if(!base.endsWith('/v1'))throw Error('Ollama冷启动需要以/v1结尾的接口地址');
  const key=base+'\n'+config.model+'\n'+cold;
  const existing=warming.get(key);if(existing)return existing;
  const pending=(async()=>{
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(config.api_key)headers.Authorization='Bearer '+config.api_key;
    const result=JSON.parse(await request(base.slice(0,-3)+'/api/generate',headers,
      {model:config.model,prompt:'',stream:false,keep_alive:'10m'},cold*1000));
    if(result.error||result.done!==true)throw Error('本地模型预热失败：'+(result.error||'模型未报告就绪'));
  })();
  warming.set(key,pending);
  try{await pending;}catch(e){throw Error('本地模型预热失败，请确认Ollama已启动、模型目录可访问及地址正确：'+(e as Error).message);}finally{if(warming.get(key)===pending)warming.delete(key);}
}
