import {actualRemainingDuration} from '../shared/actual-remaining.ts';
import {currentPlanDate} from './remaining-plan.ts';
import {LoeError,LOE,loeReferenceField} from '../shared/loe.ts';
import {validateDurationHours,p6ActivityFields,validateActivityPlanning,planningProgress} from '../shared/p6-planning.ts';
import {attachPlanStarts} from './plan-dates.ts';
import {defaultProjectCalendar} from '../shared/project-calendar.ts';
import {canReadFullPlan} from './planning-read-access.ts';
import {effectiveActivities} from './effective-activities.ts';
import {editableRecord} from '../shared/record-policy.ts';
import {validateConstructionValues} from './construction-validation.ts';
import type pg from "pg";
import { Router } from "express";
import { pool, tx, uid, audit } from "./db.ts";
import {
  access,
  canManage,canWrite,operationAllowed,
  canRecordAction,
  requireThat,
  tableAccess,
  rowAllowed,
  tableAllowed,
  visibleColumns,
} from "./auth.ts";
import { id, activity, validateRecord } from "./validation.ts";
import { lockReferenceProject, projectReferenceRows } from "./references.ts";
import { schedule } from "./schedule.ts";
export const planTable = Router();
export async function readPlanRelations(user:string,tableId:string,systemAdmin=false){
  const {table,permission} = await tableAccess(user,id.parse(tableId));
  const link = (await pool.query('SELECT project_id FROM plan_data_tables WHERE table_id=$1',[table.id])).rows[0];
  if (!link) return null;
  if (!await canReadFullPlan(permission)) return null;
  const activities = (await pool.query('SELECT * FROM activities WHERE project_id=$1 ORDER BY code,id',[link.project_id])).rows;
  const values = await linkedPlanValues(user, {...permission,id:link.project_id}, activities);
  const fields = visibleColumns(permission,table);
  let preview=values.activities.filter((a:any)=>!!a.record_id&&a.record_status!=='obsolete');
  for(;;){const ids=new Set(preview.map(a=>a.id));const next=preview.filter(a=>a.predecessors.every((d:any)=>ids.has(d.id)));if(next.length===preview.length)break;preview=next;}
  const calculated=schedule(await attachPlanStarts(link.project_id,preview),permission.calendar_config||defaultProjectCalendar,permission.start_date,permission.progress_method);
  const metrics=new Map(calculated.activities.map(a=>[a.id,{...actualRemainingDuration(a,permission.calendar_config||defaultProjectCalendar,a.schedule_options?.data_date||currentPlanDate()),total_float:a.float,free_float:a.free_float,critical:a.critical,near_critical:a.near_critical,float_critical:a.float_critical,on_longest_path:a.on_longest_path,critical_reason:a.critical_reason,preview:true}]));
  const resources=(await pool.query('SELECT id,code,name,unit,currency FROM project_resources WHERE project_id=$1 AND active ORDER BY code,id',[link.project_id])).rows;
  const allocations=(await pool.query(`SELECT ar.id,ar.activity_id,ar.resource_id,ar.quantity::text,ar.version,v.quantity::text remaining_quantity,r.code,r.name,r.unit
    FROM activity_resource_allocations ar JOIN project_resources r ON r.id=ar.resource_id
    LEFT JOIN activity_resource_remaining v ON v.allocation_id=ar.id JOIN activities a ON a.id=ar.activity_id WHERE a.project_id=$1 ORDER BY r.code,r.id`,[link.project_id])).rows;
  const writable=canWrite(permission)&&operationAllowed(permission,'$data','update')&&permission.lifecycle==='active'&&permission.workspace_lifecycle==='active';

  return {project_id:link.project_id, currency:permission.currency,resources, can_remove_resources:canManage(permission)&&operationAllowed(permission,"$data","delete"),activities:values.activities.map((item:any)=>({
    id:item.id,version:item.version,predecessors:item.predecessors,
    code:item.record_id && fields.some((f:any)=>f.id==='code')?item.code:'',
    name:item.record_id && fields.some((f:any)=>f.id==='name')?item.name:'',
    record_id:item.record_id,custom_editable:item.custom_editable,
    allocations:item.record_id?allocations.filter(r=>r.activity_id===item.id):[],
    can_assign_resources:!!(item.record_id&&writable&&item.custom_editable&&(['draft','rejected'].includes(item.record_status)||systemAdmin&&item.record_status!=='pending')),

    metrics:item.record_id?(metrics.get(item.id)||null):null,
  }))};
}
planTable.get('/tables/:table/plan-relations',async(req,res)=>res.json(await readPlanRelations(req.user.id,req.params.table,!!req.user.system_admin)));
export const planCore = [
  { id: "code", name: "作业编码", type: "text", required: true, auto_code:true, code_prefix:'ACT-', code_start:'1', code_step:'1', code_width:3, code_fill_gaps:false },
  { id: "name", name: "作业名称", type: "text", required: true },
  { id: "duration", name: "工期（项目日历日）", type: "number", required: true },
  { id:"planned_start",name:"开始时间",type:"date",plan_date:"start" },
  { id:"planned_finish",name:"完成时间",type:"date",plan_date:"finish" },
  { id: "progress", name: "完成率（%）", type: "number", required: true },
  ...p6ActivityFields,
];
export async function validatePlanValues(
  c: pg.PoolClient,
  table: any,
  value: any,
) {
  await validateConstructionValues(c,table,value);
  if(Array.isArray(value.person_ref)&&value.person_ref.length>1&&
    (await c.query("SELECT 1 FROM planning_tables WHERE table_id=$1 AND kind='organization'",[table.id])).rowCount)
    requireThat(false,400,'每个岗位只能关联一名花名册人员');
  if(table.columns.some((f:any)=>f.id==='activity_wbs'&&f.derived_reference)){
    requireThat(!Array.isArray(value.activity)||value.activity.length<=1,400,'每项风险只可关联一个作业');
    requireThat(value.loss==null||Number(value.loss)>=0,400,'直接损失不能小于零');
    requireThat(value.probability==null||(Number(value.probability)>=0&&Number(value.probability)<=100),400,'发生概率须在 0 到 100 之间');
  }
  if (
    !(
      await c.query("SELECT 1 FROM plan_data_tables WHERE table_id=$1", [
        table.id,
      ])
    ).rowCount
  )
    return;
  if(value.activity_type===LOE){value.duration=0;value.remaining_duration=null;const start=table.columns.find((f:any)=>f.plan_date==='start');if(start)value[start.id]=null;const linked=(await c.query("SELECT r.id,r.data FROM records r WHERE r.table_id=$1 AND r.id=ANY($2::uuid[])",[table.id,value.loe_scope||[]])).rows;if(linked.some(r=>r.data.activity_type===LOE))throw new LoeError('LOE只能关联普通作业或里程碑，不能关联其他LOE');}
  value.progress=planningProgress(value,Number(value.progress));
  validateActivityPlanning(value);
  const calendarProject=(await c.query('SELECT p.calendar_config FROM projects p JOIN plan_data_tables t ON t.project_id=p.id WHERE t.table_id=$1',[table.id])).rows[0];
  validateDurationHours(Number(value.duration),calendarProject?.calendar_config?.hours_per_day||8);
  if(['开始里程碑','完成里程碑'].includes(value.activity_type))requireThat(!(await c.query('SELECT 1 FROM activities a JOIN activity_resource_allocations x ON x.activity_id=a.id JOIN plan_data_tables p ON p.project_id=a.project_id WHERE p.table_id=$1 AND a.code=$2 LIMIT 1',[table.id,value.code])).rowCount,400,'里程碑不分配资源，请先移除资源分配');
  requireThat(!Array.isArray(value.wbs) || value.wbs.length <= 1, 400, '每项作业只能关联一个WBS');
  activity.parse({
    code: value.code || (table.columns.some((field:any)=>field.id==='code'&&field.auto_code) ? 'AUTO-PENDING' : value.code),
    name: value.name,
    duration: value.duration,
    progress: value.progress,
  });
}
export async function validatePlanSchedule(c: pg.PoolClient, table: any) {
  const p = (
    await c.query("SELECT project_id FROM plan_data_tables WHERE table_id=$1", [
      table.id,
    ])
  ).rows[0];
  if(p){
    const project=(await c.query('SELECT start_date,calendar_config FROM projects WHERE id=$1',[p.project_id])).rows[0];
    const rows=(await c.query('SELECT * FROM activities WHERE project_id=$1',[p.project_id])).rows;
    schedule(await attachPlanStarts(p.project_id,rows,c),project.calendar_config||defaultProjectCalendar,project.start_date);
  }
}
export async function linkedPlanValues(
  user: string,
  a: any,
  activities: any[],
) {
  const table = (
    await pool.query(
      "SELECT t.* FROM plan_data_tables p JOIN data_tables t ON t.id=p.table_id WHERE p.project_id=$1",
      [a.id],
    )
  ).rows[0];
  if (!table || !tableAllowed(a, table)) return { activities, table: null };
  const rows = (
    await pool.query(
      "SELECT r.*,l.activity_id FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE r.table_id=$1 AND r.lifecycle<>'deleted'",
      [table.id],
    )
  ).rows.filter((r) => rowAllowed(a, r, user));
  const projected = await projectReferenceRows(user, table, a, rows);
  return {
    table: { ...table, columns: visibleColumns(a, table) },
    activities: activities.map((item) => {
      const r = projected.find((r) => r.activity_id === item.id);
      return r
        ? {
            ...item,
            record_id: r.id,
            record_version: r.version,
            record_status: r.status,
            custom_data: r.data,
            custom_references: r.references,
            custom_editable:
              canRecordAction(a, table, "update") &&
              table.lifecycle === "active" &&
              a.lifecycle === "active" &&
              a.workspace_lifecycle === "active" &&
              r.lifecycle === "active" &&
              editableRecord(table,r.status),
          }
        : item;
    }),
  };
}
export async function syncActivityRecord(
  c: pg.PoolClient,
  user: string,
  p: string,
  activityId: string,
  remove = false,
) {
  const table = (
    await c.query(
      "SELECT t.* FROM plan_data_tables p JOIN data_tables t ON t.id=p.table_id WHERE p.project_id=$1",
      [p],
    )
  ).rows[0];
  if (!table) return;
  const r = (
    await c.query(
      "SELECT r.* FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE l.activity_id=$1 FOR UPDATE OF r",
      [activityId],
    )
  ).rows[0];
  const { permission: a } = await tableAccess(user, table.id, c);
  requireThat(
    canRecordAction(a, table, remove ? "delete" : r ? "update" : "create"),
  );
  if (r) {
    requireThat(rowAllowed(a, r, user));
    requireThat(
      editableRecord(table,r.status) && r.lifecycle === "active",
      409,
      "作业数据已待审、审核或冻结，请先撤回或通过作业数据表发起变更",
    );
  }
  if (remove) {
    if (r)
      await c.query(
        "UPDATE records SET lifecycle='deleted',version=version+1 WHERE id=$1",
        [r.id],
      );
    return;
  }
  const row = (
    await c.query("SELECT * FROM activities WHERE id=$1", [activityId])
  ).rows[0];
  const core = {
    code: row.code,
    name: row.name,
    duration: Number(row.duration),
    progress: Number(row.progress),
  };
  requireThat(
    Object.keys(core).every((key) =>
      visibleColumns(a, table).some((f: any) => f.id === key),
    ),
    403,
    "作业核心字段被隐藏，请申请完整操作权限",
  );
  const data = validateRecord(table.columns, { ...r?.data, ...core,...(r?.data.activity_type===LOE?{duration:0,remaining_duration:null}:{}) },r?.created_at);
  await validatePlanValues(c,table,data);
  if (r)
    await c.query("UPDATE records SET data=$1,status='draft',version=version+1 WHERE id=$2", [
      JSON.stringify(data),
      r.id,
    ]);
  else {
    await c.query("SELECT set_config('app.plan_activity_id',$1,true)", [
      activityId,
    ]);
    await c.query(
      "INSERT INTO records(id,table_id,data,created_by) VALUES($1,$2,$3,$4)",
      [uid(), table.id, JSON.stringify(data), user],
    );
    await c.query("SELECT set_config('app.plan_activity_id','',true)");
  }
}
planTable.get("/projects/:project/plan-table",async(req,res)=>{
 const project=id.parse(req.params.project);await access(req.user.id,project);
 const link=(await pool.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1',[project])).rows[0];
 if(!link)return res.json({table:null});
 const {table,permission}=await tableAccess(req.user.id,link.table_id);
 res.json({table:{...table,columns:visibleColumns(permission,table)}});
});
planTable.post("/projects/:project/plan-table", async (req, res) => {
  const project = id.parse(req.params.project);
  const tableId = await tx(async (c) => {
    await lockReferenceProject(c, project);
    const a = await access(req.user.id, project, c);
    requireThat(canManage(a));
    requireThat(
      a.lifecycle === "active" && a.workspace_lifecycle === "active",
      409,
      "仅活动项目可启用作业数据表",
    );
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const existing = (
      await c.query(
        "SELECT table_id FROM plan_data_tables WHERE project_id=$1",
        [project],
      )
    ).rows[0];
    if (existing) return existing.table_id;
    const department = (
      await c.query(
        "SELECT id FROM departments WHERE project_id=$1 ORDER BY (name='经理') DESC,name LIMIT 1",
        [project],
      )
    ).rows[0];
    requireThat(department, 409, "需要一个活动部门承载作业数据表");
    const key = uid();
    const wbs=(await c.query("SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind='wbs'",[project])).rows[0];
    const core=[...planCore,loeReferenceField(key)];
    const columns=wbs?[...core,{id:'wbs',name:'所属WBS',type:'reference',target_table:wbs.table_id,display_column:'name'}]:core;
    await c.query(
      "INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES($1,$2,$3,$4,$5)",
      [key, project, department.id, "计划作业数据", JSON.stringify(columns)],
    );
    await c.query(
      "INSERT INTO plan_data_tables(project_id,table_id) VALUES($1,$2)",
      [project, key],
    );
    for (const activity of (
      await c.query("SELECT id FROM activities WHERE project_id=$1", [project])
    ).rows)
      await syncActivityRecord(c, req.user.id, project, activity.id);
    await audit(c, a.workspace_id, req.user.id, "启用计划作业数据表", key);
    return key;
  });
  res.json({ id: tableId });
});
