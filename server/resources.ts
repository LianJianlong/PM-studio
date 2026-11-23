import {actualResourceRows} from './actual-resource-data.ts';
import {actualRemainingUnits,actualRemainingDuration} from '../shared/actual-remaining.ts';
import {remainingOverrides,remainingPlan,decorateRemainingResources} from './remaining-plan.ts';
import {remainingCostSummary} from '../shared/remaining-resources.ts';
import {lockReferenceProject} from './references.ts';
import {progressCosts} from '../shared/plan-progress.ts';
import {BATCH_DELETE_LIMIT} from '../shared/batch-limits.ts';
import {requireFullPlanRead} from './planning-read-access.ts';
import {effectiveActivities} from './effective-activities.ts';
import {activityResourceRows} from "../shared/activity-resources.ts";
import { applyResourceChange } from "./resource-changes.ts";
import { Router } from "express";
import { z } from "zod";
import { pool, tx, audit, uid } from "./db.ts";
import { access, canManage, canWrite, operationAllowed, requireThat } from "./auth.ts";
import { id, name } from "./validation.ts";
import {
  resourceValue,
  resourceTicks,
  resourceText,
  distributeResourceByMinutes,
  resourceCost,resourceUnits,
  calendarCapacity,
} from "../shared/resource-values.ts";
import { schedule } from "./schedule.ts";
import {
  defaultProjectCalendar,
  workingDateMinutes,
  calendarDate,
  calendarPeriods,
  minute,
} from "../shared/project-calendar.ts";

export const resources = Router();
const exact = (maximum: string) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    try {
      return resourceValue(value, maximum);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
      return z.NEVER;
    }
  });
export const resourceSchema = z.object({
  custom_values:z.record(z.string().regex(/^custom_[0-9a-f]{32}$/),z.string().max(10000)).optional(),
  insert_before:id.optional(),
  code: z.string().trim().max(40).default(''),
  kind: z.enum(["human", "equipment", "material", "expense"]),
  name,
  unit: z.string().max(30).default(""),
  rate: exact("1000000000000").default("0.0000"),
  capacity: exact("1000000000000").default("0.0000"),
  productivity: exact("1000000000000").optional(),
  configuration: z.string().max(4000).optional(),
  currency:z.string().regex(/^[A-Z]{3}$/).optional(),
  sale_rate: exact("1000000000000").optional(),
  tax_rate: exact("100").optional(),
  stock_quantity: exact("1000000000000").optional(),
  productivity_unit: z.string().max(60).optional(),
  version: z.number().int().optional(),
});
async function checkResourceFields(c:Parameters<Parameters<typeof tx>[0]>[0],project:string,values:Record<string,string>|undefined){
  if(!values)return;
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':resource-columns',0))",[project]);
  const fields=(await c.query("SELECT planning_settings->'resource_columns' fields FROM projects WHERE id=$1",[project])).rows[0]?.fields||[];
  requireThat(Object.keys(values).every(key=>fields.some((f:any)=>f.key===key)),400,'资源表包含未定义的字段');
}
const allocation = z.object({
  resource_version:z.number().int().positive().optional(),activity_version:z.number().int().positive().optional(),activity_record_version:z.number().int().positive().optional(),
  version: z.number().int().min(0).optional(),
  reason: z.string().trim().max(1000).optional(),
  resource_id: id,
  quantity: exact("1000000000000"),
  planned_cost: exact("1000000000000000").optional(),
  actual_cost: exact("1000000000000000").optional(),
});

resources.get("/projects/:project/resources", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(operationAllowed(a,'$data','read'),403,'没有项目资源费用读取权限');
  await requireFullPlanRead(a);
  const effective=await effectiveActivities(a.id);
  const rows = await pool.query(
    `SELECT r.*, COALESCE(json_agg(json_build_object('id',ar.id,'activity_id',ar.activity_id,'quantity',ar.quantity::text,'version',ar.version,'planned_cost',ar.planned_cost::text,'actual_cost',ar.actual_cost::text)) FILTER (WHERE ar.id IS NOT NULL),'[]') allocations
     FROM project_resources r LEFT JOIN activity_resource_allocations ar ON ar.resource_id=r.id AND ar.activity_id=ANY($2::uuid[])
     WHERE r.project_id=$1 GROUP BY r.id ORDER BY r.kind,r.name`,
    [a.id,effective.map(v=>v.id)],
  );
  res.json(rows.rows);
});

resources.post("/projects/:project/resources", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(canWrite(a)&&operationAllowed(a,"$data","create"));
  const body = resourceSchema.parse(req.body),
    resourceId = uid();
  await tx(async (c) => {
    await checkResourceFields(c,a.id,body.custom_values);
    let rowPosition:string|null=null;
    if(body.insert_before){
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':resource-code',0))",[a.id]);
      const anchor=(await c.query("SELECT coalesce(row_position,grid_base_position(created_at,id)) pos FROM project_resources WHERE id=$1 AND project_id=$2 AND active",[body.insert_before,a.id])).rows[0];
      requireThat(anchor,409,'插入位置对应的行已变更或不可见');
      rowPosition=(await c.query(`SELECT coalesce(max(pos)+($2::numeric-max(pos))*0.5,$2::numeric-1) pos FROM
       (SELECT coalesce(row_position,grid_base_position(created_at,id)) pos FROM project_resources WHERE project_id=$1 AND active) r WHERE pos<$2::numeric`,[a.id,anchor.pos])).rows[0].pos;
    }
    await c.query(
      "INSERT INTO project_resources(id,project_id,kind,name,unit,rate,capacity,productivity,configuration,code,row_position,custom_values) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)",
      [
        resourceId,
        a.id,
        body.kind,
        body.name,
        body.unit,
        body.rate,
        body.capacity,
        body.productivity || "0",
        body.configuration || "",
        body.code,
        rowPosition,JSON.stringify(body.custom_values||{}),
      ],
    );
    await c.query('UPDATE project_resources SET sale_rate=$1,tax_rate=$2,stock_quantity=$3,productivity_unit=$4 WHERE id=$5',[body.sale_rate||'0',body.tax_rate||'0',body.stock_quantity||'0',body.productivity_unit||'',resourceId]);
    await c.query('UPDATE project_resources SET currency=$1 WHERE id=$2',[body.currency||a.currency||'CNY',resourceId]);
    await audit(c, a.workspace_id, req.user.id, "新增计划资源", resourceId);
  });
  res.status(201).json({ id: resourceId, generated:{code:(await pool.query('SELECT code FROM project_resources WHERE id=$1',[resourceId])).rows[0]?.code} });
});


async function importResources(c:Parameters<Parameters<typeof tx>[0]>[0],a:any,items:z.infer<typeof resourceSchema>[]) {
  const ids:string[]=[];
  for(const r of items){
    await checkResourceFields(c,a.id,r.custom_values);
    const key=uid();
    await c.query(`INSERT INTO project_resources(id,project_id,kind,name,unit,rate,capacity,productivity,configuration,code,custom_values,sale_rate,tax_rate,stock_quantity,productivity_unit,currency)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
      [key,a.id,r.kind,r.name,r.unit,r.rate,r.capacity,r.productivity||'0',r.configuration||'',r.code,JSON.stringify(r.custom_values||{}),r.sale_rate||'0',r.tax_rate||'0',r.stock_quantity||'0',r.productivity_unit||'',r.currency||a.currency||'CNY']);
    ids.push(key);
  }
  return ids;
}
resources.post('/projects/:project/resources/import',async(req,res)=>{
  const items=z.array(resourceSchema).min(1).max(500).parse(req.body.rows);
  const result=await tx(async c=>{
    const a=await access(req.user.id,id.parse(req.params.project),c);
    requireThat(canWrite(a)&&operationAllowed(a,'$data','create')&&a.lifecycle==='active'&&a.workspace_lifecycle==='active');
    const ids=await importResources(c,a,items);
    await audit(c,a.workspace_id,req.user.id,'导入计划资源',a.id,{count:ids.length});return ids;
  });
  res.status(201).json({count:result.length});
});
resources.post('/projects/:project/resources/transfer',async(req,res)=>{
  const source=id.parse(req.params.project),body=z.object({target:id,ids:z.array(id).min(1).max(500),action:z.enum(['copy','move']),recode:z.boolean().default(false)}).strict().parse(req.body);
  requireThat(source!==body.target&&new Set(body.ids).size===body.ids.length,400,'请选择不同的目标项目及不重复的资源');
  const count=await tx(async c=>{
    const ordered=[source,body.target].sort();
    for(const lock of ['resource-columns','resource-code'])for(const key of ordered)await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2,0))",[key,lock]);
    const from=await access(req.user.id,source,c),to=await access(req.user.id,body.target,c);
    requireThat([from,to].every(a=>canManage(a)&&a.lifecycle==='active'&&a.workspace_lifecycle==='active'));
    const rows=(await c.query('SELECT * FROM project_resources WHERE project_id=$1 AND id=ANY($2::uuid[]) AND active ORDER BY id FOR UPDATE',[source,body.ids])).rows;
    requireThat(rows.length===body.ids.length,409,'资源已改变，请重新选择');
    if(body.action==='move')requireThat(!(await c.query('SELECT 1 FROM activity_resource_allocations WHERE resource_id=ANY($1::uuid[]) LIMIT 1',[body.ids])).rowCount,409,'已分配给作业的资源只能复制');
    const missingFields=[...new Set(rows.flatMap(r=>Object.keys(r.custom_values||{})))];
    if(missingFields.length){
      const sourceFields=(await c.query("SELECT planning_settings->'resource_columns' AS fields FROM projects WHERE id=$1",[source])).rows[0]?.fields||[];
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':resource-columns',0))",[to.id]);
      const config=(await c.query('SELECT planning_settings FROM projects WHERE id=$1 FOR NO KEY UPDATE',[to.id])).rows[0].planning_settings||{};
      const targetFields=config.resource_columns||[];
      const additions=sourceFields.filter((f:any)=>missingFields.includes(f.key)&&!targetFields.some((x:any)=>x.key===f.key));
      requireThat(targetFields.length+additions.length<=36,409,'目标资源池自定义列已达上限');
      if(additions.length)await c.query('UPDATE projects SET planning_settings=$2 WHERE id=$1',[to.id,JSON.stringify({...config,resource_columns:[...targetFields,...additions.map((f:any)=>({...f,anchor:'currency',side:'right'}))]})]);
    }
    const items=rows.map(r=>resourceSchema.parse({...r,code:body.recode?'':r.code}));
    const ids=await importResources(c,to,items);
    if(body.action==='move')await c.query('UPDATE project_resources SET active=false,version=version+1 WHERE project_id=$1 AND id=ANY($2::uuid[])',[source,body.ids]);
    await audit(c,from.workspace_id,req.user.id,'转移计划资源',source,{target:to.id,count:ids.length,action:body.action});
    if(to.workspace_id!==from.workspace_id)await audit(c,to.workspace_id,req.user.id,'接收跨空间资源',to.id,{source,count:ids.length});
    return ids.length;
  });
  res.status(201).json({count});
});
resources.put("/projects/:project/resources/:resource", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(canWrite(a)&&operationAllowed(a,"$data","update"));
  requireThat(
    req.body.version !== undefined,
    409,
    "更新资源必须携带版本，请刷新",
  );
  const resourceId = id.parse(req.params.resource),
    body = resourceSchema.parse(req.body);
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await checkResourceFields(c,a.id,body.custom_values);
    const updated = await c.query(
      "UPDATE project_resources SET kind=$1,name=$2,unit=$3,rate=$4,capacity=$5,productivity=COALESCE($8,productivity),configuration=COALESCE($9,configuration),version=version+1,code=COALESCE(NULLIF($11,''),code),custom_values=custom_values||$12::jsonb WHERE id=$6 AND project_id=$7 AND active=true AND ($10::int IS NULL OR version=$10) RETURNING id",
      [
        body.kind,
        body.name,
        body.unit,
        body.rate,
        body.capacity,
        resourceId,
        a.id,
        body.productivity,
        body.configuration,
        body.version,
        body.code,
        JSON.stringify(body.custom_values||{}),
      ],
    );
    if (!updated.rowCount) {
      const existing = await c.query(
        "SELECT 1 FROM project_resources WHERE id=$1 AND project_id=$2 AND active=true",
        [resourceId, a.id],
      );
      requireThat(existing.rowCount, 404, "资源不存在或已停用");
      requireThat(false, 409, "资源已更新，请刷新");
    }
    await c.query('UPDATE project_resources SET sale_rate=COALESCE($1,sale_rate),tax_rate=COALESCE($2,tax_rate),stock_quantity=COALESCE($3,stock_quantity),productivity_unit=COALESCE($4,productivity_unit) WHERE id=$5',[body.sale_rate,body.tax_rate,body.stock_quantity,body.productivity_unit,resourceId]);
    if(body.currency){requireThat(!(await c.query('SELECT 1 FROM project_resources r WHERE r.id=$1 AND r.currency<>$2 AND (EXISTS(SELECT 1 FROM activity_resource_allocations WHERE resource_id=r.id))',[resourceId,body.currency])).rowCount,409,'已有分配的资源不能改变币种');await c.query('UPDATE project_resources SET currency=$1 WHERE id=$2',[body.currency,resourceId]);}
    await audit(c, a.workspace_id, req.user.id, "更新计划资源", resourceId);
  });
  res.json({ ok: true, generated:{code:(await pool.query('SELECT code FROM project_resources WHERE id=$1',[resourceId])).rows[0]?.code} });
});

async function deactivateResources(user:string,project:string,requested:{id:string;version?:number}[]){
  const keys=requested.map(r=>r.id);
  requireThat(new Set(keys).size===keys.length,400,'删除列表不能重复');
  await tx(async c=>{
    await c.query("SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE",[project]);
    const a=await access(user,project,c);
    requireThat(canManage(a)&&a.lifecycle==='active'&&a.workspace_lifecycle==='active');
    const rows=(await c.query("SELECT id,version FROM project_resources WHERE project_id=$1 AND id=ANY($2::uuid[]) AND active ORDER BY id FOR UPDATE",[project,keys])).rows;
    requireThat(rows.length===keys.length,404,'部分资源不存在或已停用，请刷新');
    const versions=new Map(requested.map(r=>[r.id,r.version]));
    requireThat(rows.every(r=>versions.get(r.id)===undefined||versions.get(r.id)===r.version),409,'部分资源已更新，请刷新后重新选择');
    requireThat(!(await c.query("SELECT 1 FROM activity_resource_allocations WHERE resource_id=ANY($1::uuid[]) LIMIT 1",[keys])).rowCount,409,'请先解除资源分配，再停用资源');
    await c.query("UPDATE project_resources SET active=false,version=version+1 WHERE id=ANY($1::uuid[]) AND project_id=$2",[keys,project]);
    for(const key of keys)await audit(c,a.workspace_id,user,'停用计划资源',key);
  });
}
resources.delete("/projects/:project/resources/:resource",async(req,res)=>{
  const body=z.object({version:z.number().int().positive().optional()}).parse(req.body||{});await deactivateResources(req.user.id,id.parse(req.params.project),[{id:id.parse(req.params.resource),version:body.version}]);
  res.json({ok:true});
});
resources.post("/projects/:project/resources/batch-deactivate",async(req,res)=>{
  const project=id.parse(req.params.project);
  const {records}=z.object({records:z.array(z.object({id,version:z.number().int().positive()}).strict()).min(1).max(BATCH_DELETE_LIMIT)}).strict().parse(req.body);
  await deactivateResources(req.user.id,project,records);
  res.json({ok:true,count:records.length});
});
resources.post("/activities/:activity/resources", async (req, res) => {
  const activityId = id.parse(req.params.activity),
    body = allocation.parse(req.body);
  const row = (
    await pool.query(
      "SELECT a.*,p.id project_id FROM activities a JOIN projects p ON p.id=a.project_id WHERE a.id=$1",
      [activityId],
    )
  ).rows[0];
  requireThat(row, 404, "计划作业不存在");
  const a = await access(req.user.id, row.project_id);
  requireThat(canWrite(a));
  requireThat(
    (
      await pool.query(
        "SELECT 1 FROM project_resources WHERE id=$1 AND project_id=$2 AND active=true",
        [body.resource_id, row.project_id],
      )
    ).rowCount,
    400,
    "资源不存在或已停用",
  );
  const allocationId = uid();
  const savedId = await tx(async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      row.project_id,
    ]);
    if(body.resource_version!==undefined){const resource=(await c.query('SELECT version FROM project_resources WHERE id=$1 AND project_id=$2 AND active FOR SHARE',[body.resource_id,row.project_id])).rows[0];requireThat(resource&&resource.version===body.resource_version,409,'资源在预览后已变化，请重新预览分配');}
    if(body.activity_version!==undefined){const activity=(await c.query('SELECT version FROM activities WHERE id=$1 AND project_id=$2 FOR SHARE',[activityId,row.project_id])).rows[0];requireThat(activity&&activity.version===body.activity_version,409,'作业在预览后已变化，请重新预览分配');}
    if(body.activity_record_version!==undefined){const record=(await c.query('SELECT r.version,r.status FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE l.activity_id=$1 FOR SHARE OF r',[activityId])).rows[0];requireThat(record&&record.version===body.activity_record_version&&record.status==='approved',409,'作业源记录或有效状态已变化，请重新确认并预览');}
    return applyResourceChange(c, req.user.id, row.project_id, {
      ...body,
      activity_id: activityId,
    });
  });
  res.status(201).json(savedId);
});

resources.delete("/activity-resources/:allocation", async (req, res) => {
  const allocationId = id.parse(req.params.allocation);
  const row = (
    await pool.query(
      "SELECT ar.id,p.id project_id FROM activity_resource_allocations ar JOIN activities a ON a.id=ar.activity_id JOIN projects p ON p.id=a.project_id WHERE ar.id=$1",
      [allocationId],
    )
  ).rows[0];
  requireThat(row, 404, "资源分配不存在");
  const a = await access(req.user.id, row.project_id);
  requireThat(canManage(a));
  await tx(async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
      row.project_id,
    ]);
    const current = (
      await c.query(
        "SELECT resource_id,activity_id FROM activity_resource_allocations WHERE id=$1",
        [allocationId],
      )
    ).rows[0];
    requireThat(current, 404, "分配不存在");
    await applyResourceChange(c, req.user.id, row.project_id, {
      ...current,
      action: "delete",
      version: req.body.version,
      reason: req.body.reason,
    });
  });
  res.json({ ok: true });
});

export async function resourceLoadData(user:string,project:string){
  const a = await access(user,project);
  requireThat(operationAllowed(a,'$data','read'),403,'没有项目资源费用读取权限');
  await requireFullPlanRead(a);
  const activities=await effectiveActivities(a.id);
  const rows = await pool.query(
    `SELECT r.id,r.active,r.code,r.kind,r.name,r.unit,r.rate,r.capacity,r.productivity,r.configuration,r.version,r.sale_rate,r.tax_rate,r.stock_quantity,r.productivity_unit,r.currency,r.custom_values,
      COALESCE(SUM(ar.quantity),0) total_quantity, COALESCE(SUM(ar.planned_cost),0) planned_cost,
      COALESCE(SUM(ar.actual_cost),0) actual_cost, COUNT(DISTINCT ar.activity_id)::int activity_count,
      COALESCE(json_agg(json_build_object('id',ar.id,'activity_id',ar.activity_id,'quantity',ar.quantity::text,'version',ar.version,'planned_cost',ar.planned_cost::text,'actual_cost',ar.actual_cost::text)) FILTER (WHERE ar.id IS NOT NULL),'[]') allocations
    FROM project_resources r LEFT JOIN activity_resource_allocations ar ON ar.resource_id=r.id AND ar.activity_id=ANY($2::uuid[])
    WHERE r.project_id=$1 AND (r.active=true OR EXISTS(SELECT 1 FROM activity_resource_allocations h WHERE h.resource_id=r.id AND h.activity_id=ANY($2::uuid[]))) GROUP BY r.id ORDER BY coalesce(r.row_position,grid_base_position(r.created_at,r.id)),r.id`,
    [a.id,activities.map(v=>v.id)],
  );
  const planned = schedule(activities, a.calendar_config||defaultProjectCalendar, a.start_date);
  const byId = new Map(planned.activities.map((item: any) => [item.id, item]));
  const startDate = new Date(a.start_date).toISOString().slice(0, 10);
  const calendar = a.calendar_config || defaultProjectCalendar;
  const options=(await pool.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[a.id])).rows[0]?.options||{};
  const future=remainingPlan(activities,calendar,startDate,options),overrides=await remainingOverrides(a.id,pool,activities.map(v=>v.id));
  const actuals=await actualResourceRows(a.id,pool,activities.map(v=>v.id)),actualById=new Map(actuals.map((r:any)=>[r.allocation_id,r]));
  const decorated=decorateRemainingResources(rows.rows,future,overrides,calendar.hours_per_day).map(r=>({...r,allocations:r.allocations.map((x:any)=>({...x,...actualRemainingUnits((actualById.get(x.id) as any)?.actual_units,x.remaining_units),actual_as_of_date:(actualById.get(x.id) as any)?.as_of_date||null,actual_cost_as_of_date:(actualById.get(x.id) as any)?.reported_cost===x.actual_cost?(actualById.get(x.id) as any)?.as_of_date:null,...actualRemainingDuration(byId.get(x.activity_id),calendar,future.data_date)}))}));
  const futureResources=decorated.map(r=>({...r,allocations:r.allocations.filter((x:any)=>x.remaining_duration>0&&x.remaining_window_valid).map((x:any)=>({...x,quantity:x.remaining_quantity,planned_cost:x.remaining_forecast_cost,actual_cost:'0.0000'})),activity_count:r.allocations.filter((x:any)=>x.remaining_duration>0).length}));
  const futureCurves=buildResourceCurves(futureResources,{activities:future.activities},startDate,calendar);
  const resourcesWithCurve = buildResourceCurves(decorated,planned,startDate,calendar).map((r:any)=>{const v=futureCurves.find(x=>x.id===r.id);const reported=r.allocations.filter((x:any)=>x.actual_units!=null),actualUnits=reported.reduce((sum:bigint,x:any)=>sum+resourceTicks(x.actual_units),0n);return {...r,actual_reported_count:reported.length,actual_unreported_count:r.allocations.length-reported.length,actual_total_units:reported.length?resourceText(actualUnits):null,forecast_total_units:reported.length&&reported.length===r.allocations.length?resourceText(actualUnits+r.allocations.reduce((sum:bigint,x:any)=>sum+resourceTicks(x.remaining_units),0n)):null,remaining_curve:v?.curve||[],remaining_total_quantity:resourceText(r.allocations.reduce((sum:bigint,x:any)=>sum+resourceTicks(x.remaining_units),0n)),remaining_unplaced_quantity:resourceText(r.allocations.filter((x:any)=>!x.remaining_window_valid).reduce((sum:bigint,x:any)=>sum+resourceTicks(x.remaining_units),0n)),remaining_peak:resourceText((v?.curve||[]).reduce((m:bigint,d:any)=>resourceTicks(d.quantity)>m?resourceTicks(d.quantity):m,0n)),remaining_overloaded_days:v?.overloaded_days||0,remaining_activity_count:r.allocations.filter((x:any)=>x.remaining_duration>0).length};});
  const remainingRows=activityResourceRows(futureResources,{activities:future.activities},startDate,calendar),allocations=decorated.flatMap(r=>r.allocations);
  const assignments=activityResourceRows(decorated,planned,startDate,calendar).map((row:any)=>{const x=allocations.find((x:any)=>x.id===row.id),futureRow=remainingRows.find((x:any)=>x.id===row.id);return {...row,original_work_hours:x?.original_work_hours,actual_units:x?.actual_units,actual_cost:x?.actual_cost,actual_cost_as_of_date:x?.actual_cost_as_of_date,actual_as_of_date:x?.actual_as_of_date,forecast_total_units:x?.forecast_total_units,actual_elapsed_hours:x?.actual_elapsed_hours,remaining_quantity:x?.remaining_quantity,remaining_units:x?.remaining_units,remaining_hours:x?.remaining_hours,remaining_forecast_cost:x?.remaining_forecast_cost,forecast_total_cost:x?.forecast_total_cost,remaining_start_date:futureRow?.start_date||null,remaining_finish_date:futureRow?.finish_date||null};});
  return {
    start_date: startDate,
    duration: planned.duration,
    progress: planned.progress,
    resources: resourcesWithCurve,
    can_create:canWrite(a)&&operationAllowed(a,"$data","create"),
    assignments,remaining_data_date:future.data_date,remaining_summary:remainingCostSummary(allocations),
  };
}
resources.get("/projects/:project/resource-load",async(req,res)=>{res.json(await resourceLoadData(req.user.id,id.parse(req.params.project)));});

resources.get("/projects/:project/cost-dashboard", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(operationAllowed(a,'$data','read'),403,'没有项目资源费用读取权限');
  await requireFullPlanRead(a);
  const effective=await effectiveActivities(a.id);
  const rows = await pool.query(
    `SELECT r.kind, a.id activity_id, a.code activity_code, a.name activity_name,
            COALESCE(d.name,'未分配部门') department,
            SUM(ar.planned_cost)::text planned_cost,
            SUM(ar.actual_cost)::text actual_cost,
            SUM(round(ar.planned_cost*a.progress/100,4))::text earned_cost,
            SUM(ar.planned_cost-round(ar.planned_cost*a.progress/100,4))::text remaining_cost
       FROM activity_resource_allocations ar
       JOIN project_resources r ON r.id=ar.resource_id AND r.project_id=$1
       JOIN activities a ON a.id=ar.activity_id AND a.project_id=$1
       LEFT JOIN departments d ON d.id=a.department_id
      WHERE a.id=ANY($2::uuid[])
      GROUP BY r.kind,a.id,a.code,a.name,d.name
      ORDER BY a.code,r.kind`,
    [a.id,effective.map(v=>v.id)],
  );
  const options=(await pool.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[a.id])).rows[0]?.options||{},calendar=a.calendar_config||defaultProjectCalendar;
  const future=remainingPlan(effective,calendar,a.start_date,options),overrides=await remainingOverrides(a.id,pool,effective.map(x=>x.id));
  const source=(await pool.query('SELECT x.id,x.activity_id,x.quantity::text,x.actual_cost::text,r.rate::text,r.kind FROM activity_resource_allocations x JOIN project_resources r ON r.id=x.resource_id AND r.project_id=$1 WHERE x.activity_id=ANY($2::uuid[]) AND r.active',[a.id,effective.map(x=>x.id)])).rows;
  const decorated=decorateRemainingResources(source.map(x=>({...x,allocations:[x]})),future,overrides,calendar.hours_per_day),byGroup=new Map<string,bigint>();
  for(const resource of decorated)for(const x of resource.allocations){const key=x.activity_id+':'+resource.kind;byGroup.set(key,(byGroup.get(key)||0n)+resourceTicks(x.remaining_forecast_cost));}
  res.json({rows:rows.rows.map(row=>{const remaining=byGroup.get(row.activity_id+':'+row.kind)||0n;return {...row,remaining_forecast_cost:resourceText(remaining),forecast_total_cost:resourceText(resourceTicks(row.actual_cost)+remaining)}}),remaining_data_date:future.data_date});
});

export function buildResourceCurves(resourceRows:any[],planned:any,startDate:string,calendar:any){
 const byId = new Map(planned.activities.map((item:any)=>[item.id,item]));
  return resourceRows.map((r: any) => {
    const days = new Map<
      string,
      { quantity: bigint; planned_cost: bigint; actual_cost: bigint }
    >();
    for (const allocation of r.allocations || []) {
      const activity: any = byId.get(allocation.activity_id);
      if (!activity) continue;
      const slices = workingDateMinutes(
        calendar,
        startDate,
        activity.es,
        activity.ef,
      );
      // A milestone is a point event; assign explicitly budgeted quantities/costs to its date.
      if (!slices.length)
        slices.push({ date: calendarDate(startDate, activity.es), minutes: 1 });
      const weights = slices.map((slice) => slice.minutes);
      const quantity = distributeResourceByMinutes(
        resourceUnits(allocation.quantity,String(activity.duration)),
        weights,
      );
      const plannedCost = distributeResourceByMinutes(
        allocation.planned_cost,
        weights,
      );
      const actualCost = distributeResourceByMinutes(
        allocation.actual_cost,
        weights,
      );
      for (let index = 0; index < slices.length; index++) {
        const date = slices[index].date,
          current = days.get(date) || {
            quantity: 0n,
            planned_cost: 0n,
            actual_cost: 0n,
          };
        current.quantity += quantity[index];
        current.planned_cost += plannedCost[index];
        current.actual_cost += actualCost[index];
        days.set(date, current);
      }
    }
    const curve = [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => {
        const minutes = calendarPeriods(calendar, date).reduce(
          (sum, [s, e]) => sum + minute(e) - minute(s),
          0,
        );
        const capacity = calendarCapacity(
          r.capacity,
          minutes,
          calendar.hours_per_day,
        );
        return {
          date,
          quantity: resourceText(value.quantity),
          planned_cost: resourceText(value.planned_cost),
          actual_cost: resourceText(value.actual_cost),
          available_capacity: resourceText(capacity),
          overloaded:
            resourceTicks(r.capacity) > 0n && value.quantity > capacity,
        };
      });
    return {
      ...r,
      assigned_quantity:r.total_quantity,
      total_quantity:resourceText((r.allocations||[]).reduce((sum:bigint,allocation:any)=>sum+resourceTicks(resourceUnits(allocation.quantity,String((byId.get(allocation.activity_id) as any)?.duration||0))),0n)),
      allocations:(r.allocations||[]).map((allocation:any)=>{
        const activity:any=byId.get(allocation.activity_id);
        return {...allocation,progress:Number(activity?.progress||0),...progressCosts(allocation.planned_cost,Number(activity?.progress||0))};
      }),
      earned_cost:resourceText((r.allocations||[]).reduce((sum:bigint,allocation:any)=>sum+resourceTicks(progressCosts(allocation.planned_cost,Number((byId.get(allocation.activity_id) as any)?.progress||0)).earned_cost),0n)),
      remaining_cost:resourceText((r.allocations||[]).reduce((sum:bigint,allocation:any)=>sum+resourceTicks(progressCosts(allocation.planned_cost,Number((byId.get(allocation.activity_id) as any)?.progress||0)).remaining_cost),0n)),
      curve,
      overloaded_days: curve.filter((day) => day.overloaded).length,
    };
  });
}
