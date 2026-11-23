import {validateEarnedValueSource,earnedValueMetricChecks,earnedValueMethods,type EvmIssue} from '../shared/earned-value-review.ts';
import {version as appVersion} from './version.ts';
import {validateCalendar} from '../shared/project-calendar.ts';
import {compareBaselineVersions} from '../shared/baseline-versions.ts';
import {actualResourceRows} from './actual-resource-data.ts';
import {remainingOverrides,remainingPlan,decorateRemainingResources} from './remaining-plan.ts';
import {remainingCostSummary} from '../shared/remaining-resources.ts';
import {periodBounds} from '../shared/period-bounds.ts';
import {Router} from 'express';import {z} from 'zod';import type pg from 'pg';import {createHash} from 'node:crypto';
import {pool,tx,uid,audit,requestTransaction} from './db.ts';import {access,canManage,operationAllowed,requireThat} from './auth.ts';
import {requireFullPlanRead} from './planning-read-access.ts';import {lockReferenceProject} from './references.ts';
import {id,date,name} from './validation.ts';import {effectiveActivities} from './effective-activities.ts';import {schedule} from './schedule.ts';
import {calendarDate,defaultProjectCalendar} from '../shared/project-calendar.ts';
import {resourceTicks,resourceText} from '../shared/resource-values.ts';
import {budgetPerformance,performanceMetrics,periodDelta} from '../shared/performance.ts';
import {captureBaselineBudget} from './baseline-budget.ts';
export const progressControl=Router();
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Helsinki',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const selection=z.object({baseline_id:id.optional(),data_date:date.optional(),budget_basis:z.enum(['baseline','current']).default('baseline'),eac_method:z.enum(['cpi','remaining_budget','cpi_spi']).default('cpi')}).strict();
const period=selection.extend({name,series:z.enum(['weekly','monthly','custom']),period_start:date,period_end:date,data_date:date}).strict();
async function readPermission(user:string,project:string,c:pg.Pool|pg.PoolClient=pool){const a=await access(user,project,c);await requireFullPlanRead(a,c);return a;}
async function lockedRead(c:pg.PoolClient,user:string,project:string){await lockReferenceProject(c,project);const initial=await access(user,project,c);await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[initial.workspace_id]);await c.query('SELECT id FROM projects WHERE id=$1 FOR SHARE',[project]);return readPermission(user,project,c);}
async function analysis(c:pg.Pool|pg.PoolClient,a:any,input:z.infer<typeof selection>){
 const activities=await effectiveActivities(a.id,c),calendar=a.calendar_config||defaultProjectCalendar;
 const options=(await c.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[a.id])).rows[0]?.options||{};
 const dataDate=input.data_date||options.data_date||today();
 const list=(await c.query('SELECT id,name,created_at,(snapshot ? \'budget_by_activity\') budget_available FROM baselines WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500',[a.id])).rows;
 const key=input.baseline_id||options.baseline_id||list[0]?.id;
 const base=key?(await c.query('SELECT * FROM baselines WHERE project_id=$1 AND id=$2',[a.id,key])).rows[0]:null;
 if(key)requireThat(base,404,'基线不属于当前项目');
 const current=schedule(activities,calendar,a.start_date,a.progress_method);
 const forecast=schedule(activities,calendar,a.start_date,a.progress_method,{...options,forecast_remaining:true,data_date:dataDate});
 const allocationRows=(await c.query(`SELECT x.id,x.activity_id,x.quantity::text,x.planned_cost::text,x.actual_cost::text,x.version,r.id resource_id,r.active,r.rate::text,r.version resource_version
  FROM activity_resource_allocations x JOIN activities act ON act.id=x.activity_id JOIN project_resources r ON r.id=x.resource_id AND r.project_id=act.project_id
  WHERE act.project_id=$1 AND act.id=ANY($2::uuid[]) ORDER BY x.id`,[a.id,activities.map(v=>v.id)])).rows;
 const actual=resourceText(allocationRows.reduce((n,r)=>n+resourceTicks(r.actual_cost),0n));
 const budgets=await captureBaselineBudget(c,a.id,current.activities,a.currency);
 const issues:EvmIssue[]=[];let pvAvailable=true;const warnings:string[]=[];let financial:any={bac:null,pv:null,ev:null,ac:actual,cv:null,sv:null,cpi:null,spi:null,eac:null,etc:null,vac:null,tcpi:null,tcpi_eac:null,eac_method:input.eac_method},coverage=true;
 let referenceActivities:any[],referenceCalendar:any,referenceStart:string,referenceBudgets:any;
 if(input.budget_basis==='current'){
  referenceActivities=current.activities;referenceCalendar=calendar;referenceStart=a.start_date;referenceBudgets=budgets.budget_by_activity;
  warnings.push('当前预算参考模式，不是批准基线预算');
 }else if(base?.snapshot?.budget_by_activity){
  requireThat(!base.snapshot.currency||base.snapshot.currency===a.currency,400,'基线币种与项目不一致');
  referenceActivities=Array.isArray(base.snapshot.activities)?base.snapshot.activities:[];if(!Array.isArray(base.snapshot.activities))issues.push({severity:'error',message:'基线没有有效作业快照，不能计算挣值'});
  if(!base.snapshot.calendar_config||!base.snapshot.start_date){pvAvailable=false;issues.push({severity:'warning',message:'基线未封存日历或起点，PV及SPI不可确定'});coverage=false;}
  if(!base.snapshot.currency){issues.push({severity:'warning',message:'基线未记录币种，预算金额仅作参考'});coverage=false;}
referenceCalendar=base.snapshot.calendar_config||calendar;referenceStart=base.snapshot.start_date||a.start_date;referenceBudgets=base.snapshot.budget_by_activity;
 }else{referenceActivities=[];referenceCalendar=calendar;referenceStart=a.start_date;referenceBudgets=null;warnings.push(base?'此历史基线没有封存预算，不能据当前费用补造历史预算':'尚无批准基线，可明确切换到当前预算参考模式');coverage=false;}
 if(!referenceBudgets){pvAvailable=false;issues.push({severity:'warning',message:'尚无可用预算基准，BAC、PV和EV不可计算'});}
 if(referenceBudgets){
  try{validateCalendar(referenceCalendar,false);if(!/^\d{4}-\d{2}-\d{2}$/.test(referenceStart)||!Number.isFinite(Date.parse(referenceStart)))throw Error('invalid start')}catch{pvAvailable=false;coverage=false;issues.push({severity:'warning',message:'预算日历或起点无效，不能计算计划价值'});}
  issues.push(...validateEarnedValueSource(referenceActivities,referenceBudgets,current.activities,referenceCalendar,referenceStart,pvAvailable));
  if(!issues.some(i=>i.severity==='error')){const v=budgetPerformance(referenceActivities,referenceBudgets,current.activities,referenceCalendar,referenceStart,dataDate,pvAvailable);financial=performanceMetrics(v.bac,v.pv,v.ev,actual,input.eac_method);}
  else coverage=false;
  const referenceIds=new Set(referenceActivities.map(x=>x.id));if(activities.some(x=>!referenceIds.has(x.id)))coverage=false;
 }
 const actualReports=await actualResourceRows(a.id,c,activities.map(x=>x.id));
 if(actualReports.some((r:any)=>r.as_of_date>dataDate)){warnings.push('资源实绩更新晚于统计日期，不能回推封存历史实绩');issues.push({severity:'error',message:'资源实绩更新晚于统计日期，不能回推封存历史实绩'});coverage=false;}
 if(resourceTicks(actual)===0n)warnings.push('尚无实际费用，成本绩效与指数型完工估算可能不可用');
 if(activities.some(x=>x.actual_start&&x.actual_start>dataDate||x.actual_finish&&x.actual_finish>dataDate)){warnings.push('有效实际日期晚于统计日期，不能封存为当期绩效');issues.push({severity:'error',message:'有效实际日期晚于统计日期，不能封存为当期绩效'});coverage=false;}
 if(!activities.length){warnings.push('没有有效作业，不能预测完工或封存绩效');issues.push({severity:'error',message:'没有有效作业，不能预测完工或封存绩效'});coverage=false;}
 const calendarDay=(offset:number)=>calendarDate(a.start_date,Math.floor(offset+1e-8));
 const finish=activities.length?calendarDay(forecast.duration_summary.finish_offset):null,baseFinish=base&&base.snapshot.start_date&&Number.isFinite(Date.parse(base.snapshot.start_date))&&Array.isArray(base.snapshot.activities)&&base.snapshot.activities.length&&base.snapshot.activities.every((x:any)=>x.ef!=null&&Number.isFinite(Number(x.ef)))?calendarDate(base.snapshot.start_date,Math.max(...base.snapshot.activities.map((x:any)=>Number(x.ef)))):null;
 const predicted={finish,current_finish:activities.length?calendarDay(current.duration_summary.finish_offset):null,baseline_finish:baseFinish,variance_days:baseFinish&&finish?Math.round((Date.parse(finish)-Date.parse(baseFinish))/86400000):null,remaining_work_hours:Math.ceil(forecast.activities.reduce((n,x)=>n+x.remaining_duration*calendar.hours_per_day,0)),work_duration_days:Math.ceil(forecast.duration_summary.work_span),method:'remaining_duration_retained_logic',activities:forecast.activities.map(x=>({id:x.id,code:x.code,name:x.name,progress:x.progress,remaining_hours:Math.ceil(x.remaining_duration*calendar.hours_per_day),finish:calendarDay(x.ef),critical:x.critical}))};
 const remaining=await remainingOverrides(a.id,c,activities.map(v=>v.id)),future=remainingPlan(activities,calendar,a.start_date,options,dataDate);
 const futureRows=decorateRemainingResources(allocationRows.map(r=>({rate:r.rate,active:r.active,allocations:[{...r,id:r.id}]})),future,remaining,calendar.hours_per_day).flatMap(r=>r.allocations);
 const resource_forecast={...remainingCostSummary(futureRows),data_date:dataDate,basis:'remaining_resources',overrides:futureRows.filter(r=>r.has_remaining_override).length};
 if(dataDate>today()){coverage=false;issues.push({severity:'warning',message:'未来统计日期只用于计划对照，EV和AC仍是当前确认值，不能封存实际'});}else if(dataDate!==today())issues.push({severity:'info',message:'历史统计日不重建当时实绩，EV和AC采用当前已确认累计值，须核对声明日期'});
 if(financial.bac!==null){if(resourceTicks(financial.bac)===0n)issues.push({severity:'warning',message:'预算总额为零，挣值指数及绩效预测不具通常分析意义'});if(financial.ev!==null&&resourceTicks(financial.ev)===0n&&resourceTicks(actual)>0n)issues.push({severity:'warning',message:'已有实际费用但尚无挣值，请核对进度与费用填报'});if(resourceTicks(actual)===0n)issues.push({severity:'warning',message:'实际费用为零可能是零支出或缺报，不推造实际费用'});if(resourceTicks(actual)>=resourceTicks(financial.bac)&&financial.ev!==null&&resourceTicks(financial.ev)<resourceTicks(financial.bac))issues.push({severity:'warning',message:'预算余额已耗尽且预算工作未完，达到BAC的TCPI不可用'});}
 if(financial.inputs_valid===false){coverage=false;issues.push({severity:'error',message:'挣值基础金额超出有效范围，停止绩效预测'});}
 const financial_review={calculation_version:appVersion,basis:input.budget_basis,calendar:pvAvailable?referenceCalendar?.name||null:null,pv_available:pvAvailable,items:issues,checks:earnedValueMetricChecks(financial),methods:earnedValueMethods(financial),summary:{errors:issues.filter(i=>i.severity==='error').length,warnings:issues.filter(i=>i.severity==='warning').length,information:issues.filter(i=>i.severity==='info').length}};
 for(const item of issues)if(item.severity!=='info'&&!warnings.includes(item.message))warnings.push(item.message);
 const source={appVersion,financial,financial_review,actualReports,remaining,input:{...input,data_date:dataDate},calendar,options,activities:activities.slice().sort((a,b)=>a.id.localeCompare(b.id)),allocations:allocationRows,baseline:base?.id,baseline_snapshot:base?.snapshot,currency:a.currency};
 const hash=createHash('sha256').update(JSON.stringify(source)).digest('hex');
 return {financial_review,resource_forecast,baseline_id:base?.id||null,baseline_name:base?.name||null,baselines:list,data_date:dataDate,currency:a.currency,budget_basis:input.budget_basis,financial,forecast:predicted,warnings,coverage_complete:coverage,can_capture:coverage&&canManage(a)&&operationAllowed(a,'$data','create')&&a.lifecycle==='active'&&a.workspace_lifecycle==='active',source_hash:hash};
}
progressControl.get('/projects/:project/baselines/catalog',async(req,res)=>{const a=await readPermission(req.user.id,id.parse(req.params.project));res.json((await pool.query('SELECT id,name,created_at FROM baselines WHERE project_id=$1 ORDER BY created_at DESC,id DESC',[a.id])).rows);});
progressControl.get('/projects/:project/progress-control',async(req,res)=>{
 const project=id.parse(req.params.project);const result=await tx(c=>requestTransaction.run(c,async()=>{const a=await lockedRead(c,req.user.id,project);const {period_page,...input}=selection.extend({period_page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(req.query);
 const data=await analysis(c,a,input);
 const periods=(await pool.query("SELECT s.id,s.name,s.series,s.period_start,s.period_end,s.data_date,s.revision,s.baseline_id,s.captured_at,s.created_by,s.payload,u.name created_by_name FROM plan_period_snapshots s JOIN users u ON u.id=s.created_by WHERE s.project_id=$1 ORDER BY s.period_end DESC,s.series,s.revision DESC LIMIT 100 OFFSET $2",[a.id,(period_page-1)*100])).rows;
 const total=Number((await pool.query('SELECT count(*) FROM plan_period_snapshots WHERE project_id=$1',[a.id])).rows[0].count);
 return {...data,periods,period_total:total,period_page};}));res.json(result);
});
async function periodPreview(c:pg.Pool|pg.PoolClient,a:any,b:z.infer<typeof period>){
 const bounds=periodBounds(b.data_date,b.series);
 if(b.series!=='custom')requireThat(b.period_start===bounds.start&&b.period_end===bounds.end,400,'周和月期间须符合自然周期，其他范围请选择自定义');
 requireThat(b.period_start<=b.data_date&&b.data_date<=b.period_end,400,'统计日期必须在期间内');requireThat(b.data_date<=today(),400,'不能将未来日期封存为实际期间绩效');
 const selected=selection.parse({baseline_id:b.baseline_id,data_date:b.data_date,budget_basis:b.budget_basis,eac_method:b.eac_method});const data=await analysis(c,a,selected);
 const existing=(await c.query('SELECT id,revision FROM plan_period_snapshots WHERE project_id=$1 AND series=$2 AND period_start=$3 AND period_end=$4 ORDER BY revision DESC LIMIT 1',[a.id,b.series,b.period_start,b.period_end])).rows[0];
 requireThat(!(await c.query('SELECT 1 FROM plan_period_snapshots WHERE project_id=$1 AND series=$2 AND period_start<=$4 AND period_end>=$3 AND NOT(period_start=$3 AND period_end=$4) LIMIT 1',[a.id,b.series,b.period_start,b.period_end])).rowCount,409,'同一周期类型的期间不能重叠');
 const previous=(await c.query('SELECT id,payload FROM plan_period_snapshots WHERE project_id=$1 AND series=$2 AND period_end<$3 ORDER BY period_end DESC,revision DESC LIMIT 1',[a.id,b.series,b.period_start])).rows[0];
 const continuous=previous&&previous.payload.period_end===calendarDate(b.period_start,-1)&&previous.payload.data_date===previous.payload.period_end;
 const comparable=continuous&&previous.payload.budget_basis===data.budget_basis&&previous.payload.baseline_id===data.baseline_id&&previous.payload.currency===data.currency;
 const delta=previous?(comparable?periodDelta(data.financial,previous.payload.financial):{pv:null,ev:null,ac:null}):(a.start_date>=b.period_start?periodDelta(data.financial,{pv:'0.0000',ev:'0.0000',ac:'0.0000'}):{pv:null,ev:null,ac:null});
 if(previous&&!continuous)data.warnings.push('缺少连续的上期末累计快照，不计算本期增量');
 else if(previous&&!comparable)data.warnings.push('前期基线或预算口径不同，不计算期间增量');
 else if(!previous&&a.start_date<b.period_start)data.warnings.push('缺少期初累计快照，首期增量不可确定，仍可封存累计值');
 if(data.budget_basis==='current'&&previous&&previous.payload.financial.bac!==data.financial.bac)data.warnings.push('当前预算参考增量可能包含预算变更影响');
 const payload={...data,period_values:delta,previous_period_id:comparable?previous.id:null,period_start:b.period_start,period_end:b.period_end,series:b.series,name:b.name};
 const source_hash=createHash('sha256').update(JSON.stringify({source:data.source_hash,request:b,previous:previous?.id,revision:existing?.revision||0})).digest('hex');
 return {payload,source_hash,expected_revision:existing?.revision||0,previous_id:existing?.id||null};
}
progressControl.post('/projects/:project/progress-periods/preview',async(req,res)=>{const project=id.parse(req.params.project),input=period.parse(req.body);res.json(await tx(c=>requestTransaction.run(c,async()=>{const a=await lockedRead(c,req.user.id,project);return periodPreview(c,a,input)})));});
progressControl.post('/projects/:project/progress-periods',async(req,res)=>{
 const project=id.parse(req.params.project),b=period.extend({source_hash:z.string().regex(/^[a-f0-9]{64}$/),expected_revision:z.number().int().nonnegative(),confirm_current_data:z.literal(true)}).parse(req.body);
 const result=await tx(async c=>{await lockReferenceProject(c,project);const initial=await access(req.user.id,project,c);await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[initial.workspace_id]);await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);const a=await readPermission(req.user.id,project,c);requireThat(canManage(a)&&operationAllowed(a,'$data','create'));requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目非活动状态');
 const request=period.parse(Object.fromEntries(Object.keys(period.shape).filter(k=>Object.hasOwn(b,k)).map(k=>[k,(b as any)[k]])));
 const preview=await periodPreview(c,a,request);requireThat(preview.expected_revision===b.expected_revision,409,'期间版本已变化，请重新预览');requireThat(preview.source_hash===b.source_hash,409,'计划或费用已变化，请重新预览');requireThat(preview.payload.coverage_complete,409,'有效作业或基线预算不完整，不能封存');
 const key=uid();await c.query('INSERT INTO plan_period_snapshots(id,project_id,series,name,period_start,period_end,data_date,revision,previous_id,previous_period_id,baseline_id,source_hash,payload,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[key,project,b.series,b.name,b.period_start,b.period_end,b.data_date,b.expected_revision+1,preview.previous_id,preview.payload.previous_period_id,preview.payload.baseline_id,preview.source_hash,JSON.stringify(preview.payload),req.user.id]);
 await audit(c,a.workspace_id,req.user.id,'封存项目期间绩效',key,{name:b.name,data_date:b.data_date,series:b.series,period_start:b.period_start,period_end:b.period_end,revision:b.expected_revision+1,previous_id:preview.previous_id});return {id:key,revision:b.expected_revision+1};});res.status(201).json(result);
});

progressControl.get('/projects/:project/baselines/compare',async(req,res)=>{
 const project=id.parse(req.params.project),page=z.coerce.number().int().min(1).max(100000).parse(req.query.page||1),search=z.string().max(200).parse(req.query.search||''),filter=z.enum(['all','changed','added','baseline_only']).parse(req.query.filter||'all');
 const selected=z.array(id).max(3).parse(typeof req.query.ids==='string'?req.query.ids.split(',').filter(Boolean):[]);requireThat(new Set(selected).size===selected.length,400,'比较基线不能重复');
 const result=await tx(c=>requestTransaction.run(c,async()=>{
 await lockReferenceProject(c,project);
 const a=await readPermission(req.user.id,project,c),opts=(await c.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[project])).rows[0]?.options||{};
 const custom=z.enum(['custom','project']).parse(req.query.selection||'project');
 const ids=custom==='custom'||selected.length?selected:[...new Set((opts.comparison_baseline_ids||[]).filter(Boolean))] as string[];
 const bases=(await c.query('SELECT id,name,created_at,snapshot FROM baselines WHERE project_id=$1 AND id=ANY($2::uuid[])',[project,ids])).rows;requireThat(bases.length===ids.length,404,'基线不属于当前项目');
 const activities=await effectiveActivities(project,c),calendar=a.calendar_config||defaultProjectCalendar,plan=schedule(activities,calendar,a.start_date,a.progress_method,opts),budget=await captureBaselineBudget(c,project,plan.activities,a.currency);
 const versions=compareBaselineVersions({...plan,start_date:a.start_date,calendar_config:calendar},ids.map(key=>bases.find(b=>b.id===key)),budget.budget_by_activity,a.currency).map(v=>{
 const rows=v.rows.filter(r=>(!search||(r.code+' '+r.name+' '+(r.baseline_code||'')+' '+(r.baseline_name||'')).toLowerCase().includes(search.toLowerCase()))&&(filter==='all'||filter==='added'&&r.status==='新增作业'||filter==='baseline_only'&&r.status==='仅基线存在'||filter==='changed'&&(r.status!=='对应作业'||r.start_variance!==0||r.finish_variance!==0||r.budget_variance!==null&&Number(r.budget_variance)!==0||r.code!==r.baseline_code||r.name!==r.baseline_name||r.current_duration_hours!==r.baseline_duration_hours)));
 return {...v,total:rows.length,rows:rows.slice((page-1)*100,page*100)};
 });return {versions,page,page_size:100,currency:a.currency,project_baseline_id:opts.baseline_id||null,comparison_baseline_ids:opts.comparison_baseline_ids||[null,null,null],formal:true};
 }));res.json(result);
});
