import {saveTemplateSnapshot} from './report-snapshots.ts';
import {verifyTemplateSnapshot} from './report-documents.ts';
import {validateDurationHours} from '../shared/p6-planning.ts';
import {readPlanActivities} from './plan-activities.ts';
import {attachPlanStarts} from './plan-dates.ts';
import {defaultProjectCalendar} from "../shared/project-calendar.ts";
import {requireFullPlanRead} from './planning-read-access.ts';
import {effectiveActivities} from './effective-activities.ts';
import {linkedPlanValues,syncActivityRecord} from "./plan-table.ts";
import {lockReferenceProject,projectReferenceRows} from "./references.ts";
import { Router } from "express";
import { notifyUser } from "./notifications.ts";
import { z } from "zod";
import { pool, tx, audit, uid } from "./db.ts";
import { access, canManage, canWrite, operationAllowed, requireThat,tableAccess,recordVisibilitySql,HttpError,visibleColumns } from "./auth.ts";
import {orderWbs} from "../shared/wbs-hierarchy.ts";
import { schedule } from "./schedule.ts";
import { activity, id, name, date } from "./validation.ts";
import { summary } from "./data.ts";
export const planning = Router();
planning.put('/projects/:project/progress-policy',async(req,res)=>{
 const project=id.parse(req.params.project),body=z.object({method:z.enum(['duration','equal']),previous:z.enum(['duration','equal'])}).strict().parse(req.body);
 await tx(async c=>{const a=await access(req.user.id,project,c);requireThat(canManage(a));requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'仅活动项目可修改');const r=await c.query('UPDATE projects SET progress_method=$2 WHERE id=$1 AND progress_method=$3 RETURNING id',[project,body.method,body.previous]);requireThat(r.rowCount,409,'口径已更新，请刷新');await audit(c,a.workspace_id,req.user.id,'修改计划完成率口径',project,{before:body.previous,after:body.method});});res.json({ok:true});
});
planning.get("/projects/:project/plan", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  await requireFullPlanRead(a);
  const preview=req.query.view==='gantt';
  const loadActivities=()=>readPlanActivities(req.user.id,a,preview);
  const requestedBaselines=z.array(id).max(3).parse(typeof req.query.baseline_ids==='string'?req.query.baseline_ids.split(',').filter(Boolean):[]);
  const [activities, baselines, schedulingPolicy] = await Promise.all([
    loadActivities().then(rows=>({rows})),
    pool.query(
      "SELECT * FROM baselines WHERE project_id=$1 AND (id=ANY($2::uuid[]) OR id::text=(SELECT options->>'baseline_id' FROM project_schedule_options WHERE project_id=$1) OR id::text IN(SELECT jsonb_array_elements_text(COALESCE(options->'comparison_baseline_ids','[]'::jsonb)) FROM project_schedule_options WHERE project_id=$1) OR id IN(SELECT id FROM baselines WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT 10)) ORDER BY created_at DESC,id DESC LIMIT 17",
      [a.id,requestedBaselines],
    ),
    pool.query('SELECT options FROM project_schedule_options WHERE project_id=$1',[a.id]),
  ]);
  const linked=await linkedPlanValues(req.user.id,a,activities.rows);
  let wbsHierarchy:{id:string;name:string;depth:number;parent_id:string|null}[]=[];
  if(linked.table?.columns.some((f:any)=>f.id==='wbs')){
    const binding=(await pool.query("SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind='wbs'",[a.id])).rows[0];
    if(binding){
      const wbs=await tableAccess(req.user.id,binding.table_id).catch(error=>{if(error instanceof HttpError&&error.status===403)return null;throw error});
      if(wbs){
        const order=z.string().max(50).optional().parse(req.query.wbs_sort)||'code';
        const direction=z.enum(['asc','desc']).optional().parse(req.query.wbs_direction)==='desc'?-1:1;
        const sortField=visibleColumns(wbs.permission,wbs.table).some((f:any)=>f.id===order)?order:'';
        const rows=(await pool.query(`SELECT r.* FROM records r WHERE r.table_id=$1 AND r.lifecycle<>'deleted' AND r.status<>'obsolete' AND ${recordVisibilitySql(wbs.permission,'$2')} ORDER BY r.created_at,r.id`,[wbs.table.id,req.user.id])).rows;
        const visible=await projectReferenceRows(req.user.id,wbs.table,wbs.permission,rows);
        wbsHierarchy=orderWbs(visible,sortField,direction).map(({row,depth})=>({id:row.id,name:String(row.data.name||''),depth,parent_id:row.data.parent?.[0]||null}));
      }
    }
  }
  res.json({
    wbsHierarchy,preview,
    table:linked.table,can_write:canWrite(a)&&operationAllowed(a,"$data","update"),
    aoa_layout:a.aoa_layout,aoa_layout_revision:a.aoa_layout_revision,
    calendar_config:a.calendar_config||defaultProjectCalendar,currency:a.currency,
    ...schedule(
      linked.activities.sort(
        (a, b) =>
          a.code.localeCompare(b.code, "en", { numeric: true }) ||
          a.id.localeCompare(b.id),
      ),a.calendar_config||defaultProjectCalendar,a.start_date,a.progress_method,schedulingPolicy.rows[0]?.options||{},
    ),
    start_date: a.start_date,
    baselines: baselines.rows,
  });
});
planning.post("/projects/:project/activities", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project)),
    body = activity.parse(req.body);
  validateDurationHours(body.duration,a.calendar_config?.hours_per_day||8);
  requireThat(canWrite(a)&&operationAllowed(a,"$data","create"));
  const activityId = uid();
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [a.id]);
    if (body.department_id)
      requireThat(
        (
          await c.query(
            "SELECT 1 FROM departments WHERE id=$1 AND project_id=$2",
            [body.department_id, a.id],
          )
        ).rowCount,
        400,
        "部门不属于项目",
      );
    const rows = (
      await c.query("SELECT * FROM activities WHERE project_id=$1", [a.id])
    ).rows;
    schedule(await attachPlanStarts(a.id,[...rows,{...body,id:activityId}],c),a.calendar_config,a.start_date);
    await c.query(
      "INSERT INTO activities(id,project_id,code,name,duration,progress,department_id,predecessors) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        activityId,
        a.id,
        body.code,
        body.name,
        body.duration,
        body.progress,
        body.department_id,
        JSON.stringify(body.predecessors),
      ],
    );
    await syncActivityRecord(c,req.user.id,a.id,activityId);
    await audit(c, a.workspace_id, req.user.id, "新增计划作业", activityId);
  });
  res.status(201).json({ id: activityId });
});
planning.put("/projects/:project/activities/:activity", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project)),
    body = activity.extend({ version: z.number().int() }).parse(req.body),
    activityId = id.parse(req.params.activity);
  requireThat(canWrite(a)&&operationAllowed(a,"$data","update"));
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [a.id]);
    const rows = (
      await c.query("SELECT * FROM activities WHERE project_id=$1", [a.id])
    ).rows;
    validateDurationHours(body.duration,a.calendar_config?.hours_per_day||8);
    const original = rows.find((t) => t.id === activityId);
    requireThat(original, 404, "作业不存在");
    requireThat(
      original.version === body.version,
      409,
      "作业已更新，请刷新后重试",
    );
    if (body.department_id)
      requireThat(
        (
          await c.query(
            "SELECT 1 FROM departments WHERE id=$1 AND project_id=$2",
            [body.department_id, a.id],
          )
        ).rowCount,
        400,
        "部门不属于项目",
      );
    const sourceRecord=(await c.query('SELECT r.data FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE l.activity_id=$1',[activityId])).rows[0];
    requireThat(sourceRecord?.data.activity_type!=='LOE持续性作业'||Number(body.duration)===Number(original.duration),400,'LOE工期由关联作业计算，不能手工修改');
    schedule(await attachPlanStarts(a.id,rows.map((t)=>(t.id===activityId?{...t,...body}:t)),c),a.calendar_config,a.start_date);
    await c.query(
      "UPDATE activities SET code=$1,name=$2,duration=$3,progress=$4,department_id=$5,predecessors=$6,version=version+1 WHERE id=$7",
      [
        body.code,
        body.name,
        body.duration,
        body.progress,
        body.department_id,
        JSON.stringify(body.predecessors),
        activityId,
      ],
    );
    await syncActivityRecord(c,req.user.id,a.id,activityId);
    await audit(c, a.workspace_id, req.user.id, "更新计划作业", activityId);
  });
  res.json({ ok: true });
});
planning.delete("/projects/:project/activities/:activity", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project)),
    activityId = id.parse(req.params.activity);
  requireThat(canManage(a));
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [a.id]);
    const rows = (
      await c.query("SELECT * FROM activities WHERE project_id=$1", [a.id])
    ).rows;
    requireThat(
      !rows.some((r) => r.predecessors.some((d: any) => d.id === activityId)),
      409,
      "请先解除后续作业依赖",
    );
    requireThat(!(await c.query("SELECT 1 FROM record_activity_links WHERE activity_id=$1 LIMIT 1", [activityId])).rowCount,409,"作业已有业务记录关联，请保留历史或先解除草稿关联");
    await syncActivityRecord(c,req.user.id,a.id,activityId,true);
    await c.query("DELETE FROM activities WHERE id=$1 AND project_id=$2", [
      activityId,
      a.id,
    ]);
    await audit(c, a.workspace_id, req.user.id, "删除计划作业", activityId);
  });
  res.json({ ok: true });
});
planning.get("/projects/:project/todos", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  const includeArchived = req.query.archived === "true" && canManage(a);
  res.json(
    (
      await pool.query(
        "SELECT t.*,u.name AS owner_name FROM todos t JOIN users u ON u.id=t.owner_id WHERE t.project_id=$1 AND t.archived=$4 AND (t.owner_id=$2 OR $3) ORDER BY t.done,t.due_date,CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,t.id",
        [a.id, req.user.id, canManage(a), includeArchived],
      )
    ).rows,
  );
});
planning.post("/projects/:project/todos", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project)),
    body = z
      .object({
        title: name,
        due_date: date,
        owner_id: id,
        priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        recurrence: z
          .enum(["none", "daily", "weekly", "monthly"])
          .default("none"),
        recurrence_until: date.optional(),
      })
      .parse(req.body);
  requireThat(canWrite(a));
  requireThat(body.owner_id === req.user.id || canManage(a));
  requireThat(!body.recurrence_until || body.recurrence_until >= body.due_date, 400, "重复截止日期不能早于待办日期");
  await access(body.owner_id, a.id);
  requireThat((await pool.query("SELECT 1 FROM users WHERE id=$1 AND active", [body.owner_id])).rowCount, 400, "负责人账号已停用");
  const todo = uid();
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await c.query(
      "INSERT INTO todos(id,project_id,title,due_date,owner_id,priority,recurrence,recurrence_until,recurrence_day) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        todo,
        a.id,
        body.title,
        body.due_date,
        body.owner_id,
        body.priority,
        body.recurrence,
        body.recurrence_until ?? null,
        Number(body.due_date.slice(8)),
      ],
    );
    await audit(c, a.workspace_id, req.user.id, "创建待办", todo);
    await notifyUser(
      c,
      body.owner_id,
      a.id,
      "todo",
      todo,
      "你有一项新的日历待办",
    );
  });
  res.status(201).json({ id: todo });
});
planning.delete("/todos/:todo", async (req, res) => {
  const todo = (
    await pool.query("SELECT * FROM todos WHERE id=$1", [
      id.parse(req.params.todo),
    ])
  ).rows[0];
  requireThat(todo, 404, "待办不存在");
  const a = await access(req.user.id, todo.project_id);
  requireThat(todo.owner_id === req.user.id || canManage(a));
  requireThat(a.role!=='viewer',403,'只读账号不能归档待办');
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await c.query(
      "UPDATE todos SET archived=true,version=version+1,updated_at=now() WHERE id=$1",
      [todo.id],
    );
    await audit(c, a.workspace_id, req.user.id, "归档待办", todo.id);
  });
  res.json({ ok: true });
});
planning.post("/todos/:todo/restore", async (req, res) => {
  const todo = (
    await pool.query("SELECT * FROM todos WHERE id=$1", [
      id.parse(req.params.todo),
    ])
  ).rows[0];
  requireThat(todo, 404, "待办不存在");
  const a = await access(req.user.id, todo.project_id);
  requireThat(canManage(a));
  await tx(async (c) => {
    await lockReferenceProject(c,a.id);
    await c.query(
      "UPDATE todos SET archived=false,version=version+1,updated_at=now() WHERE id=$1",
      [todo.id],
    );
    await audit(c, a.workspace_id, req.user.id, "恢复待办", todo.id);
  });
  res.json({ ok: true });
});
planning.get("/projects/:project/reports", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  res.json(
    (
      await pool.query(
        "SELECT id,name,created_at,snapshot->>'category' AS category,snapshot->>'kind' AS kind FROM reports WHERE project_id=$1 AND created_by=$2 ORDER BY created_at DESC",
        [a.id, req.user.id],
      )
    ).rows,
  );
});
planning.post("/projects/:project/reports", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  requireThat(canManage(a) || a.can_export);
  if(req.body.templateId){const b=z.object({templateId:id,name:z.string().trim().min(1).max(120).optional(),dateFrom:z.iso.date().optional(),dateTo:z.iso.date().optional()}).parse(req.body);requireThat(!b.dateFrom&&!b.dateTo||!!b.dateFrom&&!!b.dateTo&&b.dateFrom<=b.dateTo,400,'请填写有效的统计起止日期');res.status(201).json(await saveTemplateSnapshot(req.user.id,a.id,b.templateId,b.name,{dateFrom:b.dateFrom,dateTo:b.dateTo}));return;}
  const report = uid(),
    title = name.parse(req.body.name),
    snapshot = await summary(req.user.id, a.id);
  await tx(async (c) => {
    await c.query(
      "INSERT INTO reports(id,project_id,name,snapshot,created_by) VALUES($1,$2,$3,$4,$5)",
      [
        report,
        a.id,
        title,
        JSON.stringify({
          ...snapshot,
          access_scope: {
            row_scope: canManage(a) ? "all" : a.row_scope,
            user_id: req.user.id,
          },
        }),
        req.user.id,
      ],
    );
    await audit(c, a.workspace_id, req.user.id, "生成统计报表快照", report);
  });
  res.status(201).json({ id: report });
});
planning.get("/reports/:report", async (req, res) => {
  const report = (
    await pool.query("SELECT * FROM reports WHERE id=$1", [
      id.parse(req.params.report),
    ])
  ).rows[0];
  requireThat(report && report.created_by === req.user.id, 404, "报表不存在");
  const a = await access(req.user.id, report.project_id);
  requireThat(canManage(a) || a.can_export);
  if(report.snapshot.kind==='template_report'){await verifyTemplateSnapshot(req.user.id,report.project_id,report.snapshot);res.json(report);return;}
  const current = await summary(req.user.id, a.id);
  const safe = new Map(
    current.tables.map((t) => [t.id, new Set(t.metrics.map((m: any) => m.id))]),
  );
  requireThat(
    report.snapshot.tables.every(
      (t: any) =>
        safe.has(t.id) &&
        t.metrics.every((m: any) => safe.get(t.id)!.has(m.id)),
    ),
    403,
    "权限范围已变化，请重新生成报表",
  );
  requireThat(
    canManage(a) ||
      a.row_scope === "all" ||
      (report.snapshot.access_scope?.row_scope === "own" &&
        report.snapshot.access_scope?.user_id === req.user.id),
    403,
    "行权限已变化，请重新生成报表",
  );
  res.json(report);
});

planning.put('/projects/:project/aoa-layout',async(req,res)=>{
 const body=z.object({version:z.number().int().positive(),layout:z.record(z.string().max(100),z.number().min(0).max(500))}).parse(req.body),project=id.parse(req.params.project);
 await tx(async c=>{const a=await access(req.user.id,project,c);requireThat(canWrite(a)&&operationAllowed(a,"$data","update"));requireThat(a.lifecycle==='active'&&a.workspace_lifecycle==='active',409,'项目不可编辑');
 requireThat((await c.query('UPDATE projects SET aoa_layout=$1,aoa_layout_revision=aoa_layout_revision+1 WHERE id=$2 AND aoa_layout_revision=$3 RETURNING id',[JSON.stringify(body.layout),project,body.version])).rowCount,409,'网络布局已更新，请刷新');await audit(c,a.workspace_id,req.user.id,'调整主计划网络布局',project);});res.json({ok:true});
});
