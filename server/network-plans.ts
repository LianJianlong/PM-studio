import {validateDurationHours} from '../shared/p6-planning.ts';
import {requireFullPlanRead} from './planning-read-access.ts';
import {effectiveActivities} from './effective-activities.ts';
import { defaultProjectCalendar } from "../shared/project-calendar.ts";
import { Router } from "express";
import { z } from "zod";
import { pool, tx, uid, audit } from "./db.ts";
import {
  access,
  canManage,
  canWrite,
  operationAllowed,
  requireThat,
} from "./auth.ts";
import { id } from "./validation.ts";
import { networkDocument, networkMetadata } from "./network-plan-model.ts";
import { lockReferenceProject } from "./references.ts";
import { scheduleNetwork } from "./network-schedule.ts";
export const networkPlans = Router();
async function calculate(
  activities: any[],
  permission: any,
  start: string,
  decisions: any[] = [],
) {
  try {
    const config=(await pool.query('SELECT o.options,p.calendar_config project_calendar FROM projects p LEFT JOIN project_schedule_options o ON o.project_id=p.id WHERE p.id=$1',[permission.id])).rows[0],saved=config?.options||{};
    const projectHours=config?.project_calendar?.hours_per_day||8,diagramHours=permission.calendar_config?.hours_per_day||8;
    return scheduleNetwork(
      activities,
      decisions,
      permission.calendar_config || defaultProjectCalendar,
      start,
      {critical_method:saved.critical_method,critical_threshold:(saved.critical_threshold||0)*projectHours/diagramHours,near_critical_hours:saved.near_critical_hours},
    );
  } catch (e) {
    requireThat(false, 400, (e as Error).message);
    throw e;
  }
}
function editable(a: any, manage = false) {
  requireThat(
    manage
      ? canManage(a)
      : canWrite(a) && operationAllowed(a, "$data", "update"),
  );
  requireThat(
    a.lifecycle === "active" && a.workspace_lifecycle === "active",
    409,
    "项目或工作空间不可编辑",
  );
}
const path = "/projects/:project/network-plans";
networkPlans.get(path, async (req, res) => {
  const project = id.parse(req.params.project),
    a = await access(req.user.id, project);
  requireThat(operationAllowed(a,"$data","read"));
  const rows = (
    await pool.query(
      `SELECT id,name,granularity,start_date,version,updated_at,jsonb_array_length(activities) AS activity_count
    FROM network_plans WHERE project_id=$1 AND lifecycle='active' ORDER BY created_at,id`,
      [project],
    )
  ).rows;
  res.json({
    plans: rows,
    can_manage:
      canManage(a) &&
      a.lifecycle === "active" &&
      a.workspace_lifecycle === "active",
  });
});
networkPlans.get(path + "/:plan", async (req, res) => {
  const project = id.parse(req.params.project),
    a = await access(req.user.id, project);
  requireThat(operationAllowed(a,"$data","read"));
  const plan = (
    await pool.query(
      "SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date FROM network_plans WHERE id=$1 AND project_id=$2 AND lifecycle='active'",
      [id.parse(req.params.plan), project],
    )
  ).rows[0];
  requireThat(plan, 404, "网络计划不存在");
  res.json({
    plan,
    calendar_config:
      plan.calendar_config || a.calendar_config || defaultProjectCalendar,
    ...await calculate(
      plan.activities,
      { ...a, calendar_config: plan.calendar_config || a.calendar_config },
      plan.start_date,
      plan.decisions || [],
    ),
    start_date: plan.start_date,
    can_write:
      canWrite(a) &&
      operationAllowed(a, "$data", "update") &&
      a.lifecycle === "active" &&
      a.workspace_lifecycle === "active",
    can_manage:
      canManage(a) &&
      a.lifecycle === "active" &&
      a.workspace_lifecycle === "active",
  });
});
networkPlans.post(path, async (req, res) => {
  const project = id.parse(req.params.project),
    b = networkMetadata
      .extend({
        source: z.enum(["blank", "gantt", "network"]).default("blank"),
        source_id: id.optional(),
      })
      .parse(req.body);
  const key = await tx(async (c) => {
    await lockReferenceProject(c, project);
    const a = await access(req.user.id, project, c);
    editable(a, true);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    let rows: any[] = [],
      sourcePlan: any = null;
    if (b.source === "gantt") {
      await requireFullPlanRead(a,c);
      rows=await effectiveActivities(project,c);
    }
    if (b.source === "network") {
      requireThat(b.source_id, 400, "请选择来源网络计划");
      const old = (
        await c.query(
          "SELECT * FROM network_plans WHERE id=$1 AND project_id=$2 AND lifecycle='active'",
          [b.source_id, project],
        )
      ).rows[0];
      requireThat(old, 404, "来源网络计划不存在");
      rows = old.activities;
      sourcePlan = old;
    }
    const keys = new Map(rows.map((r) => [r.id, uid()]));
    const activities = rows.map((r) => ({
      id: keys.get(r.id),
      source_activity_id: b.source === "gantt" ? r.id : r.source_activity_id,
      code: r.code,
      name: r.name,
      duration: Number(r.duration),
      progress: Number(r.progress),
      start_offset: r.start_offset || 0,
      activity_type:['开始里程碑','完成里程碑'].includes(r.activity_type)?r.activity_type:'任务',
      network_status:r.network_status,
      is_dummy: r.is_dummy,
      event_start_id: r.event_start_id,
      event_finish_id: r.event_finish_id,
      predecessors: r.predecessors.map((d: any) => ({
        id: keys.get(d.id),
        type: d.type,
        lag: d.lag,
      })),
    }));
    const layout = Object.fromEntries(
      Object.entries(
        (b.source === "gantt" ? a.aoa_layout : sourcePlan?.diagram_layout) ||
          {},
      ).map(([id, lane]) => {
        for (const [before, after] of keys)
          id = id.replace(before, after as string);
        return [id, lane];
      }),
    );
    const doc = networkDocument.parse({
      ...b,
      decisions: (sourcePlan?.decisions || []).map((d: any) => ({
        ...d,
        branches: d.branches.map((id: string) => keys.get(id)),
        selected: keys.get(d.selected),
      })),
      activities,
      swimlanes:sourcePlan?.swimlanes||[],
      diagram_layout: layout,
      calendar_config: sourcePlan?.calendar_config,
    });
    await calculate(doc.activities, a, doc.start_date, doc.decisions);
    const key = uid();
    await c.query(
      "INSERT INTO network_plans(id,project_id,name,granularity,start_date,activities,created_by,diagram_layout,calendar_config) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        key,
        project,
        doc.name,
        doc.granularity,
        doc.start_date,
        JSON.stringify(doc.activities),
        req.user.id,
        JSON.stringify(doc.diagram_layout),
        doc.calendar_config ? JSON.stringify(doc.calendar_config) : null,
      ],
    );
    await c.query("UPDATE network_plans SET decisions=$1,swimlanes=$3 WHERE id=$2", [
      JSON.stringify(doc.decisions),
      key,
      JSON.stringify(doc.swimlanes),
    ]);
    await audit(c, a.workspace_id, req.user.id, "创建独立网络计划", key, {
      source: b.source,
      granularity: b.granularity,
    });
    return key;
  });
  res.status(201).json({ id: key });
});
networkPlans.put(path + "/:plan", async (req, res) => {
  const project = id.parse(req.params.project),
    key = id.parse(req.params.plan);
  const b = z
    .object({ version: z.number().int().min(1), document: networkDocument })
    .parse(req.body);
  await tx(async (c) => {
    await lockReferenceProject(c, project);
    const a = await access(req.user.id, project, c);
    editable(a);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const old = (
      await c.query(
        "SELECT *,to_char(start_date,'YYYY-MM-DD') AS start_date FROM network_plans WHERE id=$1 AND project_id=$2 AND lifecycle='active' FOR UPDATE",
        [key, project],
      )
    ).rows[0];
    requireThat(old, 404, "网络计划不存在");
    requireThat(old.version === b.version, 409, "网络计划已更新，请刷新后重试");
    if (
      old.name !== b.document.name ||
      old.granularity !== b.document.granularity ||
      old.start_date !== b.document.start_date ||
      JSON.stringify(old.calendar_config || null) !==
        JSON.stringify(b.document.calendar_config || null)
    )
      requireThat(canManage(a), 403, "调整方案设置需要项目管理权限");
    const doc = b.document;
    if(req.body.document.swimlanes===undefined)doc.swimlanes=old.swimlanes||[];
    const previous=new Map<string,any>(old.activities.map((row:any)=>[row.id,row]));for(const row of doc.activities)if(row.network_status!==undefined&&(!previous.has(row.id)||previous.get(row.id).duration!==row.duration)){try{validateDurationHours(row.duration,(doc.calendar_config||a.calendar_config||defaultProjectCalendar).hours_per_day)}catch(e){requireThat(false,400,(e as Error).message)}}
    await calculate(
      doc.activities,
      { ...a, calendar_config: doc.calendar_config || a.calendar_config },
      doc.start_date,
      doc.decisions,
    );
    await c.query(
      "UPDATE network_plans SET name=$1,granularity=$2,start_date=$3,activities=$4,version=version+1,updated_at=now(),diagram_layout=$6,calendar_config=$7 WHERE id=$5",
      [
        doc.name,
        doc.granularity,
        doc.start_date,
        JSON.stringify(doc.activities),
        key,
        JSON.stringify(doc.diagram_layout),
        doc.calendar_config ? JSON.stringify(doc.calendar_config) : null,
      ],
    );
    await c.query("UPDATE network_plans SET decisions=$1,swimlanes=$3 WHERE id=$2", [
      JSON.stringify(doc.decisions),
      key,
      JSON.stringify(doc.swimlanes),
    ]);
    await audit(c, a.workspace_id, req.user.id, "更新独立网络计划", key, {
      version: b.version,
      activities: doc.activities.length,
    });
  });
  res.json({ ok: true });
});
networkPlans.delete(path + "/:plan", async (req, res) => {
  const project = id.parse(req.params.project),
    key = id.parse(req.params.plan),
    b = z.object({ version: z.number().int().min(1) }).parse(req.body);
  await tx(async (c) => {
    await lockReferenceProject(c, project);
    const a = await access(req.user.id, project, c);
    editable(a, true);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const result = await c.query(
      "UPDATE network_plans SET lifecycle='deleted',version=version+1,updated_at=now() WHERE id=$1 AND project_id=$2 AND version=$3 AND lifecycle='active' RETURNING id",
      [key, project, b.version],
    );
    requireThat(result.rowCount, 409, "网络计划不存在或版本已更新");
    await audit(c, a.workspace_id, req.user.id, "删除独立网络计划", key);
  });
  res.json({ ok: true });
});
