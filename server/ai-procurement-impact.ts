import {confirmedInstallationReadiness} from '../shared/procurement-readiness.ts';
import type {Request} from 'express';import {createHash} from 'node:crypto';import {pool,requestTransaction} from './db.ts';import {access,tableAccess,visibleColumns,projectRecord,rowAllowed,requireThat} from './auth.ts';import {requireFullPlanRead} from './planning-read-access.ts';import {effectiveActivities} from './effective-activities.ts';import {readPlanActivities} from './plan-activities.ts';import {defaultProjectCalendar} from '../shared/project-calendar.ts';import {simulateProcurementAvailability} from './procurement-simulation.ts';import {procurementImpactAnswer} from '../shared/procurement-impact-answer.ts';
export type ProcurementImpactInput={table_id?:string;record_id?:string;availability_date?:string;scenario_basis?:string;preparation_work_hours?:number;delivery_activity_id?:string};
// User decision: confirmed installation readiness is required for numeric delay analysis.
export async function procurementImpact(req:Request,project:string,input:ProcurementImpactInput){
 const shared=requestTransaction.getStore(),c=shared||await pool.connect();try{if(!shared)await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const out=await requestTransaction.run(c,()=>calculate(req,project,input));if(!shared)await c.query('COMMIT');return out;}catch(e){if(!shared)await c.query('ROLLBACK');throw e}finally{if(!shared)c.release()}
}
async function calculate(req:Request,project:string,b:ProcurementImpactInput){
 const user=req.user.id,a=await access(user,project);requireThat(b.table_id&&b.record_id,400,'请先检索并选择采购、订单、进场或物资需求记录');
 const registry=(await pool.query("SELECT template_key,object_id FROM project_business_templates WHERE project_id=$1 AND kind='table'",[project])).rows;
 const kinds=new Map(registry.map(r=>[r.object_id,r.template_key]));const rootKind=kinds.get(b.table_id!);requireThat(['procurement','purchase_orders','arrivals','purchase_requests','material_demands'].includes(rootKind),400,'起点须是当前项目真实绑定的采购、订单、进场、采购申请或物资需求表；不按同名普通表猜测');
 const activityTable=(await pool.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1',[project])).rows[0]?.table_id;
 const missing:string[]=[],assumptions:string[]=[],source_records:any[]=[],chain:any[]=[],targets=new Set<string>(),seen=new Set<string>();let date_basis='',readyDate='',nodes=0;const dates:any[]=[];let rootName='';
 const transitions:Record<string,string[]>={procurement:['order_ref'],arrivals:['order_ref'],purchase_orders:['request_ref'],purchase_requests:['demand_ref'],material_demands:[]};
 const expected:Record<string,string>={order_ref:'purchase_orders',request_ref:'purchase_requests',demand_ref:'material_demands'};
 async function visit(tableId:string,recordId:string,depth:number,parent?:{name:string;relation:string;key:string}){
  if(seen.has(recordId))return;seen.add(recordId);if(++nodes>40||depth>5){missing.push('采购关联链超出40记录或5层范围，不能对不完整链给出整体影响');return;}
  let t:any;try{t=await tableAccess(user,tableId);requireThat(t.table.project_id===project,403,'跨项目关联不可用于当前试算');}catch{missing.push('某个关联对象不可读取或不属于当前项目');return;}
  const r=(await pool.query("SELECT * FROM records WHERE id=$1 AND table_id=$2 AND lifecycle='active'",[recordId,tableId])).rows[0];if(!r||!rowAllowed(t.permission,r,user)){missing.push('某个关联记录不可见、已移除或不存在');return;}
  const columns=visibleColumns(t.permission,t.table),data=projectRecord(t.permission,t.table,r).data;const label=String(data.name||data.code||'记录');if(!rootName)rootName=t.table.name+' / '+label;
  const key=tableId+':'+recordId;const current={key,table_id:tableId,record_id:recordId,table:t.table.name,name:label,status:r.status,version:r.version};source_records.push(current);if(parent)chain.push({from:parent.name,to:t.table.name+' / '+label,relation:parent.relation,from_key:parent.key,to_key:key});
  if(r.status!=='approved'){missing.push(t.table.name+' / '+label+' 尚未确认有效，不参与正式影响试算');return;}
  const kind=kinds.get(tableId);
  if(data.installation_ready_date&&typeof data.readiness_basis==='string'&&data.readiness_basis.trim())dates.push({kind:'confirmed',date:data.installation_ready_date,basis:t.table.name+' / '+label+' 的安装就绪确认：'+String(data.readiness_basis).slice(0,300)});
  if(kind==='procurement'&&data.forecast_arrival)dates.push({kind:'arrival',date:data.forecast_arrival,basis:'预计到货日期，不是安装就绪事实'});
  if(kind==='purchase_orders'&&data.promised_date)dates.push({kind:'arrival',date:data.promised_date,basis:'供应商承诺到货日期，不是安装就绪事实'});
  if(kind==='arrivals'){if(data.arrival_date)dates.push({kind:'arrival',date:data.arrival_date,basis:'实际到货日期，不是安装就绪事实'});if(data.inspection_state!=='合格')missing.push('进场验收状态尚未核实为合格，不能认定已可安装');}
  const activity=columns.find((f:any)=>f.id==='activity_ref'&&f.type==='reference'&&f.target_table===activityTable);
  if(activity){for(const id of (Array.isArray(data[activity.id])?data[activity.id]:[])){targets.add(id);chain.push({from:t.table.name+' / '+label,to:'关联安装作业（待排程核对）',relation:activity.name,target_record:id,from_key:key,to_key:activityTable+':'+id});}}
  for(const field of transitions[kind]||[]){const f=columns.find((f:any)=>f.id===field&&f.type==='reference'&&kinds.get(f.target_table)===expected[field]);if(!f)continue;const values=Array.isArray(data[field])?data[field]:[];if(values.length>10){missing.push('单项关联超过10条，请明确供货批次后分组分析');continue;}for(const id of values)await visit(f.target_table,id,depth+1,{name:t.table.name+' / '+label,relation:f.name,key});}
 }
 await visit(b.table_id!,b.record_id!,0);
 const readiness=confirmedInstallationReadiness(dates);readyDate=readiness.date;date_basis=readiness.basis;missing.push(...readiness.missing);
 if(b.availability_date&&b.availability_date!==readyDate)missing.push('指定日期不能替代记录中已确认的安装就绪日期；请先补齐确认依据');
 if(!targets.size)missing.push('没有找到明确关联到真实作业数据表的安装作业；不得仅凭材料名称或WBS范围猜测');
 if(targets.size>20)missing.push('关联安装作业超过20项，请拆分采购批次');
 let fullRead=true;try{await requireFullPlanRead(a);}catch{fullRead=false;missing.push('当前账号缺少完整计划的全部行列读取权限，不能推断项目交付日期');}
 const base={source:rootName,read_only:true,source_records,chain,assumptions,date_basis,missing:[...new Set(missing)]};
 if(base.missing.length||!fullRead){const out={...base,status:'incomplete',simulation:null};return {...out,readable_summary:procurementImpactAnswer(out),visualization:impactVisualization(out)};}
 const rows=await effectiveActivities(project),linked=(await pool.query('SELECT p.activity_id,p.record_id,r.version FROM plan_activity_records p JOIN records r ON r.id=p.record_id WHERE p.activity_id=ANY($1::uuid[])',[rows.map(r=>r.id)])).rows;const byRecord=new Map(linked.map(x=>[x.record_id,x.activity_id]));const ids=[...targets].map(r=>byRecord.get(r));
 if(ids.some(id=>!id)){base.missing.push('关联作业存在草稿、失效或未就绪依赖，尚未纳入正式有效计划');const out={...base,status:'incomplete',simulation:null};return {...out,readable_summary:procurementImpactAnswer(out),visualization:impactVisualization(out)};}
 const policy=(await pool.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[project])).rows[0]?.options||{};
 const visible=await readPlanActivities(user,a,true);if(visible.length>rows.length)base.assumptions.push('部分可见草稿/未就绪作业不在正式计划中，本试算只覆盖已建有效逻辑。');
 const sim=simulateProcurementAvailability(rows,ids as string[],readyDate,a.calendar_config||defaultProjectCalendar,a.start_date,a.progress_method,policy,b.preparation_work_hours||0,b.delivery_activity_id);
 for(const e of chain)if(e.target_record){const target=rows.find(r=>r.id===byRecord.get(e.target_record));e.to=target?target.code+' · '+target.name:'未就绪安装作业';delete e.target_record;}
 const source_hash=createHash('sha256').update(JSON.stringify({sources:source_records,rows,calendar:a.calendar_config,policy,readyDate,release:b.preparation_work_hours,delivery:b.delivery_activity_id})).digest('hex');
 const activity_refs=linked.map(x=>{const row=rows.find(r=>r.id===x.activity_id)!;return {key:activityTable+':'+x.record_id,table_id:activityTable,record_id:x.record_id,version:x.version,code:row.code,name:row.name}});
 const out={...base,activity_refs,simulation:sim,status:sim.status,missing:[...base.missing,...sim.missing],source_hash};return {...out,readable_summary:procurementImpactAnswer(out),visualization:impactVisualization(out)};
}

function impactVisualization(out:any){
 const nodes=out.source_records.map((r:any)=>({key:r.key,label:r.table+' / '+r.name,kind:'source',status:r.status,version:r.version,table_id:r.table_id,record_id:r.record_id}));
 const refs=out.activity_refs||[],byCode=new Map(refs.map((r:any)=>[r.code,r]));const changes=new Map((out.simulation?.changes||[]).map((r:any)=>[r.code,r]));
 const used=new Set([...out.chain.filter((e:any)=>e.target_record).map((e:any)=>e.to_key),...out.chain.map((e:any)=>e.to_key)]);
 for(const e of out.simulation?.links||[])for(const code of [e.from,e.to]){const r:any=byCode.get(code);if(r)used.add(r.key);}
 for(const r of refs)if(used.has(r.key)){const ch:any=changes.get(r.code);nodes.push({...r,label:r.code+' · '+r.name,kind:ch?'changed':'activity',before:ch?.before_finish,after:ch?.after_finish,shift:ch?.finish_shift_hours});}
 const edges=out.chain.map((e:any)=>({from:e.from_key,to:e.to_key,label:e.relation,kind:'reference'}));
 for(const e of out.simulation?.links||[]){const a:any=byCode.get(e.from),b:any=byCode.get(e.to);if(a&&b)edges.push({from:a.key,to:b.key,label:e.type+' / '+e.lag_hours+'h',kind:'logic'});}
 const limited=nodes.slice(0,100),keys=new Set(limited.map((n:any)=>n.key));return {title:'采购—安装—交付影响路径',nodes:limited,edges:edges.filter((e:any)=>keys.has(e.from)&&keys.has(e.to)),missing:out.missing,status:out.status,notice:'箭头表示显式引用或作业逻辑，红色只表示本次试算日期变化；不是因果责任认定。仅展示已读范围，未绘制不代表不存在。',truncated:nodes.length>100||!!out.simulation?.coverage?.links_truncated};
}
