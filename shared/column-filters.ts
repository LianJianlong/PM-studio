import {z} from 'zod';
import {numericTypes,decimalParts} from './fields';
export type FilterColumn={id:string;name:string;type:string;options?:any[]};
export const filterOperators=['contains','not_contains','equals','not_equals','gt','gte','lt','lte','empty','not_empty'] as const;
export type ColumnFilter={field:string;operator:typeof filterOperators[number];value?:string};
export type ColumnFilters={mode:'all'|'any';conditions:ColumnFilter[]};
export const emptyColumnFilters:ColumnFilters={mode:'all',conditions:[]};
export function operatorsForColumn(c:FilterColumn){return [...(['boolean','single_select','enum'].includes(c.type)?['equals','not_equals']:['contains','not_contains','equals','not_equals']),...(numericTypes.includes(c.type)||c.type==='formula'||['date','time'].includes(c.type)?['gt','gte','lt','lte']:[]),'empty','not_empty'] as typeof filterOperators[number][];}
export function parseColumnFilters(raw:unknown,columns:FilterColumn[]):ColumnFilters{
 if(raw===undefined||raw==='')return {mode:'all',conditions:[]};
 const input=typeof raw==='string'?JSON.parse(z.string().max(16000).parse(raw)):raw;
 const result=z.object({mode:z.enum(['all','any']),conditions:z.array(z.object({field:z.string().min(1).max(100),operator:z.enum(filterOperators),value:z.string().max(500).optional()}).strict()).max(12)}).strict().parse(input);
 for(const f of result.conditions){const column=columns.find(c=>c.id===f.field);if(!column)throw Error('筛选列不存在或无权访问');if(!operatorsForColumn(column).includes(f.operator))throw Error('该列不支持所选筛选方式');if(!['empty','not_empty'].includes(f.operator)&&f.value===undefined)throw Error('请填写筛选值');if(['gt','gte','lt','lte'].includes(f.operator)&& (numericTypes.includes(column.type)||column.type==='formula')){try{decimalParts(f.value!)}catch{throw Error('数值筛选需要有效数字')}}}
 return result;
}
function text(v:unknown):string{return typeof v==='object'&&v!==null?JSON.stringify(v):String(v??'');}
export function matchesColumnFilters(row:any,columns:FilterColumn[],filters:ColumnFilters){
 const test=(f:ColumnFilter)=>{const c=columns.find(c=>c.id===f.field);if(!c)return false;const ref=row.references?.[f.field];const v=f.field==='__status'?row.status:row.data?.[f.field];const values=ref?ref.items.map((i:any)=>i.label):Array.isArray(v)?v:[v];const blank=values.every((x:any)=>x===null||x===undefined||x==='');
 if(ref?.restricted&&['empty','not_empty','not_contains','not_equals'].includes(f.operator))return false;
 if(f.operator==='empty')return blank;if(f.operator==='not_empty')return !blank;
 const target=(f.value??'').normalize('NFKC').toLowerCase();
 const compare=(value:unknown)=>{if(value===null||value===undefined||value==='')return null;if(numericTypes.includes(c.type)||c.type==='formula'){try{const a=decimalParts(String(value)),b=decimalParts(f.value!),scale=Math.max(a.scale,b.scale),x=a.coefficient*10n**BigInt(scale-a.scale),y=b.coefficient*10n**BigInt(scale-b.scale);return x<y?-1:x>y?1:0}catch{if(c.type!=='formula'||!['equals','not_equals'].includes(f.operator))return null}}const s=text(value).normalize('NFKC').toLowerCase();return s<target?-1:s>target?1:0};
 const positive=f.operator==='not_equals'?'equals':f.operator==='not_contains'?'contains':f.operator;
 const found=values.some((x:any)=>{if(positive==='contains')return text(x).normalize('NFKC').toLowerCase().includes(target);const cmp=compare(x);if(cmp===null)return false;return positive==='equals'?cmp===0:positive==='gt'?cmp>0:positive==='gte'?cmp>=0:positive==='lt'?cmp<0:cmp<=0});return f.operator==='not_equals'||f.operator==='not_contains'?!found:found;
 };
 return !filters.conditions.length||(filters.mode==='any'?filters.conditions.some(test):filters.conditions.every(test));
}
export const statusFilterColumn:FilterColumn={id:'__status',name:'状态',type:'single_select',options:[{value:'draft',label:'草稿'},{value:'approved',label:'有效'},{value:'pending',label:'待审批'},{value:'rejected',label:'退回'},{value:'obsolete',label:'作废'}]};
