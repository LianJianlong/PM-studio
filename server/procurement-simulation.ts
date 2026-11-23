import {schedule,type Activity} from './schedule.ts';import {isLoe} from '../shared/loe.ts';import {calendarHours,calendarDate,type ProjectCalendar} from '../shared/project-calendar.ts';import type {ScheduleOptions} from '../shared/p6-planning.ts';
/** Counterfactual lower-bound availability constraint. No records, dates or options are persisted. */
export function simulateProcurementAvailability(rows:Activity[],targetIds:string[],readyDate:string,calendar:ProjectCalendar,start:string,method:'duration'|'equal'='duration',options:ScheduleOptions={},releaseHours=0,deliveryId?:string){
 if(!Number.isInteger(releaseHours)||releaseHours<0||releaseHours>87600)throw Error('就绪准备时长须为非负整数工作小时');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(readyDate)||new Date(readyDate+'T00:00:00Z').toISOString().slice(0,10)!==readyDate)throw Error('就绪日期无效');
 if(rows.length>5000)throw Error('试算最多5000个有效作业，请使用专门排程分析');
 const before=schedule(rows,calendar,start,method,options),byId=new Map(rows.map(r=>[r.id,r]));
 if(!targetIds.length||new Set(targetIds).size!==targetIds.length||targetIds.some(id=>!byId.has(id)))throw Error('关联安装作业未就绪、未确认有效或不属于完整计划');
 if(deliveryId&&(!byId.has(deliveryId)||isLoe(byId.get(deliveryId)!)))throw Error('指定交付节点不是有效实体作业');
 const missing:string[]=[];
 for(const id of targetIds){const r=byId.get(id)!;if(isLoe(r))missing.push(r.code+' 为LOE支持作业，不能直接施加供货制约');if(r.actual_finish||Number(r.progress)===100)missing.push(r.code+' 已完成，不能改写实际历史，请复核采购与作业关联');else if((r.actual_start||Number(r.progress)>0)&&(!options.forecast_remaining||!options.data_date))missing.push(r.code+' 已开工，需先有有效状态日期及剩余工期重排，不能按整项工期推迟');}
 if(before.progress_quality?.blocking_count)missing.push('当前计划存在进度数据阻断项，应先修正实际与剩余数据');
 if(missing.length)return {status:'blocked' as const,missing,read_only:true};
 const dayOffset=readyDate>=start?calendarHours(calendar,start,readyDate)/calendar.hours_per_day:-calendarHours(calendar,readyDate,start)/calendar.hours_per_day;
 const gate=Math.max(0,dayOffset)+releaseHours/calendar.hours_per_day,targets=new Set(targetIds);
 const changed=rows.map(r=>targets.has(r.id)?{...r,start_offset:Math.max(Number(r.start_offset||0),gate)}:r);
 const after=schedule(changed,calendar,start,method,options);const old=new Map(before.activities.map(a=>[a.id,a]));
 for(const a of after.activities.filter(a=>targets.has(a.id))){const begin=a.actual_start&&options.forecast_remaining?a.work_ef-a.remaining_duration:a.work_es;if(begin<gate-1e-7)missing.push(a.code+' 的强制日期/实际历史与就绪下界冲突，不能认定试算可执行');}
 if(after.logic_violations.length)missing.push('试算存在未满足的作业逻辑，需先处理日期约束或实际历史冲突');
 if(after.constraint_diagnostics.some(x=>x.blocking))missing.push('试算存在强制日期约束阻断项');
 if(missing.length)return {status:'blocked' as const,missing,read_only:true};
 const baseEnd=deliveryId?before.activities.find(a=>a.id===deliveryId)!:null,newEnd=deliveryId?after.activities.find(a=>a.id===deliveryId)!:null;
 const baseWork=baseEnd?.work_ef??before.work_duration,newWork=newEnd?.work_ef??after.work_duration,baseOffset=baseEnd?.ef??before.duration,newOffset=newEnd?.ef??after.duration;
 const changedRows=after.activities.filter(a=>{const p=old.get(a.id)!;return Math.abs(a.work_es-p.work_es)>1e-7||Math.abs(a.work_ef-p.work_ef)>1e-7}).map(a=>{const p=old.get(a.id)!;return {id:a.id,code:a.code,name:a.name,installation:targets.has(a.id),before_start:calendarDate(start,p.es),after_start:calendarDate(start,a.es),before_finish:calendarDate(start,p.ef),after_finish:calendarDate(start,a.ef),finish_shift_hours:Math.round((a.work_ef-p.work_ef)*calendar.hours_per_day),before_float_hours:Math.round(p.float*calendar.hours_per_day),after_float_hours:Math.round(a.float*calendar.hours_per_day),critical_before:p.critical,critical_after:a.critical};});
 const reachable=new Set(targetIds);for(let i=0;i<rows.length;i++){let grew=false;for(const r of rows)if(!reachable.has(r.id)&&r.predecessors.some(p=>reachable.has(p.id))){reachable.add(r.id);grew=true;}if(!grew)break;}
 const links=rows.flatMap(r=>r.predecessors.filter(p=>reachable.has(p.id)&&reachable.has(r.id)).map(p=>({from:byId.get(p.id)!.code,from_name:byId.get(p.id)!.name,to:r.code,to_name:r.name,type:p.type,lag_hours:Math.round(p.lag*calendar.hours_per_day)})));
 return {status:'computed' as const,read_only:true,ready_date:readyDate,preparation_work_hours:releaseHours,calendar:calendar.name,hours_per_day:calendar.hours_per_day,
  delivery_basis:baseEnd?baseEnd.code+' · '+baseEnd.name:'有效计划最晚完成时点（不是合同交付承诺）',delivery_reachable:deliveryId?reachable.has(deliveryId):null,
  before_finish:calendarDate(start,baseOffset),after_finish:calendarDate(start,newOffset),finish_shift_work_hours:Math.round((newWork-baseWork)*calendar.hours_per_day),finish_shift_calendar_dates:Math.round((Date.parse(calendarDate(start,newOffset))-Date.parse(calendarDate(start,baseOffset)))/86400000),
  affected_count:changedRows.length,changes:changedRows.slice(0,60),links:links.slice(0,60),coverage:{activities:rows.length,changed:changedRows.length,shown:Math.min(60,changedRows.length),links:links.length,links_truncated:links.length>60,changes_truncated:changedRows.length>60},
  assumptions:['其他作业工期、逻辑、日历、实际记录及排程设置不变；仅增加供货就绪下界','未做资源自动平衡、赶工或费用测算；多个单项情景不能相加作为联合影响'],missing:[]};
}
