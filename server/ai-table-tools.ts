import {normalizeTableToolArgs} from '../shared/ai-context.ts';
import type {Request} from 'express';
import {z} from 'zod';
import {tableAccess,visibleColumns,requireThat} from './auth.ts';
import {readAIEndpoint} from './ai-data-tools.ts';
import {dispatchAgent,prepareAgentPlan,type AgentTaskContext} from './ai-agent-runtime.ts';
export async function tableTool(req:Request,project:string,name:string,args:unknown,allowWrite:boolean,task?:AgentTaskContext){
 args=normalizeTableToolArgs(name,args);
 const common={table_id:z.uuid().optional(),table_name:z.string().min(1).max(150).optional()};
 const row=z.object({id:z.uuid().optional(),version:z.number().int().positive().optional(),data:z.record(z.string(),z.unknown()).optional()}).strict();
 const b=name==='table_records'?z.object({...common,action:z.enum(['query','create','update','delete']),rows:z.array(row).max(5000).optional(),search:z.string().max(200).optional(),page:z.number().int().positive().optional()}).strict().parse(args):z.object({...common,action:z.enum(['inspect','add','update','delete']),column_id:z.string().max(40).optional(),definition:z.record(z.string(),z.unknown()).optional()}).strict().parse(args);
 requireThat(b.table_id||b.table_name,400,'请提供table_id或table_name');
 let target=b.table_id;
 if(!target){const tables=await readAIEndpoint(req,`/projects/${project}/tables`);let matches=tables.filter((t:any)=>t.name===b.table_name);if(/^(WBS|项目WBS|组织架构|项目组织架构)$/i.test(b.table_name!)){const kind=/WBS/i.test(b.table_name!)?'wbs':'organization';const bound=tables.find((t:any)=>t.planning_kind===kind);if(bound)matches=[bound];}requireThat(matches.length===1,400,'表名不存在或重名，请从data_catalog选择唯一table_id');target=matches[0].id;}
 const t=await tableAccess(req.user.id,target!),columns=visibleColumns(t.permission,t.table);
 if(name==='table_records'&&b.action==='query'){const q=b as any;return {ok:true,...await dispatchAgent(req,{method:'GET',path:`/tables/${target}/records?page=${q.page||1}&search=${encodeURIComponent(q.search||'')}&status=all`})};}
 if(name==='table_schema'&&b.action==='inspect')return {ok:true,table_id:target,name:t.table.name,version:t.table.object_version,columns};
 requireThat(allowWrite,403,'本轮未开启数据修改');let operation:any;
 if(name==='table_records'){
  const r=b as any;requireThat(r.rows?.length,400,'操作需要非空rows');const max=r.action==='create'?5000:1000;requireThat(r.rows.length<=max,400,`单批最多${max}条`);
  const values=(data:any)=>{requireThat(data&&typeof data==='object'&&Object.keys(data).length>0,400,'新增/修改必须提供data');const out:Record<string,unknown>={};for(const [key,value]of Object.entries(data)){const exact=columns.find((c:any)=>c.id===key);const matches=exact?[exact]:columns.filter((c:any)=>c.name===key);requireThat(matches.length===1,400,`字段“${key}”未定义、不可见或重名，请读取table_schema核对`);requireThat(!Object.hasOwn(out,matches[0].id),400,'同一字段重复赋值');out[matches[0].id]=value;}return out;};
  if(r.action==='create'){requireThat(r.rows.every((x:any)=>!x.id&&!x.version),400,'新增不能包含已有行ID或版本');operation={method:'POST',path:`/tables/${target}/import`,body:{rows:r.rows.map((x:any)=>values(x.data))}};}
  else{requireThat(r.rows.every((x:any)=>x.id),400,'修改/删除必须先查询取得记录id');operation={method:'POST',path:`/tables/${target}/records/batch-${r.action}`,body:{records:r.rows.map((x:any)=>({id:x.id,...(x.version?{version:x.version}:{}),...(r.action==='update'?{data:values(x.data)}:{})}))}};}
 }else{
  const f=b as any;if(f.action==='add'){requireThat(f.definition,400,'新增字段须提供definition');operation={method:'POST',path:`/tables/${target}/columns`,body:f.definition};}
  else{if(f.action==='update')requireThat(f.definition&&Object.keys(f.definition).length>0,400,'修改字段须提供非空definition');const matches=columns.filter((c:any)=>c.id===f.column_id||c.name===f.column_id);requireThat(matches.length===1,400,'字段不存在、不可见或重名');const field=matches[0];operation={method:'PATCH',path:`/objects/tables/${target}/columns/${field.id}`,body:{version:t.table.object_version,...(f.action==='delete'?{lifecycle:'deleted'}:{definition:{...field,...f.definition,id:field.id}})}};}
 }
 const operations=task?.plan?.operations||[];let key=`table_step_${operations.length+1}`;while(operations.some(o=>o.key===key))key+='_';
 const result=await prepareAgentPlan(req,project,{summary:task?.plan?.summary||`${t.table.name}：${({create:'新增记录',update:name==='table_schema'?'修改字段':'修改记录',delete:name==='table_schema'?'删除字段':'删除记录',add:'新增字段'} as any)[b.action]||b.action}`,operations:[...operations,{key,...operation}]},allowWrite,task);
 return result.staged?{...result,message:'本次修改已成功预演并加入最终待确认方案，不需要再调用prepare_plan，也不要重复此操作。确认前查询正式表仍显示旧值，这是正常的。仅当用户还有其他未完成的要求时才继续；否则简短回复等待用户在结果预览中确认写入。'}:result;
}
