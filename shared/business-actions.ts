import {z} from 'zod';
import {ruleCondition,validateCustomRule,evaluateRuleCondition,customRuleBasis} from './custom-business-rules';
export const controlledActions=['create','update','delete','status'] as const;
export const actionPolicy=z.object({name:z.string().trim().min(1).max(100),description:z.string().trim().max(500).default(''),action:z.enum(controlledActions),conditions:z.array(z.object({basis:z.enum(['current','result']),condition:ruleCondition}).strict()).min(1).max(8)}).strict();
export type ActionPolicy=z.infer<typeof actionPolicy>;
export function validateActionPolicy(input:unknown,fields:any[]){const p=actionPolicy.parse(input);for(const c of p.conditions){if(p.action==='create'&&c.basis!=='result'||p.action==='delete'&&c.basis!=='current')throw Error('新增条件只检查结果，删除条件只检查原记录');validateCustomRule({name:p.name,severity:'issue',message:'动作条件',when:{mode:'all',conditions:[]},expect:c.condition},fields);}return p;}
export function checkActionPolicy(p:ActionPolicy,fields:any[],before:any,after:any,today:string){return p.conditions.map(c=>{const row=c.basis==='current'?before:after;return {basis:c.basis,truth:row?evaluateRuleCondition(c.condition,fields,row.data||{},row.status,today):null,description:customRuleBasis({name:p.name,severity:'issue',message:'动作条件',when:{mode:'all',conditions:[]},expect:c.condition},fields)}});}
export const actionDescriptors=[
 {name:'activity.update',parameters:'target：已读作业；data：原表变化字段',preconditions:'真实作业绑定、字段/行权限、记录版本、日期与排程校验',effects:'更新作业来源记录，按原流程重新确认后参与计算'},
 {name:'wbs.add_child',parameters:'target：已读父WBS；data：名称及可选编码',preconditions:'真实WBS绑定、父项唯一、层数≤50、原表权限',effects:'新增真实WBS子项，原编码和层级规则生效'},
 {name:'resource.create',parameters:'key：步骤名称；data：类型、名称、单位、费率等',preconditions:'原资源新增权限、字段类型与单位校验',effects:'在当前项目资源池新增资源，不编造实际费用'},
 {name:'resource.update',parameters:'target：已读资源；data：变化字段',preconditions:'原资源修改权限、资源版本及业务校验',effects:'修改资源属性，原分配与费用计算沿用'},
 {name:'resource.deactivate',parameters:'target：已读资源',preconditions:'用户明确要求停用、原删除权限及资源版本',effects:'停用资源，保留原有业务追溯'},
 {name:'allocation.assign',parameters:'target：已读作业；resource：已读/本方案新建资源；quantity：明确数量',preconditions:'有效作业、资源可见、版本、单位及原分配权限',effects:'新增/更新资源分配，由原系统计算费用'},
];
