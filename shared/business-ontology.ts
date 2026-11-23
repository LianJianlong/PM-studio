import {z} from 'zod';
const text=z.string().trim().max(500).default('');
export const ontologyDefinition=z.object({
 name:z.string().trim().min(1).max(100),description:text,aliases:z.array(z.string().trim().min(1).max(80)).max(10).default([]),
 code_field:z.string().max(80).default(''),display_field:z.string().max(80).default(''),
 properties:z.array(z.object({field:z.string().min(1).max(80),label:z.string().trim().min(1).max(100),meaning:text}).strict()).max(100).default([]),
 relations:z.array(z.object({field:z.string().min(1).max(80),target_table:z.uuid(),name:z.string().trim().min(1).max(100),inverse_name:z.string().trim().max(100).default(''),meaning:text,required:z.boolean().default(false),cardinality:z.enum(['one','many']).default('many')}).strict()).max(20).default([]),
}).strict();
export type OntologyDefinition=z.infer<typeof ontologyDefinition>;
export function validateOntologyDefinition(value:unknown,fields:any[]){
 const d=ontologyDefinition.parse(value),byId=new Map(fields.map(f=>[f.id,f]));
 for(const id of [d.code_field,d.display_field].filter(Boolean)){const f=byId.get(id);if(!f||['reference','backlink','image','attachment','formula'].includes(f.type))throw Error('编码及显示字段须为当前可读的普通字段');}
 if(new Set(d.aliases).size!==d.aliases.length)throw Error('业务别名不可重复');
 for(const key of ['properties','relations'] as const)if(new Set(d[key].map(f=>f.field)).size!==d[key].length)throw Error('同一字段不能重复映射');
 for(const p of d.properties)if(!byId.has(p.field))throw Error('属性映射包含不可读或已删除字段');
 for(const r of d.relations){const f=byId.get(r.field);if(!f||f.type!=='reference'||f.target_table!==r.target_table)throw Error('关系必须绑定当前真实关联字段与目标表');}
 if(new TextEncoder().encode(JSON.stringify(d)).length>22000)throw Error('业务定义过长，请精简说明');return d;
}
/** Hide metadata for unreadable columns/targets. Changed relationships are never silently rebound. */
export function projectOntologyDefinition(value:unknown,fields:any[],tables:Set<string>){
 const d=ontologyDefinition.parse(value),byId=new Map(fields.map(f=>[f.id,f]));
 const relations=d.relations.filter(r=>{const f=byId.get(r.field);return f?.type==='reference'&&f.target_table===r.target_table&&tables.has(r.target_table)});
 return {...d,code_field:byId.has(d.code_field)&&!['reference','backlink','image','attachment','formula'].includes(byId.get(d.code_field).type)?d.code_field:'',display_field:byId.has(d.display_field)&&!['reference','backlink','image','attachment','formula'].includes(byId.get(d.display_field).type)?d.display_field:'',properties:d.properties.filter(p=>byId.has(p.field)),relations,partial:d.properties.some(p=>!byId.has(p.field))||relations.length!==d.relations.length};
}
export function ontologyRelationFindings(relations:OntologyDefinition['relations'],data:any){return relations.flatMap(r=>{const raw=data[r.field],count=raw==null||raw===''?0:Array.isArray(raw)?raw.length:1;return [...(r.required&&count===0?[{field:r.field,relation:r.name,kind:'missing' as const}]:[]),...(r.cardinality==='one'&&count>1?[{field:r.field,relation:r.name,kind:'cardinality' as const}]:[])];});}
