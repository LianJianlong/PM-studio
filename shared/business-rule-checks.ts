import {fieldExemptsExisting,decimalParts,isSystemField} from './fields.ts';
export type RuleFinding={rule:string;severity:'issue'|'review';fields:string[];message:string;basis:string};
const empty=(v:any)=>v==null||(typeof v==='string'&&v.trim()==='')||(Array.isArray(v)&&v.length===0);
export function checkRecordRules(kind:string,fields:any[],data:Record<string,any>,createdAt?:string|Date){
 const findings:RuleFinding[]=[],has=(id:string)=>fields.some(f=>f.id===id),value=(id:string)=>has(id)?data[id]:undefined;
 const add=(rule:string,severity:RuleFinding['severity'],ids:string[],message:string,basis:string)=>findings.push({rule,severity,fields:ids.map(id=>fields.find(f=>f.id===id)?.name||id),message,basis});
 for(const f of fields)if(f.required&&!f.auto_increment&&!f.auto_code&&f.type!=='formula'&&!isSystemField(f)&&!fieldExemptsExisting(f,createdAt)&&empty(data[f.id]))add('required','issue',[f.id],'当前必填字段缺值','当前字段必填规则，且该记录不在历史豁免范围');
 const optional=fields.filter(f=>f.type==='reference'&&!f.required&&empty(data[f.id]));if(optional.length)add('optional-reference','review',optional.slice(0,20).map(f=>f.id),'可选关联未填写，请核对是否适用','可选字段为空不等于业务错误，不推测应关联哪条记录；每条记录最多列20个空关联字段');
 if(['hazards','quality'].includes(kind)&&has('closure_state')&&has('closed_date')){
  if(value('closure_state')==='已关闭'&&empty(value('closed_date')))add('closure-date','issue',['closure_state','closed_date'],'已关闭但未登记关闭日期','关闭状态应具有可核验的关闭日期；不据此认定整改失败');
  if(value('closure_state')!=='已关闭'&&!empty(value('closed_date')))add('closure-reopened','review',['closure_state','closed_date'],'非关闭状态仍有关闭日期，请核对是否重新打开','可能是重开事项或旧日期残留，需业务确认');
 }
 if(['procurement','purchase_orders','arrivals'].includes(kind)&&has('installation_ready_date')&&has('readiness_basis')&&!empty(value('installation_ready_date'))&&empty(value('readiness_basis')))add('readiness-evidence','issue',['installation_ready_date','readiness_basis'],'安装就绪日期缺少确认依据','到货不能替代安装就绪确认，不据此给交付延期数字');
 if(kind==='arrivals'&&has('inspection_state')&&has('arrival_date')&&value('inspection_state')==='合格'&&empty(value('arrival_date')))add('arrival-evidence','review',['inspection_state','arrival_date'],'进场验收合格但未登记实际到场日期','核对是否漏填日期或属于其他验收口径');
 if(kind==='safety_rectification'&&has('result')&&has('verification_date')&&value('result')==='通过'&&empty(value('verification_date')))add('verification-date','review',['result','verification_date'],'复查通过但缺少复查日期','需补充可核验日期，不据此认定未实施复查');
 const numeric=(id:string,min:string,max?:string)=>{const raw=value(id);if(!has(id)||empty(raw))return;try{const p=decimalParts(String(raw)),lo=decimalParts(min),scale=Math.max(p.scale,lo.scale),v=p.coefficient*10n**BigInt(scale-p.scale),l=lo.coefficient*10n**BigInt(scale-lo.scale);let bad=v<l;if(max){const hi=decimalParts(max);bad=bad||p.coefficient*10n**BigInt(hi.scale)>hi.coefficient*10n**BigInt(p.scale);}if(bad)add('numeric-range','issue',[id],'数值超出业务允许范围',max?`${min} ≤ 数值 ≤ ${max}`:`数值 ≥ ${min}`);}catch{add('numeric-format','issue',[id],'无法按精确数值解析','数值格式无效；不按零参与判断');}};
 if(kind==='movements')numeric('quantity','0');if(kind==='procurement')numeric('progress_percent','0','100');if(kind==='activities'){numeric('progress','0','100');numeric('duration','0');}
 return findings;
}
export function needsBusinessRuleCheck(prompt:string){return /一致性|关联缺失|状态矛盾|规则检查|校验数据|检查.+(?:数据|记录|关联|状态|闭环)|check.*(?:consistency|data|references)|validate.*(?:data|record)/i.test(prompt)&&!/什么是|概念|what is/i.test(prompt);}
