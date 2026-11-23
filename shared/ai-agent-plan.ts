import {z} from 'zod';
export const agentOperation=z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),method:z.enum(['GET','POST','PUT','PATCH','DELETE']),path:z.string().max(1500),body:z.record(z.string(),z.unknown()).optional()}).strict();
export const agentPlan=z.object({summary:z.string().trim().min(1).max(1000),operations:z.array(agentOperation).min(1).max(96)}).strict().superRefine((p,c)=>{if(new Set(p.operations.map(o=>o.key)).size!==p.operations.length)c.addIssue({code:'custom',message:'步骤key不能重复'});if(Buffer.byteLength(JSON.stringify(p))>1024*1024)c.addIssue({code:'custom',message:'任务方案超过1MiB，请缩小或分批'});});
export type AgentPlan=z.infer<typeof agentPlan>;
export function resolveAgentRefs(value:any,results:Record<string,any>):any{
 if(typeof value==='string'){
  const resolve=(ref:string)=>{const [key,...parts]=ref.split('.');if(!Object.hasOwn(results,key))throw new Error(`依赖步骤尚未完成：${key}`);let v=results[key];for(const part of parts){if(['__proto__','prototype','constructor'].includes(part)||v==null||!Object.hasOwn(v,part))throw new Error(`引用不存在：${ref}`);v=v[part];}return v;};
  const full=/^\$steps\.([a-z0-9_.]+)$/.exec(value);if(full)return resolve(full[1]);
  return value.replace(/\$steps\.([a-z0-9_]+(?:\.[a-z0-9_]+)+)/g,(_,ref)=>{const v=resolve(ref);if(!['string','number'].includes(typeof v))throw new Error('路径引用必须是标识或数值');return String(v)});
 }
 if(Array.isArray(value))return value.map(v=>resolveAgentRefs(v,results));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveAgentRefs(v,results)]));
 return value;
}
/** Normalize tool-envelope aliases only; business fields and values stay unchanged. */
export function parseAgentPlan(input:any):AgentPlan{
 const list=input?.operations??input?.steps;
 return agentPlan.parse({summary:input?.summary??input?.description??'业务数据任务方案',operations:Array.isArray(list)?list.map((s:any,i:number)=>!s||typeof s!=='object'||Array.isArray(s)?s:({key:s.key??s.step_id??s.id??s.name??`step_${i+1}`,method:s.method,path:s.path,...(s.body!==undefined?{body:s.body}:{})})):list});
}
