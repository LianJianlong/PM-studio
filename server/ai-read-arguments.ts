import {visibleBusinessObjects} from './business-ontology.ts';
import type {Request} from 'express';import {z} from 'zod';
import {normalizeBusinessReadShape} from '../shared/ai-read-arguments.ts';
import {ontologyCatalog,businessContext} from './ai-ontology.ts';
import {tableAccess,visibleColumns,requireThat} from './auth.ts';
export async function resolveBusinessReadArguments(req:Request,project:string,value:unknown){
 const b=normalizeBusinessReadShape(value);if(!b||typeof b!=='object'||Array.isArray(b)||b.mode==='catalog'||b.mode==='plan')return b;
 if(typeof b.table_id==='string'&&!z.uuid().safeParse(b.table_id).success){b.table_name??=b.table_id;delete b.table_id;}
 if(!b.table_id){const catalog=await ontologyCatalog(req.user.id,project),name=b.table_name||(b.mode==='search'?b.search:undefined),matches=typeof name==='string'?catalog.entities.filter((e:any)=>[e.name,e.business_object?.definition.name,...(e.business_object?.definition.aliases||[])].includes(name)):[];
  requireThat(matches.length===1,400,'\u8868\u540d\u672a\u552f\u4e00\u5b9a\u4f4d\uff0c\u8bf7\u4f7f\u7528\u6388\u6743\u76ee\u5f55\u4e2d\u7684\u771f\u5b9e\u8868\u540d\u6216table_id');b.table_id=matches[0].id;if(b.mode==='search'&&b.search===name)b.search='';b.table_name=matches[0].name;
 }
 if(b.table_name){const catalog=await ontologyCatalog(req.user.id,project),matches=catalog.entities.filter((e:any)=>[e.name,e.business_object?.definition.name,...(e.business_object?.definition.aliases||[])].includes(b.table_name));requireThat(matches.length===1&&matches[0].id===b.table_id,400,'业务名称存在歧义或与目标表不一致');b.table_name=matches[0].name;}
 const t=await tableAccess(req.user.id,b.table_id);requireThat(t.table.project_id===project,403,'\u4ec5\u67e5\u8be2\u5f53\u524d\u9879\u76ee\u7684\u4e1a\u52a1\u5bf9\u8c61');requireThat(!b.table_name||b.table_name===t.table.name,400,'\u8868\u540d\u4e0e\u8868\u6807\u8bc6\u4e0d\u4e00\u81f4\uff0c\u8bf7\u91cd\u65b0\u6838\u5bf9\u76ee\u5f55');delete b.table_name;const fields=visibleColumns(t.permission,t.table),definition=(await visibleBusinessObjects(req.user.id,project)).objects.find(o=>o.enabled&&o.table_id===t.table.id)?.definition;
 for(const key of ['metric','dimension','filterField','dateField']){if(typeof b[key]!=='string'||fields.some((f:any)=>f.id===b[key])||b[key].startsWith('__'))continue;const matches=fields.filter((f:any)=>f.name===b[key]||definition?.properties.some((p:any)=>p.field===f.id&&p.label===b[key]));if(matches.length>1)requireThat(false,400,'业务属性名称不唯一，请使用真实字段标识');if(matches.length===1)b[key]=matches[0].id;}
 if(typeof b.record_id==='string'&&!z.uuid().safeParse(b.record_id).success){const token=b.record_id,result:any=await businessContext(req,project,{mode:'search',table_id:t.table.id,search:token}),nameFields=fields.filter((f:any)=>['code','name','title'].includes(f.id)).map((f:any)=>f.name),matches=(result.rows||[]).filter((r:any)=>r.title===token||nameFields.some((name:string)=>r.fields[name]===token));
  requireThat(result.complete&&matches.length===1,400,'\u8bb0\u5f55\u540d\u79f0\u6216\u7f16\u7801\u672a\u552f\u4e00\u5b9a\u4f4d\uff0c\u8bf7\u5148\u68c0\u7d22\u5e76\u4f7f\u7528\u5df2\u8bfb\u7684record_id');b.record_id=matches[0].id;
 }
 return b;
}
