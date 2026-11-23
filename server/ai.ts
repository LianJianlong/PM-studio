import {readBusinessTool} from './ai-business-read.ts';
import {documentDraftBody,draftDocument} from './document-ai.ts';
import {customBusinessRules} from './custom-business-rules.ts';
import {readAIEvidence} from './ai-evidence.ts';
import {businessContext} from './ai-ontology.ts';
import {createHash} from 'node:crypto';import {operationOutcome} from '../shared/ai-operation-outcome.ts';
import {normalizeGeminiModel,resolveAIConfigKey} from '../shared/ai-config.ts';
import {planningMentionCatalog,readPlanningDataset} from './ai-planning-datasets.ts';
import {runDataWorkbench} from './ai-data-workbench.ts';
import {compactAIHistory,hasWriteIntent} from '../shared/ai-context.ts';
import {businessObjectCatalog,globalBusinessCatalog} from './ai-business-objects.ts';
import {tableTool} from './ai-table-tools.ts';
import {aiPlanningBindings} from './ai-planning-context.ts';
import {isDeepStrictEqual} from 'node:util';
import {authorizedMentionContext} from './ai-mentions.ts';
import {agentCapabilities,dispatchAgent,prepareAgentPlan,runAgentPlan,type AgentTaskContext} from './ai-agent-runtime.ts';
import {agentPlan} from '../shared/ai-agent-plan.ts';
import {AI_WRITE_BYTES,AI_TOOL_CALL_LIMIT,AI_ROUND_LIMIT} from '../shared/batch-limits.ts';
import {normalizeAIRecordWrite} from '../shared/ai-record-write.ts';
import {validateAIRecordWrite} from './ai-record-validation.ts';
import {aiTiming} from "../shared/ai-timing.ts";
import {aiCatalogSections,aiFieldTypeHelp} from '../shared/ai-data-catalog.ts';
import {dataCatalog,externalDatabaseTool} from './ai-data-tools.ts';
import {Router} from 'express';
import type {Request} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {pool,tx,audit,uid} from './db.ts';
import {access,workspaceOwner,workspaceMember,requireThat,HttpError,tableAccess,visibleColumns} from './auth.ts';
import {requestBudget} from './request-budget.ts';
import {encrypt,decrypt} from './security.ts';
import {aiProviders,aiTools,safeBusinessPath,normalizeBusinessPath,type AIConfig} from '../shared/ai.ts';
import {callProvider,initialMessages,appendResults,ensureProviderReady} from './ai-provider.ts';
import {validateEndpoint} from './outbound.ts';
import {operationReceipt} from './ai-atomic.ts';import {authorizationStamp,changeView,canInspectChange} from './ai-permissions.ts';
export const ai=Router();
ai.use(customBusinessRules);
ai.post('/projects/:project/ai/closure',requestBudget(6,1),async(req,res)=>{const project=z.uuid().parse(req.params.project),b=z.object({table_id:z.uuid(),record_id:z.uuid()}).strict().parse(req.body);const result=await businessContext(req,project,{mode:'closure',...b}),a=await access(req.user.id,project);await audit(pool,a.workspace_id,req.user.id,'AI业务闭环只读分析',project,{...b,coverage:result.coverage});res.json(result)});
ai.post('/projects/:project/ai/checks',async(req,res)=>{const project=z.uuid().parse(req.params.project),b=z.object({table_id:z.uuid(),record_id:z.uuid().optional(),page:z.number().int().min(1).max(10000).default(1)}).strict().parse(req.body);const result=await businessContext(req,project,{mode:'check',...b});const a=await access(req.user.id,project);await audit(pool,a.workspace_id,req.user.id,'AI业务规则只读检查',project,{table:b.table_id,page:b.page});res.json(result);});
ai.get('/projects/:project/ai/evidence/:table/:record',async(req,res)=>res.json(await readAIEvidence(req,z.uuid().parse(req.params.project),z.uuid().parse(req.params.table),z.uuid().parse(req.params.record))));
ai.get('/projects/:project/ai/planning-catalog',async(req,res)=>res.json(await planningMentionCatalog(req,z.uuid().parse(req.params.project))));
ai.get('/projects/:project/ai/planning-datasets/:dataset',async(req,res)=>res.json(await readPlanningDataset(req,z.uuid().parse(req.params.project),String(req.params.dataset))));
const provider=z.enum(['openai','claude','gemini','deepseek','glm','minimax','ollama','compatible']);
const config=z.object({provider,protocol:z.enum(['responses','chat','claude','gemini']),base_url:z.string().url().max(500).refine(v=>{const u=new URL(v);const local=['localhost','host.docker.internal','[::1]'].includes(u.hostname)||/^(127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname);return (u.protocol==='https:'||u.protocol==='http:'&&local)&&!u.username&&!u.password&&!u.search&&!u.hash;},'远程模型必须使用HTTPS；HTTP仅允许本机或局域网地址，不能含密码、查询参数或片段'),model:z.string().trim().min(1).max(150),api_key:z.string().max(2000).optional(),clear_key:z.boolean().optional(),enabled:z.boolean(),max_tokens:z.number().int().min(256).max(16384),timeout_seconds:z.number().int().min(5).max(1800),version:z.number().int().min(0),thinking:z.boolean().optional(),cold_start_seconds:z.number().int().min(5).max(3600).optional()}).refine(c=>c.provider==='ollama'||c.timeout_seconds<=120,{message:'非Ollama服务单次模型超时最多120秒',path:['timeout_seconds']});
async function workspaceAccess(user:string,workspace:string){
  requireThat(await workspaceMember(user,workspace));
  const r=await pool.query(`SELECT 1 FROM workspaces WHERE id=$1 AND lifecycle='active'`,[workspace]);
  requireThat(r.rowCount);
}
async function getConfig(workspace:string,p:string){const r=(await pool.query('SELECT * FROM ai_configs WHERE workspace_id=$1 AND provider=$2',[workspace,p])).rows[0];return r?{...r,config:decrypt(r.config_cipher) as AIConfig}:null;}
ai.get('/workspaces/:workspace/ai-configs',async(req,res)=>{
  const workspace=z.uuid().parse(req.params.workspace);await workspaceAccess(req.user.id,workspace);
  const owner=await workspaceOwner(req.user.id,workspace),rows=(await pool.query('SELECT * FROM ai_configs WHERE workspace_id=$1 ORDER BY provider',[workspace])).rows;
  res.json({can_manage:owner,providers:aiProviders,configs:rows.map(r=>{const c=decrypt(r.config_cipher);return owner?{provider:r.provider,protocol:c.protocol,base_url:c.base_url,model:c.model,enabled:c.enabled,max_tokens:c.max_tokens,timeout_seconds:c.timeout_seconds,thinking:c.thinking,cold_start_seconds:c.cold_start_seconds,version:r.version,has_key:!!c.api_key}:{provider:r.provider,model:c.model,enabled:c.enabled};})});
});
ai.put('/workspaces/:workspace/ai-configs',async(req,res)=>{
  const workspace=z.uuid().parse(req.params.workspace);requireThat(await workspaceOwner(req.user.id,workspace));await workspaceAccess(req.user.id,workspace);const body=config.parse(req.body);validateEndpoint(body.base_url,'ai');
  await tx(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[workspace+':ai:'+body.provider]);const row=(await c.query('SELECT * FROM ai_configs WHERE workspace_id=$1 AND provider=$2 FOR UPDATE',[workspace,body.provider])).rows[0];requireThat((row?.version||0)===body.version,409,'配置已更新，请刷新后重试');
    const old=row?decrypt(row.config_cipher):null;
    requireThat(!old?.api_key||old.base_url===body.base_url||!!body.api_key||body.clear_key,400,'修改服务地址时必须重新输入或清除密钥');
    const {key,enabled}=resolveAIConfigKey(old?.api_key,body.api_key,body.clear_key,body.enabled,body.provider==='ollama');
    requireThat(!enabled||body.provider==='ollama'||!!key,400,'启用此服务前请输入API Key');
    const saved={provider:body.provider,protocol:body.protocol,base_url:body.base_url.replace(/\/$/,''),model:body.protocol==='gemini'?normalizeGeminiModel(body.model):body.model,api_key:key,enabled,max_tokens:body.max_tokens,timeout_seconds:body.timeout_seconds,cold_start_seconds:body.cold_start_seconds??old?.cold_start_seconds??(body.provider==='ollama'?1800:undefined),...(body.provider==='ollama'&&typeof (body.thinking??old?.thinking)==='boolean'?{thinking:body.thinking??old?.thinking}:{})};
    await c.query('INSERT INTO ai_configs(workspace_id,provider,config_cipher) VALUES($1,$2,$3) ON CONFLICT(workspace_id,provider) DO UPDATE SET config_cipher=$3,version=ai_configs.version+1,updated_at=now()',[workspace,body.provider,encrypt(saved)]);
    await audit(c,workspace,req.user.id,'配置AI模型服务',workspace,{provider:body.provider,enabled});
  });res.json({ok:true});
});
const limit=()=>rateLimit({windowMs:60_000,limit:20,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'AI请求过多，请稍后再试'}});
ai.post('/workspaces/:workspace/ai-configs/:provider/test',limit(),async(req,res)=>{
  const workspace=z.uuid().parse(req.params.workspace);requireThat(await workspaceOwner(req.user.id,workspace));const row=await getConfig(workspace,provider.parse(req.params.provider));requireThat(row,404,'请先保存配置');
  requireThat(row.config.provider==='ollama'||!!row.config.api_key,400,'此服务尚未保存API Key，请点击编辑填写密钥并保存后再测试；启用后才可在聊天中使用');
  try{await ensureProviderReady(row.config);const r=await callProvider(row.config,'仅回复连接成功。',initialMessages(row.config,'连接测试'),[]);res.json({ok:true,message:r.text||'连接成功（服务已返回响应）'});}catch(e){throw new HttpError(502,(e as Error).message);}
});
const toolInput=z.object({method:z.enum(['GET','POST','PUT','PATCH','DELETE']),path:z.string().max(1500),body:z.record(z.string(),z.unknown()).optional().refine(v=>Buffer.byteLength(JSON.stringify(v||{}))<=AI_WRITE_BYTES,'AI操作内容超过1MiB，请分批操作')}).strict();
export async function executeAITool(req:Request,project:string,name:string,args:any,allowWrite:boolean,confirmed=false,changeId?:string,task?:AgentTaskContext){
  const a=await access(req.user.id,project);
  requireThat(!args?.__invalid_tool_json,400,'工具参数JSON不完整或不合法，请自行缩小单批内容并重新提交完整JSON');
  if(name==='business_context'||name==='business_action_catalog')return readBusinessTool(req,project,name,args);
  if(name==='table_records'||name==='table_schema')return tableTool(req,project,name,args,allowWrite,task);
  if(name==='capability_catalog')return agentCapabilities();
  if(name==='business_object_catalog'){const options=z.object({scope:z.enum(['project','global']).default('project'),workspace_id:z.uuid().optional(),project_id:z.uuid().optional(),search:z.string().trim().max(120).optional(),page:z.number().int().min(1).max(100000).optional()}).strict().parse(args);return options.scope==='global'?globalBusinessCatalog(req,options):businessObjectCatalog(req,project);}
  if(name==='prepare_plan')return prepareAgentPlan(req,project,args,allowWrite,task);
  if(name==='read_many'){const b=z.object({requests:z.array(z.object({path:z.string().max(1500)}).strict()).min(1).max(16)}).strict().parse(args);const results:any[]=[];for(let i=0;i<b.requests.length;i+=4)results.push(...await Promise.all(b.requests.slice(i,i+4).map(async r=>{try{const result=await dispatchAgent(req,{method:'GET',path:r.path});await audit(pool,a.workspace_id,req.user.id,'AI并发业务查询',project,{path:r.path.split('?')[0]});const data=Buffer.byteLength(JSON.stringify(result.data))<=80000?result.data:{truncated:true,message:'返回过多，请分页或缩小范围'};return {path:r.path,ok:true,status:result.status,data}}catch(e){return {path:r.path,ok:false,error:(e as Error).message}}})));return {results};}
  if(name==='api_catalog'){const topicAliases:Record<string,string>={departments:'permissions',organization:'permissions',members:'permissions',roles:'permissions',wbs:'planning',tasks:'planning',calendars:'calendar',documents:'files',modules:'agent'};const normalizedArgs=args&&typeof args==='object'?{...args,topic:topicAliases[args.topic]||args.topic}:args;const b=z.object({topic:z.enum(['overview','tables','fields','records','views','reports','planning','external_sql','files','approvals','permissions','calendar','resources','agent']).default('overview')}).strict().parse(normalizedArgs);return {project,project_name:a.name,workspace:a.workspace_id,topics:Object.keys(aiCatalogSections),catalog:aiCatalogSections[b.topic],...(b.topic==='fields'?{field_types:aiFieldTypeHelp}:{})};}
  if(name==='data_catalog')return dataCatalog(req,project,args);
  if(name==='database_connections'||name==='database_query')return externalDatabaseTool(req,a.workspace_id,name,args);
  requireThat(name==='business_api',400,'未知工具');const input=toolInput.parse(args),body=confirmed?{...input,path:normalizeBusinessPath(input.path)}:normalizeAIRecordWrite({...input,path:normalizeBusinessPath(input.path)});
  if(task&&body.method!=='GET'&&!confirmed){
   const operations=task.plan?.operations||[];
   const duplicate=operations.find(o=>o.method===body.method&&o.path===body.path&&isDeepStrictEqual(o.body||{},body.body||{}));
   if(duplicate)return {ok:true,staged:true,message:'相同操作已在最终方案中，不重复添加',step:duplicate.key};
   let key=`step_${operations.length+1}`;while(operations.some(o=>o.key===key))key+='_';
   const result=await prepareAgentPlan(req,project,{summary:task.plan?.summary||'本轮业务数据操作',operations:[...operations,{key,method:body.method,path:body.path,body:body.body||{}}]},allowWrite,task);
   return {...result,step:key,result_reference:`$steps.${key}.id`};
  }
  requireThat(safeBusinessPath(body.path),400,'此路径不属于AI业务接口范围');requireThat(body.method==='GET'||allowWrite,403,'本轮未开启数据修改');
  if(body.method!=='GET'&&!confirmed){await validateAIRecordWrite(req.user.id,body);requireThat(await canInspectChange(req.user.id,{project_id:project,path:body.path,method:body.method,body:body.body||{},auth_stamp:await authorizationStamp(req.user.id)}),403,'当前账号无权操作目标对象');const key=uid();await tx(async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtext($1),330)',[req.user.id]);await c.query("DELETE FROM ai_changes WHERE user_id=$1 AND ((expires_at<now() AND status IN ('pending','cancelled')) OR (created_at<now()-interval '7 days' AND status IN ('done','failed')))",[req.user.id]);const count=Number((await c.query("SELECT count(*) FROM ai_changes WHERE user_id=$1 AND status='pending'",[req.user.id])).rows[0].count);requireThat(count<100,429,'待确认操作过多，请先确认或取消');await c.query("INSERT INTO ai_changes(id,project_id,user_id,method,path,body,execution_version,auth_stamp) VALUES($1,$2,$3,$4,$5,$6,1,$7)",[key,project,req.user.id,body.method,body.path,body.body||{},await authorizationStamp(req.user.id,c)]);await audit(c,a.workspace_id,req.user.id,'AI生成待确认操作',key,{method:body.method,path:body.path});});return {ok:true,status:202,pending:true,change:{id:key,method:body.method,path:body.path,body:body.body||{},expires_in_seconds:600},data:{message:'仅生成待确认操作，尚未执行。需用户逐笔确认。'}};}
  requireThat(body.method==='GET'||!!changeId,400,'写入必须携带已确认的持久操作ID');
  let response:Response;
  try{response=await fetch(`http://127.0.0.1:${process.env.PORT||9090}/api${body.path}`,{method:body.method,headers:{cookie:`studio_session=${req.cookies.studio_session}`,'Content-Type':'application/json',...(changeId?{'X-Studio-AI-Operation':changeId}:{})},body:body.method==='GET'?undefined:JSON.stringify(body.body||{}),redirect:'error',signal:AbortSignal.timeout(body.method==='GET'?20000:120000)});
  requireThat(response.headers.get('content-type')?.includes('application/json'),400,'AI工具仅接收JSON业务数据');
  const text=await response.text();const parsed=text.length<=80000?JSON.parse(text):{truncated:true,message:'返回数据过多，请缩小查询范围或分页'};const data=Array.isArray(parsed)&&/^\/projects\/[a-f0-9-]{36}\/tables(?:\?|$)/.test(body.path)?parsed.map(t=>({id:t.id,name:t.name,project_id:t.project_id,department_id:t.department_id,object_version:t.object_version,column_count:t.columns?.length,planning_kind:t.planning_kind||null,field_help:'data_catalog(table_id)读取完整字段'})):parsed;
  await audit(pool,a.workspace_id,req.user.id,'AI业务接口调用',project,{method:body.method,path:body.path.split('?')[0],status:response.status});
  if(changeId){const receipt=await operationReceipt(changeId,req.user.id);if(receipt)return receipt;}
  return {ok:response.ok,status:response.status,data,...(data.unknown?{unknown:true}:{})};
  }catch(error){if(changeId){const receipt=await operationReceipt(changeId,req.user.id);if(receipt)return receipt;return {ok:false,status:503,unknown:true,error:'执行结果待核实，请查询原操作，不要重复新建'};}throw error;}
}
ai.post('/projects/:project/ai/tool',limit(),async(req,res)=>{
  const project=z.uuid().parse(req.params.project),b=z.object({name:z.enum(['business_context','business_object_catalog','business_action_catalog','table_records','table_schema','business_api','api_catalog','data_catalog','database_connections','database_query','capability_catalog','read_many','prepare_plan']),arguments:z.record(z.string(),z.unknown()),allow_write:z.boolean().default(false)}).parse(req.body);
  res.json(await executeAITool(req,project,b.name,b.arguments,b.allow_write));
});
ai.post('/projects/:project/ai/changes/:change/preview',limit(),async(req,res)=>{
 const project=z.uuid().parse(req.params.project),id=z.uuid().parse(req.params.change);
 const row=(await pool.query('SELECT * FROM ai_changes WHERE id=$1 AND project_id=$2 AND user_id=$3',[id,project,req.user.id])).rows[0];
 requireThat(row,404,'操作不存在');requireThat(row.status==='pending'&&new Date(row.expires_at)>new Date(),409,'方案已执行或已过期，请重新生成');requireThat(await canInspectChange(req.user.id,row),403,'权限已变化，请重新生成方案');
 requireThat(!await operationReceipt(id,req.user.id),409,'操作已有执行回执，请刷新核实结果');
 const plan=row.path===`/projects/${project}/agent-plan`?agentPlan.parse(row.body):agentPlan.parse({summary:'AI数据操作',operations:[{key:'operation',method:row.method,path:row.path,body:row.body}]});
 const preview=await runAgentPlan(req,project,plan,undefined,true);requireThat(preview.ok,preview.status,preview.error||'预演失败，请重新生成方案');
 const labels:Record<string,string>={data:'数据',id:'编号',version:'版本',rows:'记录',records:'记录',count:'数量',name:'名称',columns:'字段',table:'数据表',replayed:'重复请求',type:'类型',title:'标题',created_at:'创建时间',updated_at:'更新时间'};
 Object.assign(labels,(preview as any).data.labels);
 requireThat(await canInspectChange(req.user.id,row),403,'预演期间权限已变化');
 const prepared=(preview as any).prepared_plan;const frozen=row.path===`/projects/${project}/agent-plan`?prepared:prepared.operations[0].body||{};
 const digest=createHash('sha256').update(JSON.stringify({method:row.method,path:row.path,body:frozen,action_policy_stamp:(preview as any).data.action_policy_stamp})).digest('hex');
 const saved=await pool.query("UPDATE ai_changes SET body=$2,preview_digest=$3,preview_auth_stamp=$4,action_policy_stamp=$6,preview_at=now() WHERE id=$1 AND status='pending' AND body=$5::jsonb RETURNING id",[id,JSON.stringify(frozen),digest,await authorizationStamp(req.user.id),JSON.stringify(row.body),(preview as any).data.action_policy_stamp]);requireThat(saved.rowCount,409,'方案在预览期间已变化，请重新预览');
 res.json({data:(preview as any).data,operations:prepared.operations,labels,preview_digest:digest,summary:{steps:prepared.operations.length,changed_records:[...new Set(((preview as any).data.changes||[]).flatMap((c:any)=>[...(c.before||[]),...(c.after||[])].map((r:any)=>r.id)))].length,atomic:true}});
});
ai.get('/projects/:project/ai/changes',async(req,res)=>{const project=z.uuid().parse(req.params.project);await access(req.user.id,project);const rows=(await pool.query("SELECT * FROM ai_changes WHERE project_id=$1 AND user_id=$2 AND (created_at>now()-interval '1 day' OR status IN ('executing','unknown')) ORDER BY created_at DESC LIMIT 100",[project,req.user.id])).rows;res.json(await Promise.all(rows.map(row=>changeView(req.user.id,row))));});
ai.post('/projects/:project/ai/changes/:change/confirm',limit(),async(req,res)=>{
 const project=z.uuid().parse(req.params.project),change=z.uuid().parse(req.params.change);const confirmation=z.object({confirm:z.literal(true),preview_digest:z.string().length(64)}).strict().parse(req.body);const a=await access(req.user.id,project);
 const current=(await pool.query('SELECT * FROM ai_changes WHERE id=$1 AND project_id=$2 AND user_id=$3',[change,project,req.user.id])).rows[0];requireThat(current,409,'操作不存在');requireThat(await canInspectChange(req.user.id,current),403,'权限已变化，请重新生成操作');requireThat(current.preview_digest===confirmation.preview_digest&&current.preview_auth_stamp===await authorizationStamp(req.user.id),409,'缺少匹配的结果预览或权限已变化，请重新预览');requireThat(current.status==='pending'||current.execution_version===1&&['executing','unknown'].includes(current.status),409,'操作已处理或旧版本结果需人工核实');
 const row=(await pool.query("UPDATE ai_changes SET status='executing',execution_version=1 WHERE id=$1 AND project_id=$2 AND user_id=$3 AND status IN ('pending','executing','unknown') AND expires_at>now() AND preview_digest=$4 AND preview_auth_stamp=$5 RETURNING *",[change,project,req.user.id,confirmation.preview_digest,await authorizationStamp(req.user.id)])).rows[0];requireThat(row,409,'操作已确认、已过期或不存在，请勿重复提交');
 let result:any;try{result=row.path===`/projects/${project}/agent-plan`?await runAgentPlan(req,project,agentPlan.parse(row.body),row.id):await executeAITool(req,project,'business_api',{method:row.method,path:row.path,body:row.body},true,true,row.id);}catch(e){result={ok:false,status:e instanceof HttpError?e.status:400,error:(e as Error).message};}
 await pool.query("UPDATE ai_changes SET status=$2,result=$3 WHERE id=$1 AND status<>'done'",[change,result.unknown?'unknown':result.ok?'done':'failed',result]);const completed=await operationReceipt(change,req.user.id);if(completed)result=completed;await pool.query('UPDATE ai_data_runs SET status=$2,updated_at=now() WHERE change_id=$1',[change,result.ok?'written':result.unknown?'review':'failed']).catch(()=>{});await audit(pool,a.workspace_id,req.user.id,'AI确认操作结果',change,{status:result.status,ok:result.ok,unknown:!!result.unknown});res.json(result);
});
ai.post('/projects/:project/ai/changes/:change/reconcile',async(req,res)=>{const project=z.uuid().parse(req.params.project);await access(req.user.id,project);const row=(await pool.query('SELECT * FROM ai_changes WHERE id=$1 AND project_id=$2 AND user_id=$3',[z.uuid().parse(req.params.change),project,req.user.id])).rows[0];requireThat(row,404,'操作不存在');const receipt=await operationReceipt(row.id,req.user.id);if(receipt){row.status='done';row.result=receipt;await pool.query("UPDATE ai_changes SET status='done',result=$2 WHERE id=$1",[row.id,receipt]);await pool.query("UPDATE ai_data_runs SET status='written',updated_at=now() WHERE change_id=$1",[row.id]);}const safe=await changeView(req.user.id,row);res.json({...safe,outcome:operationOutcome(row,receipt)});});
ai.post('/projects/:project/ai/changes/:change/cancel',async(req,res)=>{const project=z.uuid().parse(req.params.project);await access(req.user.id,project);const r=await pool.query("UPDATE ai_changes SET status='cancelled' WHERE id=$1 AND project_id=$2 AND user_id=$3 AND status='pending' RETURNING id",[z.uuid().parse(req.params.change),project,req.user.id]);requireThat(r.rowCount,409,'操作已处理或不存在');res.json({ok:true});});
ai.use('/projects/:project/ai/chat',requestBudget(16,2));
ai.get('/projects/:project/ai/business-objects',async(req,res)=>{const project=z.uuid().parse(req.params.project);await access(req.user.id,project);const options=z.object({scope:z.enum(['project','global']).default('project'),workspace_id:z.uuid().optional(),project_id:z.uuid().optional(),search:z.string().trim().max(120).optional(),page:z.coerce.number().int().min(1).max(100000).optional()}).strict().parse(req.query);res.json(options.scope==='global'?await globalBusinessCatalog(req,options):await businessObjectCatalog(req,project))});
ai.post('/projects/:project/ai/document-draft',limit(),async(req,res)=>{const project=z.uuid().parse(req.params.project),b=documentDraftBody.parse(req.body),a=await access(req.user.id,project);const config=await getConfig(a.workspace_id,b.provider);requireThat(config?.config.enabled,409,'管理员尚未启用此模型服务');const searchConfig=b.web_search?await getConfig(a.workspace_id,'gemini'):null;const draft=await draftDocument(req,project,b,config.config,searchConfig?.config);await audit(pool,a.workspace_id,req.user.id,'document.ai.preview',project,{provider:b.provider,operation:b.operation,source:b.table_id||null,web_search:b.web_search,read_steps:draft.evidence.length});res.json(draft)});
ai.post('/projects/:project/ai/chat',limit(),async(req,res)=>{
 const project=z.uuid().parse(req.params.project),permission=await access(req.user.id,project);
 const body=z.object({provider,prompt:z.string().trim().min(1).max(12000),allow_write:z.boolean().default(false),web_search:z.boolean().default(false),web_query:z.string().trim().max(180).default(''),history:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(6000)}).strict()).max(8).default([])}).strict().parse(req.body);
 const config=await getConfig(permission.workspace_id,body.provider);requireThat(config?.config.enabled,409,'管理员尚未启用此模型服务');
 if(body.web_search){requireThat(!body.allow_write,400,'\u8054\u7f51\u67e5\u8be2\u8bf7\u5148\u5173\u95ed\u672c\u8f6e\u4e1a\u52a1\u6570\u636e\u589e\u5220\u6539');const searchConfig=await getConfig(permission.workspace_id,'gemini');const result=await draftDocument(req,project,{provider:body.provider,prompt:body.prompt,operation:'question',current_text:body.history.map(m=>m.role+': '+m.text).join('\n').slice(-18000),web_search:true},config.config,searchConfig?.config);await audit(pool,permission.workspace_id,req.user.id,'ai.web.query',project,{provider:body.provider,sources:result.web?.sources.length||0});res.json({outcome:'answer',answer:result.content,web:result.web,evidence:result.evidence,visualizations:result.visualizations,rule_reports:result.rule_reports,closure_reports:result.closure_reports,trace:[],stages:[]});return;}
 res.json(await runDataWorkbench(req,project,body,config.config));
});
ai.get('/projects/:project/ai/runs',async(req,res)=>{
 const project=z.uuid().parse(req.params.project);await access(req.user.id,project);const stamp=await authorizationStamp(req.user.id);
 const rows=(await pool.query(`SELECT r.id,r.status,r.summary,r.auth_stamp,r.change_id,r.stages,r.created_at,c.status AS change_status,c.expires_at,c.result AS operation_result,c.body AS operation_body FROM ai_data_runs r LEFT JOIN ai_changes c ON c.id=r.change_id WHERE r.user_id=$1 AND r.project_id=$2 ORDER BY r.created_at DESC LIMIT 20`,[req.user.id,project])).rows;
 res.json(rows.map(r=>({id:r.id,status:r.change_status==='pending'&&new Date(r.expires_at)<new Date()?'expired':r.change_status==='done'?'written':r.change_status==='cancelled'?'cancelled':r.change_status==='failed'?'failed':['unknown','executing'].includes(r.change_status)?'unknown':r.status,summary:r.auth_stamp===stamp?r.summary:'权限已变化，内容已隐藏',change_id:r.change_id,stages:r.auth_stamp===stamp?r.stages:[],detail:r.auth_stamp===stamp&&r.operation_result?{rolled_back:!!r.operation_result.rolled_back,unknown:!!r.operation_result.unknown,message:r.operation_result.error||r.operation_result.data?.error||'',failed_step:r.operation_result.failed_step?Math.max(0,(r.operation_body?.operations||[]).findIndex((o:any)=>o.key===r.operation_result.failed_step))+1:null,completed_steps:r.operation_result.ok?(r.operation_result.data?.steps?.length||1):0}:null,created_at:r.created_at})));
});
