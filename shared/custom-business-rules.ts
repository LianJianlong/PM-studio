import {z} from 'zod';import {decimalParts,numericTypes} from './fields.ts';
export const conditionOps=['eq','ne','gt','gte','lt','lte','contains','empty','present'] as const;
export const ruleCondition=z.object({field:z.string().min(1).max(100),op:z.enum(conditionOps),operand:z.enum(['value','field','today']).default('value'),value:z.string().max(400).default('')}).strict();
export const customRuleDefinition=z.object({name:z.string().trim().min(1).max(100),severity:z.enum(['issue','review']).default('review'),message:z.string().trim().min(1).max(400),when:z.object({mode:z.enum(['all','any']).default('all'),conditions:z.array(ruleCondition).max(8)}).strict(),expect:ruleCondition}).strict();
export type CustomRuleDefinition=z.infer<typeof customRuleDefinition>;
export const recordStatusField={id:'__status',name:'记录生效状态',type:'single_select',options:['draft','pending','approved','rejected','obsolete']};
export function customRuleFields(fields:any[]){return [...fields.filter(f=>f.lifecycle!=='deleted'&&f.id!=='__status'),recordStatusField]}
export function ruleFieldIds(d:CustomRuleDefinition){return [...new Set([...d.when.conditions,d.expect].flatMap(c=>[c.field,...(!['empty','present'].includes(c.op)&&c.operand==='field'?[c.value]:[])]))]}
export function ruleFieldKind(f:any){return numericTypes.includes(f?.type)?'number':f?.type==='date'?'date':['text','single_select','enum'].includes(f?.type)?'text':f?.type==='boolean'?'boolean':'other'}
export function allowedRuleOps(f:any){const kind=ruleFieldKind(f);return kind==='number'||kind==='date'?['eq','ne','gt','gte','lt','lte','empty','present']:kind==='text'?['eq','ne',...(f.type==='text'?['contains']:[]),'empty','present']:kind==='boolean'?['eq','ne','empty','present']:['empty','present']}
export function validateCustomRule(input:unknown,fields:any[]){const d=customRuleDefinition.parse(input),all=customRuleFields(fields);
 for(const c of [...d.when.conditions,d.expect]){const left=all.find(f=>f.id===c.field);if(!left)throw Error('规则字段已移除或不可读取');if(!allowedRuleOps(left).includes(c.op))throw Error('检查运算符不适用于该字段类型');if(['empty','present'].includes(c.op)){c.operand='value';c.value='';continue;}if(c.operand==='value'&&!c.value.trim())throw Error('空值请使用为空或不为空运算符');
  const kind=ruleFieldKind(left);if(c.operand==='field'){const right=all.find(f=>f.id===c.value);if(!right||ruleFieldKind(right)!==kind)throw Error('比较列必须可读且类型兼容');if(kind==='number'&&(left.unit||'')!==(right.unit||''))throw Error('比较数值列必须具有相同计量单位');}
  else if(c.operand==='today'){if(kind!=='date')throw Error('只有日期字段可与今天比较');}
  else if(kind==='number')decimalParts(c.value);else if(kind==='date')z.iso.date().parse(c.value);else if(kind==='boolean'&&!['true','false'].includes(c.value))throw Error('布尔常量须选择是或否');else if(['single_select','enum'].includes(left.type)&&Array.isArray(left.options)&&!left.options.includes(c.value))throw Error('请选择字段当前有效选项');
 }
 if(new TextEncoder().encode(JSON.stringify(d)).length>14000)throw Error('规则内容过长，请精简条件或提示');return d;
}
export type RuleTruth=true|false|null;
const empty=(v:any)=>v==null||(typeof v==='string'&&v.trim()==='')||(Array.isArray(v)&&v.length===0);
function compareNumbers(a:any,b:any){const x=decimalParts(String(a)),y=decimalParts(String(b)),scale=Math.max(x.scale,y.scale),p=x.coefficient*10n**BigInt(scale-x.scale),q=y.coefficient*10n**BigInt(scale-y.scale);return p<q?-1:p>q?1:0}
export function evaluateRuleCondition(c:z.infer<typeof ruleCondition>,fields:any[],data:Record<string,any>,status:string,today:string):RuleTruth{
 const all=customRuleFields(fields),f=all.find(f=>f.id===c.field);if(!f)return null;const get=(id:string)=>id==='__status'?status:data[id],left=get(c.field);if(typeof left==='string'&&left.startsWith('#ERROR:'))return null;
 if(c.op==='empty')return empty(left);if(c.op==='present')return !empty(left);const right=c.operand==='field'?get(c.value):c.operand==='today'?today:c.value;if(empty(left)||empty(right)||typeof right==='string'&&right.startsWith('#ERROR:'))return null;
 try{let cmp:number;const kind=ruleFieldKind(f);if(kind==='number')cmp=compareNumbers(left,right);else if(kind==='date'){z.iso.date().parse(left);z.iso.date().parse(right);cmp=left<right?-1:left>right?1:0;}else if(kind==='boolean'){if(typeof left!=='boolean'||![true,false,'true','false'].includes(right))return null;const b=right===true||right==='true';cmp=left===b?0:1;}else if(kind==='text'){if(typeof left!=='string'||typeof right!=='string')return null;if(c.op==='contains')return left.includes(right);cmp=left===right?0:left<right?-1:1;}else return null;
 return c.op==='eq'?cmp===0:c.op==='ne'?cmp!==0:c.op==='gt'?cmp>0:c.op==='gte'?cmp>=0:c.op==='lt'?cmp<0:cmp<=0;
 }catch{return null;}
}
export function evaluateCustomRule(d:CustomRuleDefinition,fields:any[],data:Record<string,any>,status:string,today:string){const conditions=d.when.conditions.map(c=>evaluateRuleCondition(c,fields,data,status,today));const when=conditions.length===0?true:d.when.mode==='all'?conditions.includes(false)?false:conditions.includes(null)?null:true:conditions.includes(true)?true:conditions.includes(null)?null:false;
 if(when===false)return 'not_applicable' as const;if(when===null)return 'unknown' as const;const assertion=evaluateRuleCondition(d.expect,fields,data,status,today);return assertion===null?'unknown' as const:assertion?'pass' as const:'finding' as const;
}
const names:Record<string,string>={eq:'等于',ne:'不等于',gt:'大于',gte:'大于等于',lt:'小于',lte:'小于等于',contains:'包含',empty:'为空',present:'不为空'};
export function customRuleBasis(d:CustomRuleDefinition,fields:any[]){const all=customRuleFields(fields);const show=(c:z.infer<typeof ruleCondition>)=>`${all.find(f=>f.id===c.field)?.name||'不可读字段'} ${names[c.op]}${['empty','present'].includes(c.op)?'':c.operand==='field'?' '+(all.find(f=>f.id===c.value)?.name||'不可读字段'):c.operand==='today'?' 今天':' “'+c.value+'”'}`;return (d.when.conditions.length?'当 '+d.when.conditions.map(show).join(d.when.mode==='all'?' 且 ':' 或 '):'所有可读记录')+'，要求 '+show(d.expect);}
