import { Router } from "express";
import { z } from "zod";
import { pool, tx, uid, audit } from "./db.ts";
import { access, canManage, requireThat } from "./auth.ts";
import { id, date } from "./validation.ts";
import { networkDocument } from "./network-plan-model.ts";
import { scheduleNetwork } from "./network-schedule.ts";
import {
  validateCalendar,
  type ProjectCalendar,
} from "../shared/project-calendar.ts";
export const diagramImport = Router();
const number = z.number().finite();
const key = z.union([z.string().min(1).max(100), z.number()]).transform(String);
const task = z.object({
  id: key,
  code: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120),
  duration: number.min(0).max(3650),
  startOffset: number.min(0).max(36500).optional(),
  lane: number.min(0).optional(),
  startNodeId: key,
  endNodeId: key,
  status: z.enum(["active", "abandoned"]).optional(),
  priority: z.string().optional(),
  actualProgress: number.min(0).max(100).optional(),
  dependencies: z
    .array(
      z.object({
        taskId: key,
        type: z.enum(["FS", "SS", "FF", "SF"]),
        lag: number.min(-3650).max(3650),
      }),
    )
    .max(500)
    .default([]),
});
const input = z.object({
  projectName: z.string().max(120).optional(),
  projectStartDate: date.optional(),
  tasks: z.array(task).min(1).max(500),
  nodes: z
    .array(
      z.object({
        id: key,
        y: number.optional(),
        type: z.enum(["event", "decision"]).optional(),
        selectedBranchId: key.optional(),
        priority: z.string().optional(),
        decisionType: z.enum(["human", "event", "random"]).optional(),
        label: z.string().max(120).optional(),
        probability: number.min(0).max(100).optional(),
      }),
    )
    .max(1200),
  calendar: z
    .object({
      workingDays: z.array(z.number().int().min(0).max(6)).min(1),
      workHoursPerDay: number.min(1 / 60).max(24),
      holidays: z.array(date).max(1000).default([]),
      overrides: z.record(z.string(), z.boolean()).optional(),
    })
    .optional(),
});

export function convertDiagram(raw: unknown, defaultStart: string) {
  let nativeCalendar: ProjectCalendar | null = null;
  const native: any = raw;
  let nativeDecisions: any[] = [];
  let nativeSwimlanes:any[]=[];
  if (native?.format === "project-studio-network-plan") {
    const doc = networkDocument.parse(native);
    nativeDecisions = doc.decisions;
    nativeSwimlanes=doc.swimlanes;
    nativeCalendar = doc.calendar_config || null;
    const events = new Map<string, any>();
    const tasks = doc.activities.map((a) => {
      const s = a.event_start_id || a.id + ":S",
        e = a.event_finish_id || a.id + ":F";
      events.set(s, {
        id: s,
        y:
          doc.diagram_layout["event:" + s] ||
          doc.diagram_layout[a.id + ":S"] ||
          0,
      });
      events.set(e, {
        id: e,
        y:
          doc.diagram_layout["event:" + e] ||
          doc.diagram_layout[a.id + ":F"] ||
          0,
      });
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        duration: a.duration,
        startOffset: a.start_offset,
        lane: doc.diagram_layout["task:" + a.id],
        startNodeId: s,
        endNodeId: e,
        actualProgress: a.progress,
        dependencies: a.predecessors.map((d) => ({
          taskId: d.id,
          type: d.type,
          lag: d.lag,
        })),
      };
    });
    raw = {
      projectName: doc.name,
      projectStartDate: doc.start_date,
      nodes: [...events.values()].map((n) => {
        const d = nativeDecisions.find((d) => d.id === n.id);
        return d
          ? {
              ...n,
              type: "decision",
              decisionType: d.type,
              label: d.label,
              probability: d.probability,
              selectedBranchId: d.selected,
            }
          : n;
      }),
      tasks,
    };
  }
  const file = input.parse(raw),
    nodes = new Map(file.nodes.map((n) => [n.id, n]));
  requireThat(
    new Set(file.tasks.map((t) => t.id)).size === file.tasks.length,
    400,
    "图纸作业标识重复",
  );
  requireThat(nodes.size === file.nodes.length, 400, "图纸事件标识重复");
  const ids = new Map(file.tasks.map((t) => [t.id, uid()]));
  for (const t of file.tasks) {
    requireThat(
      nodes.has(t.startNodeId) &&
        nodes.has(t.endNodeId) &&
        t.startNodeId !== t.endNodeId,
      400,
      "图纸事件引用无效",
    );
    for (const d of t.dependencies)
      requireThat(ids.has(d.taskId), 400, "图纸逻辑关系引用无效");
  }
  for (const n of file.nodes)
    if (n.selectedBranchId)
      requireThat(
        file.tasks.some(
          (t) => t.id === n.selectedBranchId && t.startNodeId === n.id,
        ),
        400,
        "决策分支引用无效",
      );
  const chosen = file.tasks.filter((t) => t.status !== "abandoned");
  const indegree = new Map(file.nodes.map((n) => [n.id, 0]));
  for (const t of chosen)
    indegree.set(t.endNodeId, indegree.get(t.endNodeId)! + 1);
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const n = queue.shift()!;
    visited++;
    for (const t of chosen.filter((t) => t.startNodeId === n)) {
      indegree.set(t.endNodeId, indegree.get(t.endNodeId)! - 1);
      if (indegree.get(t.endNodeId) === 0) queue.push(t.endNodeId);
    }
  }
  requireThat(visited === file.nodes.length, 400, "图纸网络存在循环");
  const roots = file.nodes
      .filter((n) => !file.tasks.some((t) => t.endNodeId === n.id))
      .map((n) => n.id),
    reachable = new Set(roots);
  for (let pass = 0; pass < file.nodes.length; pass++) {
    let changed = false;
    for (const t of chosen)
      if (reachable.has(t.startNodeId) && !reachable.has(t.endNodeId)) {
        reachable.add(t.endNodeId);
        changed = true;
      }
    if (!changed) break;
  }
  requireThat(roots.length > 0, 400, "图纸网络存在循环");
  const active = chosen.filter((t) => reachable.has(t.startNodeId)),
    activeIds = new Set(active.map((t) => t.id));
  requireThat(active.length > 0, 400, "图纸没有可排程的活动分支");
  const layout: Record<string, number> = {};
  const activities = active.map((t, i) => {
    const dependencies = new Map(
      t.dependencies
        .filter((d) => activeIds.has(d.taskId))
        .map((d) => [
          d.taskId,
          { id: ids.get(d.taskId)!, type: d.type, lag: d.lag },
        ]),
    );
    for (const p of active.filter((p) => p.endNodeId === t.startNodeId))
      if (!dependencies.has(p.id))
        dependencies.set(p.id, { id: ids.get(p.id)!, type: "FS", lag: 0 });
    const k = ids.get(t.id)!;
    if (t.lane !== undefined) layout["task:" + k] = t.lane;
    layout["event:" + t.startNodeId] = Math.max(
      0,
      nodes.get(t.startNodeId)?.y ?? i,
    );
    layout["event:" + t.endNodeId] = Math.max(
      0,
      nodes.get(t.endNodeId)?.y ?? i,
    );
    return {
      id: k,
      code: t.code || "D" + (i + 1).toString().padStart(3, "0"),
      name: t.name,
      duration: t.duration,
      start_offset: t.startOffset || 0,
      progress: t.actualProgress || 0,
      is_dummy: t.duration === 0,
      event_start_id: t.startNodeId,
      event_finish_id: t.endNodeId,
      predecessors: [...dependencies.values()],
    };
  });
  let calendar: ProjectCalendar | null = nativeCalendar;
  if (file.calendar) {
    const c = file.calendar,
      h = c.workHoursPerDay,
      totalMinutes = Math.round(h * 60);
    const periods: [string, string][] = [
      [
        "00:00",
        String(Math.floor(totalMinutes / 60)).padStart(2, "0") +
          ":" +
          String(totalMinutes % 60).padStart(2, "0"),
      ],
    ];
    calendar = {
      name: "图纸工作日历",
      week: Array.from({ length: 7 }, (_, day) =>
        c.workingDays.includes(day) ? periods : [],
      ),
      exceptions: {},
      hours_per_day: h,
      hours_per_week: h * c.workingDays.length,
      hours_per_month: Math.min(744, (h * c.workingDays.length * 52) / 12),
      hours_per_year: Math.min(8784, h * c.workingDays.length * 52),
    };
    for (const day of c.holidays) calendar.exceptions[day] = [];
    for (const [day, working] of Object.entries(c.overrides || {}))
      calendar.exceptions[day] = working ? periods : [];
    validateCalendar(calendar);
  }
  const decisions = file.nodes
    .filter((n) => n.type === "decision")
    .map((n) => {
      const branches = active.filter((t) => t.startNodeId === n.id);
      requireThat(branches.length === 2, 400, "决策节点后必须恰有两个任务");
      const selected =
        n.selectedBranchId ||
        branches.find((t) => n.priority && t.priority === n.priority)?.id ||
        branches[0].id;
      return {
        id: n.id,
        type: n.decisionType === "random" ? "random" : "event",
        label: n.label || n.id,
        branches: branches.map((t) => ids.get(t.id)),
        selected: ids.get(selected),
        probability:
          n.probability ??
          nativeDecisions.find((d) => d.id === n.id)?.probability ??
          50,
      };
    });
  const document = networkDocument.parse({
    name: file.projectName || "导入网络计划",
    granularity: "详细计划",
    start_date: file.projectStartDate || defaultStart,
    activities,
    decisions,
    diagram_layout: layout,
    swimlanes:nativeSwimlanes,
    calendar_config: calendar,
  });
  scheduleNetwork(
    document.activities,
    document.decisions,
    calendar,
    document.start_date,
  );

  return {
    file,
    document,
    ids,
    active,
    skipped: file.tasks.length - active.length,
  };
}
diagramImport.post("/projects/:project/network-import", async (req, res) => {
  const project = id.parse(req.params.project);
  const result = await tx(async (c) => {
    const a = await access(req.user.id, project, c);
    requireThat(
      canManage(a) &&
        a.lifecycle === "active" &&
        a.workspace_lifecycle === "active",
    );
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const converted = convertDiagram(
        req.body,
        new Date(a.start_date).toISOString().slice(0, 10),
      ),
      { file, document, ids, active } = converted;
    // A collision creates a separately named scenario; importing never overwrites a project plan.
    let planName = document.name,
      sequence = 1;
    while (
      (
        await c.query(
          "SELECT 1 FROM network_plans WHERE project_id=$1 AND name=$2 AND lifecycle='active'",
          [project, planName],
        )
      ).rowCount
    )
      planName = document.name.slice(0, 105) + " (" + sequence++ + ")";
    const plan = uid();
    await c.query(
      "INSERT INTO network_plans(id,project_id,name,granularity,start_date,activities,diagram_layout,calendar_config,import_snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        plan,
        project,
        planName,
        document.granularity,
        document.start_date,
        JSON.stringify(document.activities),
        JSON.stringify(document.diagram_layout),
        document.calendar_config
          ? JSON.stringify(document.calendar_config)
          : null,
        JSON.stringify(file),
        req.user.id,
      ],
    );
    await c.query("UPDATE network_plans SET decisions=$1,swimlanes=$3 WHERE id=$2", [
      JSON.stringify(document.decisions),
      plan,
      JSON.stringify(document.swimlanes),
    ]);
    await audit(c, a.workspace_id, req.user.id, "导入双代号图纸", plan, {
      activities: active.length,
      skipped: converted.skipped,
    });
    return {
      id: plan,
      imported_activities: active.length,
      skipped_activities: converted.skipped,
    };
  });
  res.status(201).json(result);
});
