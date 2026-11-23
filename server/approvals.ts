import {captureBaselineBudget} from './baseline-budget.ts';
import {requireFullPlanRead} from './planning-read-access.ts';
import {defaultProjectCalendar} from "../shared/project-calendar.ts";
import {effectiveActivities} from './effective-activities.ts';
import {reviewMode} from '../shared/record-policy.ts';
import {isDeepStrictEqual} from "node:util";
import { validatePlanSchedule } from "./plan-table.ts";
import {
  prepareResourceChange,
  applyResourceChange,
} from "./resource-changes.ts";
import { Router } from "express";
import { z } from "zod";
import type pg from "pg";
import {
  pool,
  uid,
  tx,
  audit,
  engineeringStages,
  businessStages,
} from "./db.ts";
import {
  access,
  workspaceMember,
  canManage,
  canWrite,
  operationAllowed,
  canRecordAction,
  tableAccess,
  rowAllowed,
  rowScopeAllowed,
  visibleColumns,
  projectRecord,
  requireThat,
} from "./auth.ts";
import { id, name, membership } from "./validation.ts";
import { validateGrant, saveGrant } from "./governance.ts";
import { schedule } from "./schedule.ts";
import { notifyUser } from "./notifications.ts";
import { projectReferenceRows,lockReferenceProject } from "./references.ts";

export const approvals = Router();
const kindSchema = z.enum([
  "record",
  "stage",
  "baseline",
  "access",
  "resource",
]);
const stepSchema = z.object({
  name,
  approver_id: id,
  mode: z.literal("one").default("one"),
});
const stepsSchema = z
  .array(stepSchema)
  .min(2)
  .max(8)
  .refine(
    (steps) => new Set(steps.map((s) => s.approver_id)).size === steps.length,
    "每个节点必须指定不同的审批人",
  );
type Db = pg.Pool | pg.PoolClient;

async function reviewerFor(
  user: string,
  project: string,
  kind: string,
  c: Db,
  record?: any,
) {
  requireThat(
    (await c.query("SELECT 1 FROM users WHERE id=$1 AND active", [user]))
      .rowCount,
    400,
    "审批人已停用或不存在",
  );
  const a = await access(user, project, c);
  requireThat(
    kind === "access"
      ? a.role === "owner"
      : kind === "record"
        ? ["owner", "manager", "reviewer"].includes(a.role)
        : canManage(a),
    403,
    "审批人不具备该业务的审批权限",
  );
  if (record) {
    const { table } = await tableAccess(user, record.table_id, c);
    requireThat(
      table.project_id === project && rowScopeAllowed(a, record, user),
      403,
      "审批人的数据范围不覆盖该记录",
    );
    requireThat(
      visibleColumns(a, table).length ===
        table.columns.filter((f: any) => f.lifecycle !== "deleted").length,
      403,
      "审批人必须可查看记录的全部字段",
    );
  }
  return a;
}
async function event(
  c: pg.PoolClient,
  ap: any,
  actor: string,
  action: string,
  opinion = "",
) {
  const flow = ap.payload?._workflow,
    index = flow?.index ?? 0;
  await c.query(
    "INSERT INTO approval_events(approval_id,actor_id,action,node_index,node_name,opinion) VALUES($1,$2,$3,$4,$5,$6)",
    [
      ap.id,
      actor,
      action,
      index,
      flow?.steps[index]?.name || "单人审批",
      opinion,
    ],
  );
}
async function requesterValid(ap: any, c: Db) {
  requireThat(
    (
      await c.query(
        "SELECT 1 FROM users u JOIN projects p ON p.id=$2 WHERE u.id=$1 AND u.active AND (u.system_admin OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=p.workspace_id AND wm.user_id=u.id))",
        [ap.requester_id, ap.project_id],
      )
    ).rowCount,
    409,
    "申请人已停用或不再属于工作空间",
  );
  if (ap.kind !== "access") {
    const a = await access(ap.requester_id, ap.project_id, c);
    requireThat(
      ["record", "resource"].includes(ap.kind) ? canWrite(a) : canManage(a),
      403,
      "申请人已无此业务操作权限",
    );
    if (ap.kind === "resource")
      await prepareResourceChange(
        c as pg.PoolClient,
        ap.requester_id,
        ap.project_id,
        ap.payload,
        true,
      );
    if (ap.kind === "record") {
      const record = (
        await c.query("SELECT * FROM records WHERE id=$1", [ap.record_id])
      ).rows[0];
      const { table } = await tableAccess(ap.requester_id, record.table_id, c);
      requireThat(
        canRecordAction(a, table, "update"),
        403,
        "申请人已无记录提交权限",
      );
      requireThat(
        table.project_id === ap.project_id &&
          rowAllowed(a, record, ap.requester_id),
      );
    }
  }
}

approvals.get("/projects/:project/workflows", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  res.json(
    (
      await pool.query(
        "SELECT * FROM workflow_definitions WHERE project_id=$1 ORDER BY kind,name,version DESC",
        [a.id],
      )
    ).rows,
  );
});
approvals.post("/projects/:project/workflows", async (req, res) => {
  const project = id.parse(req.params.project),
    body = z
      .object({ kind: kindSchema, name, version:z.number().int().min(1).max(2147483647).optional(), steps: stepsSchema, table_ids: z.array(id).max(100).default([]) })
      .parse(req.body);
  const result = await tx(async (c) => {
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const a = await access(req.user.id, project, c);
    requireThat(body.kind === "access" ? a.role === "owner" : canManage(a));
    requireThat(body.kind==='record'||!body.table_ids.length,400,'仅记录审批支持按表配置');
    requireThat(new Set(body.table_ids).size===body.table_ids.length,400,'适用表不能重复');
    for(const tableId of body.table_ids){const {table}=await tableAccess(req.user.id,tableId,c);requireThat(table.project_id===project&&table.lifecycle==='active',400,'审批表不属于当前活动项目');}
    for (const step of body.steps)
      await reviewerFor(step.approver_id, project, body.kind, c);
    const version = body.version ?? Number(
      (
        await c.query(
          "SELECT coalesce(max(version),0)+1 AS version FROM workflow_definitions WHERE project_id=$1 AND kind=$2 AND name=$3",
          [project, body.kind, body.name],
        )
      ).rows[0].version,
    );
    requireThat(!(await c.query("SELECT 1 FROM workflow_definitions WHERE project_id=$1 AND kind=$2 AND name=$3 AND version=$4",[project,body.kind,body.name,version])).rowCount,409,"同名流程的该版本已存在，请使用其他版本号");
    await c.query(
      "UPDATE workflow_definitions SET active=false WHERE project_id=$1 AND kind=$2 AND name=$3 AND active",
      [project, body.kind,body.name],
    );
    const workflow = uid();
    await c.query(
      "INSERT INTO workflow_definitions(id,project_id,kind,name,steps,version,created_by,table_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        workflow,
        project,
        body.kind,
        body.name,
        JSON.stringify(body.steps),
        version,
        req.user.id,
        JSON.stringify(body.table_ids),
      ],
    );
    await audit(c, a.workspace_id, req.user.id, "发布审批流程", workflow, {
      kind: body.kind,
      version,
      steps: body.steps.length,
    });
    return { id: workflow, version };
  });
  res.status(201).json(result);
});
approvals.patch("/workflows/:workflow", async (req, res) => {
  const config=z.object({name,version:z.number().int().min(1).max(2147483647),steps:stepsSchema,table_ids:z.array(id).max(100),active:z.boolean()});
  const body=config.partial().extend({expected:config.optional()}).strict().parse(req.body);
  requireThat(Object.keys(body).some(k=>k!=="expected"),400,"请提供流程设置");
  await tx(async c=>{
    const key=id.parse(req.params.workflow);
    const initial=(await c.query("SELECT project_id FROM workflow_definitions WHERE id=$1",[key])).rows[0];
    requireThat(initial,404,"流程不存在");
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE",[initial.project_id]);
    const w=(await c.query("SELECT * FROM workflow_definitions WHERE id=$1 FOR UPDATE",[key])).rows[0];
    const a=await access(req.user.id,w.project_id,c);
    requireThat(w.kind==="access"?a.role==="owner":canManage(a));
    if(body.expected)for(const field of ["name","version","steps","table_ids","active"] as const)
      requireThat(isDeepStrictEqual(body.expected[field],w[field]),409,"流程已被其他管理员修改，请刷新后重试");
    const next=config.parse({...w,...body});
    requireThat(w.kind==='record'||!next.table_ids.length,400,'仅记录审批支持按表配置');
    requireThat(new Set(next.table_ids).size===next.table_ids.length,400,'适用表不能重复');
    for(const tableId of next.table_ids){const {table}=await tableAccess(req.user.id,tableId,c);requireThat(table.project_id===w.project_id&&table.lifecycle==='active',400,'审批表不属于当前活动项目');}
    if(next.active||body.steps)for(const step of next.steps)await reviewerFor(step.approver_id,w.project_id,w.kind,c);
    requireThat(!(await c.query("SELECT 1 FROM workflow_definitions WHERE project_id=$1 AND kind=$2 AND name=$3 AND version=$4 AND id<>$5",[w.project_id,w.kind,next.name,next.version,key])).rowCount,409,"同名流程的该版本已存在，请使用其他版本号");
    if(next.active)await c.query("UPDATE workflow_definitions SET active=false WHERE project_id=$1 AND kind=$2 AND name=$3 AND id<>$4 AND active",[w.project_id,w.kind,next.name,key]);
    await c.query("UPDATE workflow_definitions SET name=$2,version=$3,steps=$4,table_ids=$5,active=$6 WHERE id=$1",[key,next.name,next.version,JSON.stringify(next.steps),JSON.stringify(next.table_ids),next.active]);
    const changed=["name","version","steps","table_ids","active"].filter(field=>!isDeepStrictEqual(next[field as keyof typeof next],w[field]));
    await audit(c,a.workspace_id,req.user.id,changed.length===1&&changed[0]==="active"?(next.active?"启用审批流程":"停用审批流程"):"编辑审批流程",key,{before:{name:w.name,version:w.version,steps:w.steps,table_ids:w.table_ids,active:w.active},after:next});
  });
  res.json({ok:true});
});

approvals.post("/projects/:project/approvals", async (req, res) => {
  const project = id.parse(req.params.project),
    body = z
      .object({
        kind: kindSchema,
        title: name,
        approver_id: id.optional(),
        record_id: id.optional(),
        workflow_id: id.optional(),
        attachment_ids:z.array(id).max(10).default([]),
        payload: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(req.body);
  const result = await tx(async (c) => {
    if(body.kind==='baseline')await lockReferenceProject(c,project);
    const p = (
      await c.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [project])
    ).rows[0];
    requireThat(p, 404, "项目不存在");
    requireThat(await workspaceMember(req.user.id, p.workspace_id, c));
    let payload: any = {},
      record: any = null;
    if (body.kind === "access") {
      payload = membership.parse(body.payload);
      requireThat(
        payload.role !== "manager",
        400,
        "项目经理须由空间所有者直接配置",
      );
      await validateGrant(project, payload, c);
    } else {
      const a = await access(req.user.id, project, c);
      requireThat(
        ["record", "resource"].includes(body.kind) ? canWrite(a) : canManage(a),
      );
      if (body.kind === "record") {
        record = (
          await c.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [
            id.parse(body.record_id),
          ])
        ).rows[0];
        requireThat(record, 404, "记录不存在");
        const { table } = await tableAccess(req.user.id, record.table_id, c);
        requireThat(reviewMode(table)==='approval',409,'普通数据无需申请审批，请由本部门主管确认状态');
        requireThat(
          canRecordAction(a, table, "update"),
          403,
          "没有记录提交权限",
        );
        requireThat(
          table.project_id === project && rowAllowed(a, record, req.user.id),
        );
        requireThat(
          ["draft", "rejected"].includes(record.status),
          409,
          "当前记录不能重复提交",
        );
        payload = {
          version: record.version + 1,
          _record_links: {
            attachments: (
              await c.query(
                `SELECT v.id,l.file_name,v.version,v.size_bytes,v.sha256 FROM record_file_links l JOIN project_file_versions v ON v.id=l.file_version_id WHERE l.record_id=$1 ORDER BY l.created_at,l.id`,
                [record.id],
              )
            ).rows,
            activities: (
              await c.query(
                `SELECT a.id,a.code,a.name FROM record_activity_links l JOIN activities a ON a.id=l.activity_id WHERE l.record_id=$1 ORDER BY a.code,a.id`,
                [record.id],
              )
            ).rows,
          },
        };
      } else if (body.kind === "resource") {
        payload = await prepareResourceChange(
          c,
          req.user.id,
          project,
          body.payload,
          true,
        );
        requireThat(payload.reason, 400, "请填写资源费用变更说明");
      } else if (body.kind === "stage") {
        payload = z
          .object({
            engineering_stage: z.enum(
              engineeringStages as [string, ...string[]],
            ),
            business_stage: z.enum(businessStages as [string, ...string[]]),
            reason: z.string().trim().min(1).max(1000),
          })
          .parse(body.payload);
        payload.previous = {
          engineering_stage: p.engineering_stage,
          business_stage: p.business_stage,
        };
      } else {
        const permission=await access(req.user.id,project,c);
        await requireFullPlanRead(permission,c);
        const activities=await effectiveActivities(project,c);
        requireThat(activities.length > 0, 400, "项目还没有计划作业");
        const calculated=schedule(activities,p.calendar_config||defaultProjectCalendar,p.start_date);
        payload = {
          ...calculated,
          calendar_config: p.calendar_config||defaultProjectCalendar,
          start_date: p.start_date,
          ...await captureBaselineBudget(c,project,calculated.activities,p.currency),
        };
      }
    }
    if(body.attachment_ids.length){
      const permission=await access(req.user.id,project,c);
      requireThat(operationAllowed(permission,"$files","read"),403,"没有项目文件读取权限");
      const keys=[...new Set(body.attachment_ids)];
      const attachments=(await c.query(`SELECT f.id AS file_id,f.name,v.id AS version_id,v.version,v.size_bytes,v.sha256 FROM project_files f JOIN project_file_versions v ON v.file_id=f.id AND v.version=f.current_version WHERE f.id=ANY($1::uuid[]) AND f.project_id=$2 AND f.kind='file' AND f.lifecycle='active' FOR SHARE OF f`,[keys,project])).rows;
      requireThat(attachments.length===keys.length,400,"附件不存在、已删除或不属于当前项目");
      payload._attachments=attachments;
    }
    const flow = (
      await c.query(
        "SELECT * FROM workflow_definitions WHERE project_id=$1 AND kind=$2 AND active AND (jsonb_array_length(table_ids)=0 OR (kind='record' AND table_ids ? $3)) AND ($4::uuid IS NULL OR id=$4) ORDER BY (jsonb_array_length(table_ids)>0) DESC,created_at DESC LIMIT 1",
        [project, body.kind,record?.table_id||'',body.workflow_id||null],
      )
    ).rows[0];
    if (body.workflow_id)
      requireThat(
        flow?.id === body.workflow_id,
        409,
        "审批流程已变化，请刷新后提交",
      );
    let approver: string;
    if (flow) {
      const steps = stepsSchema.parse(flow.steps);
      for (const step of steps) {
        requireThat(
          step.approver_id !== req.user.id,
          400,
          "审批流程任何节点都不能包含申请人本人",
        );
        await reviewerFor(step.approver_id, project, body.kind, c, record);
      }
      payload._workflow = {
        id: flow.id,
        name: flow.name,
        version: flow.version,
        index: 0,
        steps,
      };
      approver = steps[0].approver_id;
    } else {
      let selected = body.approver_id;
      if (body.kind === "access")
        selected = (
          await c.query(
            "SELECT wm.user_id FROM workspace_members wm JOIN users u ON u.id=wm.user_id WHERE wm.workspace_id=$1 AND wm.role='owner' AND u.active AND wm.user_id<>$2 ORDER BY u.created_at LIMIT 1",
            [p.workspace_id, req.user.id],
          )
        ).rows[0]?.user_id;
      requireThat(
        selected && selected !== req.user.id,
        400,
        "请选择其他有效审批人，不能自审",
      );
      approver = selected;
      await reviewerFor(approver, project, body.kind, c, record);
    }
    if (record)
      await c.query(
        "UPDATE records SET status='pending',version=version+1,updated_at=now() WHERE id=$1",
        [record.id],
      );
    const approval = uid();
    await c.query(
      "INSERT INTO approvals(id,project_id,kind,title,record_id,requester_id,approver_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        approval,
        project,
        body.kind,
        body.title,
        record?.id || null,
        req.user.id,
        approver,
        JSON.stringify(payload),
      ],
    );
    await event(c, { id: approval, payload }, req.user.id, "submit");
    await audit(c, p.workspace_id, req.user.id, "提交申请", approval, {
      kind: body.kind,
    });
    await notifyUser(
      c,
      approver,
      project,
      "approval",
      approval,
      "收到新的待审申请",
    );
    return { id: approval };
  });
  res.status(201).json(result);
});

approvals.post("/approvals/:approval/decide", async (req, res) => {
  const body = z
    .object({
      action: z.enum(["approve", "reject", "withdraw"]),
      opinion: z.string().trim().max(2000).default(""),
    })
    .parse(req.body);
  const result = await tx(async (c) => {
    const ap = (
      await c.query("SELECT * FROM approvals WHERE id=$1 FOR UPDATE", [
        id.parse(req.params.approval),
      ])
    ).rows[0];
    requireThat(ap, 404, "申请不存在");
    requireThat(ap.status === "pending", 409, "申请已处理，请刷新");
    const p = (
      await c.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [
        ap.project_id,
      ])
    ).rows[0];
    const record =
      ap.kind === "record"
        ? (
            await c.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [
              ap.record_id,
            ])
          ).rows[0]
        : null;
    if (record)
      requireThat(
        record.status === "pending" && record.version === ap.payload.version,
        409,
        "申请记录版本不一致",
      );
    if (body.action === "withdraw")
      requireThat(ap.requester_id === req.user.id);
    else {
      requireThat(
        ap.approver_id === req.user.id && ap.requester_id !== req.user.id,
      );
      requireThat(
        body.action !== "reject" || body.opinion.length > 0,
        400,
        "请填写退回原因",
      );
      await reviewerFor(req.user.id, ap.project_id, ap.kind, c, record);
    }
    const approved = body.action === "approve",
      flow = ap.payload._workflow;
    if (approved) await requesterValid(ap, c);
    if (approved && flow && flow.index < flow.steps.length - 1) {
      const next = flow.steps[flow.index + 1];
      requireThat(
        next.approver_id !== ap.requester_id,
        409,
        "下一节点不能由申请人审批",
      );
      await reviewerFor(next.approver_id, ap.project_id, ap.kind, c, record);
      await event(c, ap, req.user.id, "approve", body.opinion);
      await c.query(
        "UPDATE approvals SET approver_id=$1,payload=$2 WHERE id=$3",
        [
          next.approver_id,
          JSON.stringify({
            ...ap.payload,
            _workflow: { ...flow, index: flow.index + 1 },
          }),
          ap.id,
        ],
      );
      await notifyUser(
        c,
        next.approver_id,
        ap.project_id,
        "approval",
        ap.id,
        "审批已转交，等待你的处理",
      );
      await audit(c, p.workspace_id, req.user.id, "通过审批节点", ap.id, {
        node: flow.index,
        opinion: body.opinion,
      });
      return { ok: true, status: "pending", next_node: next.name };
    }
    if (record) {
      if (approved && record.supersedes)
        requireThat(
          (
            await c.query(
              "UPDATE records SET status='obsolete',version=version+1,updated_at=now() WHERE id=$1 AND status='approved' RETURNING id",
              [record.supersedes],
            )
          ).rowCount,
          409,
          "原记录已被其他变更替换，请退回申请",
        );
      await c.query(
        "UPDATE records SET status=$1,version=version+1,updated_at=now() WHERE id=$2",
        [
          approved
            ? "approved"
            : body.action === "withdraw"
              ? "draft"
              : "rejected",
          record.id,
        ],
      );
    }
    if (record) await validatePlanSchedule(c, { id: record.table_id });
    if (approved && ap.kind === "resource")
      await applyResourceChange(
        c,
        ap.requester_id,
        ap.project_id,
        ap.payload,
        true,
        req.user.id,
      );
    if (approved && ap.kind === "access") {
      const grant = membership.parse(ap.payload);
      requireThat(
        grant.role !== "manager",
        400,
        "项目经理须由空间所有者直接配置",
      );
      await saveGrant(c, ap.project_id, ap.requester_id, grant);
    }
    if (approved && ap.kind === "stage") {
      requireThat(
        p.engineering_stage === ap.payload.previous?.engineering_stage &&
          p.business_stage === ap.payload.previous?.business_stage,
        409,
        "项目阶段已变化，请重新申请",
      );
      await c.query(
        "UPDATE projects SET engineering_stage=$1,business_stage=$2 WHERE id=$3",
        [
          ap.payload.engineering_stage,
          ap.payload.business_stage,
          ap.project_id,
        ],
      );
    }
    if (approved && ap.kind === "baseline") {
      const { _workflow, ...snapshot } = ap.payload;
      await c.query(
        "INSERT INTO baselines(id,project_id,name,snapshot,approved_by) VALUES($1,$2,$3,$4,$5)",
        [uid(), ap.project_id, ap.title, JSON.stringify(snapshot), req.user.id],
      );
    }
    const status = approved
      ? "approved"
      : body.action === "withdraw"
        ? "withdrawn"
        : "rejected";
    await event(c, ap, req.user.id, body.action, body.opinion);
    await c.query(
      "UPDATE approvals SET status=$1,opinion=$2,decided_at=now() WHERE id=$3",
      [status, body.opinion, ap.id],
    );
    await notifyUser(
      c,
      body.action === "withdraw" ? ap.approver_id : ap.requester_id,
      ap.project_id,
      "approval",
      ap.id,
      approved
        ? "你的申请已通过"
        : body.action === "withdraw"
          ? "一项待审申请已撤回"
          : "你的申请已退回",
    );
    await audit(
      c,
      p.workspace_id,
      req.user.id,
      approved
        ? "批准申请"
        : body.action === "withdraw"
          ? "撤回申请"
          : "退回申请",
      ap.id,
      { kind: ap.kind, opinion: body.opinion },
    );
    return { ok: true, status };
  });
  res.json(result);
});

approvals.get("/approvals/mine", async (req, res) => {
  const project = id.parse(req.query.project_id), workspace = id.parse(req.query.workspace_id);
  requireThat(await workspaceMember(req.user.id, workspace));
  requireThat((await pool.query("SELECT 1 FROM projects WHERE id=$1 AND workspace_id=$2 AND lifecycle<>'deleted'", [project, workspace])).rowCount, 404, "项目不属于当前工作空间");
  res.json((await pool.query(
    "SELECT a.id,a.project_id,a.kind,a.title,a.status,a.opinion,a.created_at,a.decided_at,a.requester_id,p.name AS project_name,u.name AS approver_name FROM approvals a JOIN projects p ON p.id=a.project_id JOIN users u ON u.id=a.approver_id WHERE a.requester_id=$1 AND a.project_id=$2 AND p.workspace_id=$3 ORDER BY a.created_at DESC LIMIT 200",
    [req.user.id, project, workspace],
  )).rows);
});
async function projectApprovalRows(user: string, project: string) {
  const a = await access(user, project);
  const rows = (
    await pool.query(
      "SELECT ap.*,u.name AS requester_name,v.name AS approver_name,r.table_id FROM approvals ap JOIN users u ON u.id=ap.requester_id JOIN users v ON v.id=ap.approver_id LEFT JOIN records r ON r.id=ap.record_id WHERE ap.project_id=$1 AND (ap.requester_id=$2 OR ap.approver_id=$2 OR $3 OR EXISTS(SELECT 1 FROM approval_events e WHERE e.approval_id=ap.id AND e.actor_id=$2)) ORDER BY ap.created_at DESC LIMIT 200",
      [project, user, canManage(a)],
    )
  ).rows;
  const result = [];
  for (const ap of rows) {
    if (ap.kind === "record") {
      try {
        const { table, permission } = await tableAccess(user, ap.table_id);
        const record = (
          await pool.query("SELECT * FROM records WHERE id=$1", [ap.record_id])
        ).rows[0];
        if (!record || !rowScopeAllowed(permission, record, user)) continue;
        ap.columns = visibleColumns(permission, table);
        const safe = (
          await projectReferenceRows(user, table, permission, [record])
        )[0];
        ap.record_data = safe.data;
        ap.record_references = safe.references;
        // A prior reviewer whose field access was reduced cannot read free-form opinions.
        if (
          ap.columns.length !==
          table.columns.filter((f: any) => f.lifecycle !== "deleted").length
        )
          ap.opinion = "";
      } catch {
        continue;
      }
    }
    result.push(ap);
  }
  return result;
}
approvals.get("/projects/:project/approvals", async (req, res) =>
  res.json(
    await projectApprovalRows(req.user.id, id.parse(req.params.project)),
  ),
);
approvals.get("/approvals/:approval/history", async (req, res) => {
  const ap = (
    await pool.query("SELECT * FROM approvals WHERE id=$1", [
      id.parse(req.params.approval),
    ])
  ).rows[0];
  requireThat(ap, 404, "申请不存在");
  if (ap.kind === "access" && ap.requester_id === req.user.id) {
    requireThat(
      (
        await pool.query(
          "SELECT 1 FROM workspace_members wm JOIN projects p ON p.workspace_id=wm.workspace_id WHERE p.id=$1 AND wm.user_id=$2",
          [ap.project_id, req.user.id],
        )
      ).rowCount,
    );
  } else {
    const a = await access(req.user.id, ap.project_id);
    requireThat(
      canManage(a) ||
        ap.requester_id === req.user.id ||
        ap.approver_id === req.user.id ||
        (
          await pool.query(
            "SELECT 1 FROM approval_events WHERE approval_id=$1 AND actor_id=$2",
            [ap.id, req.user.id],
          )
        ).rowCount,
    );
    if (ap.kind === "record") {
      const record = (
        await pool.query("SELECT * FROM records WHERE id=$1", [ap.record_id])
      ).rows[0];
      const { table } = await tableAccess(req.user.id, record.table_id);
      requireThat(
        rowScopeAllowed(a, record, req.user.id) &&
          visibleColumns(a, table).length ===
            table.columns.filter((f: any) => f.lifecycle !== "deleted").length,
        403,
        "查看完整审批历史需要记录全部字段权限",
      );
    }
  }
  const events = (
    await pool.query(
      "SELECT e.*,u.name AS actor_name FROM approval_events e JOIN users u ON u.id=e.actor_id WHERE e.approval_id=$1 ORDER BY e.id",
      [ap.id],
    )
  ).rows;
  const flow = ap.payload._workflow;
  res.json({
    events,
    status: ap.status,
    flow: flow
      ? {
          name: flow.name || "顺序审批",
          version: flow.version,
          index: flow.index,
          steps: flow.steps,
        }
      : null,
  });
});
