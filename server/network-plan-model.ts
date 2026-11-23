import {networkSwimlanes} from '../shared/network-swimlanes.ts';
import {networkTaskValue} from '../shared/network-task.ts';
import { z } from "zod";
import { activity, date, id, name } from "./validation.ts";
import { validateCalendar } from "../shared/project-calendar.ts";
import type { ProjectCalendar } from "../shared/project-calendar.ts";
export const networkMetadata = z.object({
  name,
  granularity: z.string().trim().min(1).max(40),
  start_date: date,
});
export const networkDocument = networkMetadata
  .extend({
    swimlanes:networkSwimlanes,
    decisions: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          type: z.enum(["event", "random"]),
          label: z.string().min(1).max(120),
          branches: z.tuple([id, id]),
          selected: id,
          probability: z.number().min(0).max(100).default(50),
        }),
      )
      .max(100)
      .default([]),
    diagram_layout: z
      .record(z.string().max(100), z.number().finite().min(0))
      .default({}),
    calendar_config: z
      .custom<ProjectCalendar>((v) => {
        try {
          validateCalendar(v as ProjectCalendar);
          return true;
        } catch {
          return false;
        }
      }, "网络计划日历无效")
      .nullable()
      .optional(),
    activities: z
      .array(
        activity
          .omit({ department_id: true })
          .extend({
            id,
            activity_type:z.enum(['任务','开始里程碑','完成里程碑']).default('任务'),
            network_status:z.enum(['未开始','进行中','已完成']).optional(),
            start_offset: z.number().min(0).max(36500).default(0),
            source_activity_id: id.optional(),
            is_dummy: z.boolean().optional(),
            event_start_id: z.string().max(100).optional(),
            event_finish_id: z.string().max(100).optional(),
            duration: z.number().min(0).max(3650),
            predecessors: z
              .array(
                z.object({
                  id,
                  type: z.enum(["FS", "SS", "FF", "SF"]),
                  lag: z.number().min(-3650).max(3650),
                }),
              )
              .default([]),
          }),
      )
      .max(500),
  })
  .superRefine((doc, ctx) => {
    for(const [i,a] of doc.activities.entries()){try{networkTaskValue({...a,activity_type:a.is_dummy?'虚工作':a.activity_type},0);if((a.activity_type!=='任务'||a.is_dummy&&a.network_status!==undefined)&&a.duration!==0)throw Error('里程碑工期必须为0');if(a.network_status==='已完成'&&a.progress!==100||a.network_status==='未开始'&&a.progress!==0)throw Error('作业状态与完成率不一致')}catch(e){ctx.addIssue({code:'custom',message:(e as Error).message,path:['activities',i]})}}
    const ids = new Set<string>(),
      codes = new Set<string>();
    doc.activities.forEach((a, i) => {
      if (ids.has(a.id) || codes.has(a.code))
        ctx.addIssue({
          code: "custom",
          message: "作业ID或编码重复",
          path: ["activities", i],
        });
      ids.add(a.id);
      codes.add(a.code);
    });
    const branchIds = new Set<string>();
    for (const d of doc.decisions) {
      const branches = d.branches.map((id) =>
        doc.activities.find((a) => a.id === id),
      );
      if (
        d.branches[0] === d.branches[1] ||
        !d.branches.includes(d.selected) ||
        branches.some((a) => !a) ||
        branches.some((a) => a?.event_start_id !== d.id) ||
        d.branches.some((id) => branchIds.has(id)) ||
        doc.activities.filter((a) => a.event_start_id === d.id).length !== 2
      )
        ctx.addIssue({
          code: "custom",
          message: "决策节点必须关联两个不同任务并且仅选择其中一个",
        });
      d.branches.forEach((id) => branchIds.add(id));
    }
    if (new Set(doc.decisions.map((d) => d.id)).size !== doc.decisions.length)
      ctx.addIssue({ code: "custom", message: "决策节点标识重复" });
    doc.activities.forEach((a, i) => {
      const predecessors = new Set<string>();
      a.predecessors.forEach((d) => {
        if (d.id === a.id || !ids.has(d.id) || predecessors.has(d.id))
          ctx.addIssue({
            code: "custom",
            message: "前置作业不存在、自依赖或重复关联",
            path: ["activities", i, "predecessors"],
          });
        predecessors.add(d.id);
      });
    });
  });
