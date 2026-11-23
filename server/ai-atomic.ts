import {beginActionControl,checkActionEvents} from './business-actions.ts';
import type {RequestHandler} from 'express';import {isDeepStrictEqual} from 'node:util';import {pool,requestTransaction} from './db.ts';import {HttpError,requireThat} from './auth.ts';import {canInspectChange} from './ai-permissions.ts';import {workState} from './work-tracking.ts';
export async function operationReceipt(change:string,user:string){return requestTransaction.exit(async()=>((await pool.query('SELECT result FROM ai_operation_receipts WHERE change_id=$1 AND user_id=$2',[change,user])).rows[0]?.result));}
export const atomicAI:RequestHandler=async(req,res,next)=>{
 const key=req.get('X-Studio-AI-Operation');if(!key){next();return;}
 requireThat(/^[a-f0-9-]{36}$/i.test(key),400,'操作ID无效');const client=await pool.connect();let finished=false;const original=res.json,send=res.send,end=res.end;let response:{status:number;body:any}|undefined;
 const restore=()=>{res.json=original;res.send=send;res.end=end;const state=workState(req);state.complete=undefined;state.fail=undefined;};
 const respond=(status:number,body:any)=>{if(res.destroyed)return;res.status(status);res.removeHeader('Content-Length');res.type('json');original.call(res,body);};
 const rollback=async()=>{if(finished)return;finished=true;restore();try{await client.query('ROLLBACK');}finally{client.release();}};
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.actor_id',$1,true)",[req.user.id]);const row=(await client.query('SELECT * FROM ai_changes WHERE id=$1 AND user_id=$2 FOR UPDATE',[key,req.user.id])).rows[0];requireThat(row,403,'操作不属于当前账号');
  const expected=new URL(row.path,'http://local');requireThat(row.method===req.method&&expected.pathname+expected.search===req.originalUrl.slice(4)&&isDeepStrictEqual(row.body,req.body),403,'操作内容不匹配');requireThat(await canInspectChange(req.user.id,row,client),403,'当前权限不再允许该操作');
  const cached=(await client.query('SELECT result FROM ai_operation_receipts WHERE change_id=$1 AND user_id=$2',[key,req.user.id])).rows[0]?.result;
  if(cached){await rollback();res.status(cached.status).json(cached.data);return;}
  requireThat(row.execution_version===1&&['executing','unknown'].includes(row.status)&&new Date(row.expires_at)>new Date(),409,'操作未确认、已过期或为旧版本待核实操作');
  await beginActionControl(req.user.id,row.project_id,client,row.action_policy_stamp);
  res.json=function(body:any){response={status:this.statusCode,body:JSON.parse(JSON.stringify(body))};return this;};
  res.send=function(){response={status:415,body:{error:'AI操作只支持JSON业务接口'}};return this;};res.end=function(this:any){response={status:415,body:{error:'AI操作只支持JSON业务接口'}};return this;} as any;
  workState(req).fail=async()=>{await rollback();};
  workState(req).complete=async()=>{if(!response||finished)return;const saved=response,result={ok:saved.status<400,status:saved.status,data:saved.body};
   if(!result.ok){await rollback();await requestTransaction.exit(()=>pool.query("UPDATE ai_changes SET status='failed',result=$2 WHERE id=$1 AND status<>'done'",[key,result]));respond(saved.status,saved.body);return;}
   try{await requestTransaction.run(client,()=>checkActionEvents(req,row.project_id));}catch(e){await rollback();const status=e instanceof HttpError?e.status:400,body={error:(e as Error).message,rolled_back:true};await requestTransaction.exit(()=>pool.query("UPDATE ai_changes SET status='failed',result=$2 WHERE id=$1 AND status<>'done'",[key,{ok:false,status,data:body}]));respond(status,body);return;}
   try{await client.query('INSERT INTO ai_operation_receipts(change_id,user_id,result) VALUES($1,$2,$3)',[key,req.user.id,result]);await client.query("UPDATE ai_changes SET status='done',result=$2 WHERE id=$1",[key,result]);await client.query('COMMIT');finished=true;restore();client.release();respond(saved.status,saved.body);}
   catch(error){await rollback();const receipt=await operationReceipt(key,req.user.id);if(receipt){respond(receipt.status,receipt.data);}else{await requestTransaction.exit(()=>pool.query("UPDATE ai_changes SET status='unknown' WHERE id=$1 AND status<>'done'",[key]));respond(503,{unknown:true,error:'执行结果待核实，请通过原操作ID查询，不要新建重复操作'});}}
  };
  requestTransaction.run(client,()=>next());
 }catch(error){await rollback();next(error);}
};
