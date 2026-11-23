import {beginActionControl,checkActionEvents,ActionConditionError} from './business-actions.ts';
import {planningFieldLabels} from '../shared/ai-planning-datasets.ts';
import {ambiguousPlanningName} from '../shared/planning-table-identity.ts';
import type {Request} from 'express';
import {EventEmitter} from 'node:events';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {pool,requestTransaction,audit,uid} from './db.ts';
import {access,authenticate,HttpError,requireThat,tableAccess,rowAllowed,visibleColumns} from './auth.ts';
import {authorizationStamp} from './ai-permissions.ts';
import {safeBusinessPath,normalizeBusinessPath} from '../shared/ai.ts';
import {normalizeAIRecordWrite} from '../shared/ai-record-write.ts';
import {agentPlan,parseAgentPlan,resolveAgentRefs,type AgentPlan} from '../shared/ai-agent-plan.ts';
type Route={method:string;path:string;route:any;regex:RegExp;names:string[]};
const routes:Route[]=[];
export function registerAgentRoutes(routers:any[]){
 routes.length=0;for(const router of routers)for(const layer of router.stack||[]){if(!layer.route||typeof layer.route.path!=='string')continue;const path=layer.route.path,names:string[]=[];const regex=new RegExp('^'+path.split('/').map((s:string)=>{if(s.startsWith(':')){names.push(s.slice(1));return '([^/]+)'}return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}).join('/')+'$');
 for(const method of Object.keys(layer.route.methods))routes.push({method:method.toUpperCase(),path,route:layer.route,regex,names});}
}
export function agentCapabilities(){return {mode:'permission_scoped_transactional_agent',tools:['business_context','table_records','table_schema','capability_catalog','business_api','read_many','prepare_plan'],workflow:'发现对象→读取字段/版本→受控并发查询→prepare_plan真实业务预演→自动修正→一次整体确认→原子提交',limits:{plan_steps:96,parallel_reads:4,create:5000,update:1000,delete:1000,plan_bytes:1048576},references:'使用 $steps.步骤key.id 或 $steps.步骤key.record_id 引用之前步骤的JSON结果；对象/数组值可整项引用。预演创建的UUID会回滚，后续只能用步骤引用，不能复制预演UUID。',routes:routes.filter(r=>safeBusinessPath(r.path.replace(/:[a-zA-Z_]+/g,'00000000-0000-4000-8000-000000000000'))).map(r=>({method:r.method,path:r.path}))};}
async function hydrateVersion(req:Request,op:any){
 const single=op.method==='PUT'&&/^\/records\/([a-f0-9-]{36})$/i.exec(op.path);
 const batch=op.method==='POST'&&/^\/tables\/[a-f0-9-]{36}\/records\/batch-(update|delete)$/i.test(op.path);
 const values=single?[{id:single[1],...op.body}]:batch?op.body?.records:[];
 if(!Array.isArray(values))return op;
 for(const v of values){if(v.version!==undefined)continue;const r=(await pool.query('SELECT * FROM records WHERE id=$1',[v.id])).rows[0];requireThat(r,404,'记录不存在');const t=await tableAccess(req.user.id,r.table_id);requireThat(rowAllowed(t.permission,r,req.user.id));v.version=r.version;}
 if(single)op.body={...op.body,version:values[0].version};return op;
}
export async function dispatchAgent(req:Request,operation:any){
 await authenticate(req,{} as any,()=>{});
 const op=await hydrateVersion(req,normalizeAIRecordWrite({...operation,path:normalizeBusinessPath(operation.path)}));
 requireThat(safeBusinessPath(op.path),403,'此接口不属于Agent业务范围');const url=new URL(op.path,'http://local');const route=routes.find(r=>r.method===op.method&&r.regex.test(url.pathname));requireThat(route,400,'此接口未接入Agent；使用capability_catalog发现真实接口');
 const match=route.regex.exec(url.pathname)!;const sub=Object.create(req);Object.defineProperties(sub,{params:{value:Object.fromEntries(route.names.map((n,i)=>[n,match[i+1]]))},query:{value:Object.fromEntries(url.searchParams)},body:{value:op.body||{}},method:{value:op.method},url:{value:'/api'+op.path},originalUrl:{value:'/api'+op.path}});
 let status=200,data:any,responded=false;const response:any=new EventEmitter();response.statusCode=200;response.locals={};response.status=(n:number)=>{status=n;response.statusCode=n;return response};response.json=(v:any)=>{data=JSON.parse(JSON.stringify(v));responded=true;return response};response.set=response.header=response.type=response.setHeader=()=>response;response.getHeader=()=>undefined;
 response.send=response.end=response.redirect=response.download=response.sendFile=()=>{throw new HttpError(415,'Agent仅支持JSON业务操作，文件内容/下载不在事务方案中')};
 for(const handler of route.route.stack){let next=false;await handler.handle(sub,response,(error?:any)=>{if(error)throw error;next=true});if(responded||!next)break;}
 requireThat(responded,500,'业务接口未返回JSON结果');status=response.statusCode;requireThat(status<400,status,data?.error||'业务校验失败');requireThat(Buffer.byteLength(JSON.stringify(data))<=2_000_000,400,'单步结果超过2MB，请分页读取');return {status,data,operation:op};
}
export async function runAgentPlan(req:Request,project:string,plan:AgentPlan,change?:string,capturePreview=false){
 const client=await pool.connect();const outputs:Record<string,any>={},trace:any[]=[],changes:any[]=[],labels:Record<string,string>={},destinations=new Map<string,any>();const recordLabels:Record<string,string>={};const prepared:any[]=[],deadline=Date.now()+120000;let index=0,committing=false,previewBytes=0;let expectedPolicy:string|null|undefined;const actionChecks:any[]=[];
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.actor_id',$1,true)",[req.user.id]);
  if(change){const row=(await client.query('SELECT * FROM ai_changes WHERE id=$1 AND user_id=$2 FOR UPDATE',[change,req.user.id])).rows[0];requireThat(row&&row.project_id===project&&row.path===`/projects/${project}/agent-plan`&&isDeepStrictEqual(row.body,plan),403,'方案内容不匹配');const receipt=(await client.query('SELECT result FROM ai_operation_receipts WHERE change_id=$1 AND user_id=$2',[change,req.user.id])).rows[0];if(receipt){await client.query('ROLLBACK');return receipt.result;}
   expectedPolicy=row.action_policy_stamp;requireThat(['executing','unknown'].includes(row.status)&&new Date(row.expires_at)>new Date(),409,'方案未确认或已过期');requireThat(row.auth_stamp===await authorizationStamp(req.user.id,client),403,'用户权限已变化，请重新生成方案');
  }
  const actionPolicyStamp=await beginActionControl(req.user.id,project,client,expectedPolicy);
  await requestTransaction.run(client,async()=>{await access(req.user.id,project,client);for(const step of plan.operations){requireThat(Date.now()<deadline,408,'方案预演/执行超过120秒，请缩小单个方案');index++;const operation=resolveAgentRefs({...step,path:normalizeBusinessPath(step.path)},outputs);
   const recordTarget=/^\/records\/([a-f0-9-]{36})$/i.exec(operation.path)?.[1];
   const requestedIds=recordTarget?[recordTarget]:/\/batch-(update|delete)$/.test(operation.path)?(operation.body?.records||[]).map((r:any)=>r.id):[];
   const snapshot=async(ids:string[])=>{const rows=ids.length?(await pool.query('SELECT * FROM records WHERE id=ANY($1::uuid[])',[ids])).rows:[],result:any[]=[],meta=new Map<string,any>();
    for(const id of new Set(rows.map(r=>r.table_id)))meta.set(id,await tableAccess(req.user.id,id));const refs=new Set<string>();
    for(const r of rows){const t=meta.get(r.table_id);if(!rowAllowed(t.permission,r,req.user.id))continue;const columns=visibleColumns(t.permission,t.table),fields=new Set(columns.map((c:any)=>c.id)),data:Record<string,any>=Object.fromEntries(Object.entries(r.data||{}).filter(([k])=>fields.has(k)));recordLabels[r.id]=[data.code,data.name].filter(Boolean).join(' · ').slice(0,160)||'记录';recordLabels[t.table.id]=t.table.name;
     for(const f of columns.filter((f:any)=>f.type==='reference'))for(const id of Array.isArray(data[f.id])?data[f.id]:[])if(typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)&&!recordLabels[id]&&refs.size<5000)refs.add(id);
     previewBytes+=Buffer.byteLength(JSON.stringify(data));requireThat(previewBytes<=4_194_304,400,'差异预览超过4MiB，请缩小单次操作范围');result.push({id:r.id,table:t.table.name,data});}
    const targets=refs.size?(await pool.query('SELECT * FROM records WHERE id=ANY($1::uuid[])',[[...refs]])).rows:[];
    for(const id of new Set(targets.map(r=>r.table_id)))if(!meta.has(id)){try{meta.set(id,await tableAccess(req.user.id,id))}catch{meta.set(id,null)}}
    for(const r of targets){const t=meta.get(r.table_id);if(!t||t.table.project_id!==project||!rowAllowed(t.permission,r,req.user.id))continue;const fields=new Set(visibleColumns(t.permission,t.table).map((f:any)=>f.id));recordLabels[r.id]=[fields.has('code')?r.data.code:null,fields.has('name')?r.data.name:null].filter(Boolean).join(' · ').slice(0,160)||'关联记录';}
    return result;};
   const schemaTarget=/^\/(?:tables|objects\/tables)\/([a-f0-9-]{36})\/columns(?:\/|$)/i.exec(operation.path)?.[1];
   const tableSnapshot=async()=>{const t=await tableAccess(req.user.id,schemaTarget!);const fields=visibleColumns(t.permission,t.table);for(const c of fields)labels[c.id]=c.name||c.id;return [{name:t.table.name,columns:fields}];};
   const resourceTarget=/^\/projects\/([a-f0-9-]{36})\/resources(?:\/([a-f0-9-]{36}))?$/i.exec(operation.path);
   const resourceSnapshot=async(id?:string)=>{if(!id)return [];const data=(await dispatchAgent(req,{method:'GET',path:`/projects/${resourceTarget![1]}/resources`})).data;return data.filter((r:any)=>r.id===id&&r.active).map((r:any)=>({id:r.id,table:'资源池',data:Object.fromEntries(Object.entries(r).filter(([k])=>Object.hasOwn(planningFieldLabels,k)&&!['allocations','version','id'].includes(k)))}));};
   const allocationTarget=/^\/activities\/([a-f0-9-]{36})\/resources$/i.exec(operation.path);
   const allocationSnapshot=async()=>{const data=(await dispatchAgent(req,{method:'GET',path:`/projects/${project}/resource-load`})).data;return (data.assignments||[]).filter((r:any)=>r.activity_id===allocationTarget![1]&&r.resource_id===operation.body?.resource_id).map((r:any)=>{const allocation=data.resources?.find((resource:any)=>resource.id===r.resource_id)?.allocations?.find((a:any)=>a.id===r.id);const values={...r,...(allocation?{planned_cost:allocation.planned_cost,actual_cost:allocation.actual_cost}:{})};return {id:r.id||r.activity_id+':'+r.resource_id,table:'作业资源分配表',data:Object.fromEntries(Object.entries(values).filter(([k])=>Object.hasOwn(planningFieldLabels,k)&&!['activity_id','resource_id','id','version'].includes(k)))};});};
   if((resourceTarget||allocationTarget)&&capturePreview)Object.assign(labels,planningFieldLabels);

   const before=capturePreview&&step.method!=='GET'?(resourceTarget?await resourceSnapshot(resourceTarget[2]):allocationTarget?await allocationSnapshot():schemaTarget?await tableSnapshot():await snapshot(requestedIds)):[];
   const result=await dispatchAgent(req,operation);actionChecks.push(...await checkActionEvents(req,project));
   if(capturePreview&&step.method!=='GET'){const ids=recordTarget||requestedIds.length?requestedIds:/^\/tables\/[^/]+\/records$/.test(operation.path)&&result.data?.id?[result.data.id]:operation.path.endsWith('/import')&&Array.isArray(result.data?.ids)?result.data.ids:[];changes.push({step:step.key,before,after:resourceTarget?await resourceSnapshot(resourceTarget[2]||result.data?.id):allocationTarget?await allocationSnapshot():schemaTarget?await tableSnapshot():await snapshot(ids)});}
if(step.method!=='GET'){
    let table=/^\/tables\/([a-f0-9-]{36})(?:\/|$)/i.exec(result.operation.path)?.[1];
    const record=/^\/records\/([a-f0-9-]{36})(?:\/|$)/i.exec(result.operation.path)?.[1];
    if(!table&&record)table=(await pool.query('SELECT table_id FROM records WHERE id=$1',[record])).rows[0]?.table_id;
    if(table&&!destinations.has(table)){const t=await tableAccess(req.user.id,table);if(capturePreview)for(const c of visibleColumns(t.permission,t.table))labels[c.id]=c.name||c.id;const kind=(await pool.query('SELECT kind FROM planning_tables WHERE table_id=$1',[table])).rows[0]?.kind;destinations.set(table,{project_id:t.table.project_id,project_name:t.permission.name,table_id:table,table_name:t.table.name,planning_kind:kind||null,module_path:kind==='wbs'?'计划管理 / WBS':kind==='organization'?'计划管理 / 组织架构':'数据录入 / 普通表'});}
   }
   outputs[step.key]=result.data;requireThat(Buffer.byteLength(JSON.stringify(outputs))<=1_048_576,400,'任务结果过大，请缩小查询或分页');
   const frozen=JSON.parse(JSON.stringify(step));
   if(result.operation.body?.version!==undefined&&frozen.body?.version===undefined)frozen.body={...frozen.body,version:result.operation.body.version};
   if(/\/batch-(update|delete)$/.test(result.operation.path)&&Array.isArray(frozen.body?.records))frozen.body.records=frozen.body.records.map((r:any,i:number)=>({...r,version:r.version??result.operation.body.records[i].version}));
   prepared.push(frozen);trace.push({step:step.key,method:step.method,path:operation.path,status:result.status,ok:true});}await authenticate(req,{} as any,()=>{});});
  const result={ok:true,status:200,data:{summary:plan.summary,action_checks:actionChecks,action_policy_stamp:actionPolicyStamp,steps:trace,outputs,...(capturePreview?{record_labels:recordLabels}:{}),...(capturePreview?{changes,labels}:{}),destinations:[...destinations.values()]},preview:!change,prepared_plan:{...plan,operations:prepared}};
  if(change){const original=(await client.query('SELECT auth_stamp FROM ai_changes WHERE id=$1',[change])).rows[0];requireThat(original.auth_stamp===await authorizationStamp(req.user.id,client),403,'执行期间权限已变化，整批回滚');await client.query('INSERT INTO ai_operation_receipts(change_id,user_id,result) VALUES($1,$2,$3)',[change,req.user.id,result]);await client.query("UPDATE ai_changes SET status='done',result=$2 WHERE id=$1",[change,result]);committing=true;await client.query('COMMIT');}else await client.query('ROLLBACK');return result;
 }catch(e){try{await client.query('ROLLBACK')}catch{}if(change&&committing)return {ok:false,status:503,unknown:true,error:'提交结果待核实，请查询原方案回执，不要重复执行'};return {ok:false,status:e instanceof HttpError?e.status:400,error:e instanceof z.ZodError?e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):(e as Error).message,failed_step:plan.operations[index-1]?.key,rolled_back:true,action_blocked:e instanceof ActionConditionError,trace};}finally{client.release();}
}
export type AgentTaskContext={plan?:AgentPlan;failed?:boolean;planningBindings?:any[];explicitTableIds?:string[];planningIntent?:boolean};
export async function prepareAgentPlan(req:Request,project:string,args:unknown,allowWrite:boolean,task?:AgentTaskContext){
 requireThat(allowWrite,403,'本轮未开启数据修改');let plan=parseAgentPlan(args);requireThat(plan.operations.some(o=>o.method!=='GET'),400,'纯查询请使用read_many，不需确认写入');
 if(task?.planningIntent){for(const step of plan.operations){let target=/^\/?(?:tables|objects\/tables?)\/([a-f0-9-]{36})(?:\/|$)/i.exec(step.path)?.[1];const record=/^\/?records\/([a-f0-9-]{36})(?:\/|$)/i.exec(step.path)?.[1];if(!target&&record)target=(await pool.query('SELECT table_id FROM records WHERE id=$1',[record])).rows[0]?.table_id;if(step.method==='GET'||!target||task.explicitTableIds?.includes(target))continue;
  const t=await tableAccess(req.user.id,target);const kind=ambiguousPlanningName(t.table.name);if(!kind)continue;
  const bound=(await pool.query('SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind=$2',[t.table.project_id,kind])).rows[0];if(!bound||bound.table_id===target)continue;
  await tableAccess(req.user.id,bound.table_id);
  requireThat(false,409,`目标是同名普通表“${t.table.name}”，不是计划管理绑定表。请改用 /tables/${bound.table_id}/records，先读取真实字段；WBS编码和名称不能使用普通表的title字段代替。`);
 }}
 const beforeStamp=await authorizationStamp(req.user.id);
 const preview=await runAgentPlan(req,project,plan);if(!preview.ok){if(task)task.failed=true;return {...preview,message:'预演已回滚；请根据错误自行修正参数/依赖并重新prepare_plan，不要要求用户处理中间参数。'};}
 requireThat(beforeStamp===await authorizationStamp(req.user.id),403,'预演期间权限已变化，请重新准备方案');
 plan=agentPlan.parse((preview as any).prepared_plan);
 if(task){task.plan=plan;task.failed=false;return {ok:true,staged:true,status:202,preview:{steps:(preview as any).data.steps,outputs:(preview as any).data.outputs},message:'全部步骤已预演并回滚，已加入本轮最终方案。继续自主完成其他步骤，结束后仅一次整体确认；引用前一步必须使用$steps.key.id，不能复制预演UUID。'};}
 const id=uid(),stamp=await authorizationStamp(req.user.id);const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1),330)',[req.user.id]);const n=Number((await client.query("SELECT count(*) FROM ai_changes WHERE user_id=$1 AND status='pending' AND expires_at>now()",[req.user.id])).rows[0].count);requireThat(n<100,429,'待确认方案过多，请先确认或取消');await client.query('INSERT INTO ai_changes(id,project_id,user_id,method,path,body,execution_version,auth_stamp) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[id,project,req.user.id,'POST',`/projects/${project}/agent-plan`,plan,stamp]);const a=await access(req.user.id,project,client);await audit(client,a.workspace_id,req.user.id,'AI任务方案预演通过',id,{steps:plan.operations.length});await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 return {ok:true,pending:true,status:202,change:{id,method:'POST',path:`/projects/${project}/agent-plan`,body:plan,expires_in_seconds:600},preview,message:'全部步骤已预演并回滚，业务数据尚未写入。用户只需最后整体确认一次；预演UUID不能当作已创建对象使用。'};
}
