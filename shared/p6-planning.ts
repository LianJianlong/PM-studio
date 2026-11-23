import {LoeError,LOE} from './loe.ts';
export const durationTypes=['固定工期和投入率','固定工期和工作量','固定投入率','固定工作量'] as const;
export const p6ActivityFields=[
 {id:'duration_type',name:'工期类型',type:'single_select',options:durationTypes},
 {id:'activity_type',name:'作业类型',type:'single_select',options:['任务','开始里程碑','完成里程碑',LOE]},
 {id:'percent_complete_type',name:'完成率类型',type:'single_select',options:['实物','工期','步骤']},
 {id:'remaining_duration',name:'剩余工期（工作日）',type:'number'},
 {id:'actual_start',name:'实际开始',type:'date'},
 {id:'actual_finish',name:'实际完成',type:'date'},
 {id:'constraint_type',name:'日期约束',type:'single_select',options:['尽早开始','开始不早于','开始不晚于','完成不早于','完成不晚于','开始于','完成于','强制开始','强制完成']},
 {id:'constraint_date',name:'约束日期',type:'date'},
 {id:'activity_steps',name:'作业步骤',type:'json'},
] as const;
export type ScheduleOptions={baseline_id?:string;comparison_baseline_ids?:(string|null)[];data_date?:string;forecast_remaining?:boolean;must_finish_by?:string;critical_method?:'float'|'longest';critical_threshold?:number;near_critical_hours?:number;path_count?:number;path_end_id?:string};
export function activityPlanningValues(data:any){
 return {...Object.fromEntries(p6ActivityFields.map(f=>[f.id,data?.[f.id]??undefined])),loe_scope:Array.isArray(data?.loe_scope)?data.loe_scope:[]};
}
export function validateActivityPlanning(data:any){
 if(data.activity_steps!=null){
  if(!Array.isArray(data.activity_steps)||data.activity_steps.length>500)throw Error('作业步骤须为数组，最多500项');
  for(const step of data.activity_steps)if(!step||typeof step.name!=='string'||!step.name.trim()||step.name.length>200||!Number.isFinite(Number(step.weight))||Number(step.weight)<=0||Number(step.weight)>1000000||!Number.isFinite(Number(step.progress))||Number(step.progress)<0||Number(step.progress)>100)throw Error('步骤须有名称、正数权重及0至100的完成率');
 }

 if(data.activity_type===LOE){if(data.constraint_type&&data.constraint_type!=='尽早开始')throw new LoeError('LOE不使用日期约束，请清除日期约束');if(data.loe_scope!=null&&(!Array.isArray(data.loe_scope)||data.loe_scope.length>100||new Set(data.loe_scope).size!==data.loe_scope.length))throw new LoeError('LOE关联作业须为不重复列表，最多100项');}
 if(data.remaining_duration!=null&&(!Number.isFinite(Number(data.remaining_duration))||Number(data.remaining_duration)<0||Number(data.remaining_duration)>3650))throw Error('剩余工期须为0至3650工作日');
 if(data.actual_finish&&!data.actual_start)throw Error('填写实际完成前，请填写实际开始');
 if(data.actual_finish&&data.actual_finish<data.actual_start)throw Error('实际完成不能早于实际开始');
 if(data.actual_finish&&Number(data.progress)!==100)throw Error('已填写实际完成日期，完成率须为100%');
 if(data.actual_finish&&data.remaining_duration!=null&&Number(data.remaining_duration)!==0)throw Error('已完成作业的剩余工期须为0');
 if(['开始里程碑','完成里程碑'].includes(data.activity_type)&&Number(data.duration)!==0)throw Error('里程碑工期必须为0');
 if(data.constraint_type&&data.constraint_type!=='尽早开始'&&!data.constraint_date)throw Error('请选择约束日期');
 for(const f of p6ActivityFields)if('options' in f&&data[f.id]&&!(f.options as readonly string[]).includes(data[f.id]))throw Error('无效的计划选项：'+f.name);
}

export function planningProgress(data:any,fallback:number){
 if(data.percent_complete_type==='工期'&&data.remaining_duration!=null&&Number(data.duration)>0)return Math.round(Math.max(0,Math.min(100,(Number(data.duration)-Number(data.remaining_duration))/Number(data.duration)*100))*10000)/10000;
 if(data.percent_complete_type==='步骤'){
  const steps=data.activity_steps||[];if(!Array.isArray(steps)||!steps.length)return 0;
  const weight=steps.reduce((n:number,s:any)=>n+Number(s.weight),0);
  return weight?Math.round(steps.reduce((n:number,s:any)=>n+Number(s.weight)*Number(s.progress),0)/weight*10000)/10000:0;
 }
 return fallback;
}

export function validateDurationHours(duration:number,hoursPerDay:number){if(!Number.isFinite(duration)||Math.abs(duration*hoursPerDay-Math.round(duration*hoursPerDay))>0.000001)throw Error('工期最小单位为整数工作小时');}
