import {lockReferenceProject} from './references.ts';
import type pg from "pg";
import { z } from "zod";
import {
  access,
  canManage,
  canWrite,
  canRecordAction,
  rowAllowed,
  tableAccess,
  requireThat,
  isSystemAdmin,
  operationAllowed,
} from "./auth.ts";
import { uid, audit } from "./db.ts";
import { resourceValue, resourceCost,resourceTicks } from "../shared/resource-values.ts";
const exact = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return resourceValue(v);
  } catch (e) {
    ctx.addIssue({ code: "custom", message: (e as Error).message });
    return z.NEVER;
  }
});
export const resourceProposal = z.object({
  action: z.enum(["upsert", "delete"]).default("upsert"),
  activity_id: z.uuid(),
  resource_id: z.uuid(),
  version: z.number().int().min(0).optional(),
  quantity: exact.refine(v=>resourceTicks(v)<=10000000000000000n,'分配数量超过上限').optional(),
  planned_cost: exact.optional(),
  actual_cost: exact.optional(),
  activity_version: z.number().int().positive().optional(),
  resource_version: z.number().int().positive().optional(),
  record_version: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().max(1000).default(""),
});
type Db = pg.PoolClient;
export async function prepareResourceChange(
  c: Db,
  user: string,
  project: string,
  input: unknown,
  approval = false,
) {
  await lockReferenceProject(c,project);
  const b = resourceProposal.parse(input),
    a = await access(user, project, c);
  requireThat(
    canWrite(a) &&
      operationAllowed(a, "$data", b.action === "delete" ? "delete" : "update"),
  );
  requireThat(
    a.lifecycle === "active" && a.workspace_lifecycle === "active",
    409,
    "项目非活动状态",
  );
  if (b.action === "delete") requireThat(canManage(a));
  const activity = (
    await c.query(
      "SELECT * FROM activities WHERE id=$1 AND project_id=$2 FOR UPDATE",
      [b.activity_id, project],
    )
  ).rows[0];
  requireThat(activity, 404, "作业不存在");
  const resource = (
    await c.query(
      "SELECT * FROM project_resources WHERE id=$1 AND project_id=$2 AND active FOR SHARE",
      [b.resource_id, project],
    )
  ).rows[0];
  requireThat(resource, 404, "资源不存在或已停用");
  requireThat(resource.currency===a.currency,400,"资源币种与当前计划不一致，请选择相同币种的资源");
  const record = (
    await c.query(
      "SELECT r.* FROM plan_activity_records l JOIN records r ON r.id=l.record_id WHERE l.activity_id=$1 FOR SHARE OF r",
      [activity.id],
    )
  ).rows[0];
  if(b.action==='upsert'&&record&&['开始里程碑','完成里程碑'].includes(record.data?.activity_type))requireThat(false,400,'里程碑不分配资源，请使用普通作业');
  if (record) {
    const { table, permission } = await tableAccess(user, record.table_id, c);
    requireThat(
      table.lifecycle === "active" && record.lifecycle === "active",
      409,
      "作业数据已冻结或停用",
    );
    requireThat(
      canRecordAction(
        permission,
        table,
        b.action === "delete" ? "delete" : "update",
      ) && rowAllowed(permission, record, user),
      403,
      "没有此作业的数据修改权限",
    );
    requireThat(
      record.status !== "pending",
      409,
      "作业正在审批，请先完成或撤回审批",
    );
    if (!approval && !["draft", "rejected"].includes(record.status))
      requireThat(
        await isSystemAdmin(user, c),
        409,
        "作业已核准，请提交资源费用变更审批",
      );
  }
  const current = (
    await c.query(
      "SELECT ar.*,v.units::text actual_units FROM activity_resource_allocations ar LEFT JOIN activity_resource_actuals v ON v.allocation_id=ar.id WHERE ar.activity_id=$1 AND ar.resource_id=$2 FOR UPDATE OF ar",
      [activity.id, resource.id],
    )
  ).rows[0];
  requireThat(
    !current || b.version !== undefined,
    409,
    "更新分配必须携带版本，请刷新后重试",
  );
  requireThat(
    (b.version ?? 0) === (current?.version ?? 0),
    409,
    "资源分配已更新，请刷新后重新提交",
  );
  if (b.action === "delete") requireThat(current, 404, "资源分配不存在");
  requireThat(
    b.activity_version === undefined || b.activity_version === activity.version,
    409,
    "作业在申请后已变化，请重新申请",
  );
  requireThat(
    b.resource_version === undefined || b.resource_version === resource.version,
    409,
    "资源在申请后已变化，请重新申请",
  );
  requireThat(
    b.record_version === undefined ||
      b.record_version === (record?.version ?? null),
    409,
    "作业审核版本已变化，请重新申请",
  );
  let quantity = b.quantity,
    planned = b.planned_cost;
  if (b.action === "upsert") {
    requireThat(quantity !== undefined, 400, "请输入分配数量");
    try{planned=resourceCost(quantity,resource.rate,String(activity.duration));}catch(error){requireThat(false,400,'单价×分配数量×持续工作日超出金额范围，请检查输入');}
  }
  return {
    ...b,
    activity_name: `${activity.code} · ${activity.name}`,
    resource_name: resource.name,
    version: current?.version ?? 0,
    quantity,
    planned_cost: planned,
    actual_cost: b.actual_cost ?? String(current?.actual_cost ?? "0.0000"),
    activity_version: activity.version,
    resource_version: resource.version,
    record_version: record?.version ?? null,
    before: current
      ? {
          id: current.id,actual_units:current.actual_units,
          quantity: String(current.quantity),
          planned_cost: String(current.planned_cost),
          actual_cost: String(current.actual_cost),
          version: current.version,
        }
      : null,
    workspace_id: a.workspace_id,
  };
}
export async function applyResourceChange(
  c: Db,
  user: string,
  project: string,
  input: unknown,
  approved = false,
  actor = user,
) {
  const b = await prepareResourceChange(c, user, project, input, approved);
  let result: any;
  if (b.action === "delete") {
    await c.query(
      "DELETE FROM activity_resource_allocations WHERE activity_id=$1 AND resource_id=$2",
      [b.activity_id, b.resource_id],
    );
    result = { id: b.before!.id, version: b.version + 1 };
  } else if (b.before) {
    result = (
      await c.query(
        "UPDATE activity_resource_allocations SET quantity=$1,planned_cost=$2,actual_cost=$3,version=version+1 WHERE id=$4 AND version=$5 RETURNING id,version",
        [b.quantity, b.planned_cost, b.actual_cost, b.before.id, b.version],
      )
    ).rows[0];
    requireThat(result, 409, "分配版本已变化");
  } else
    result = (
      await c.query(
        "INSERT INTO activity_resource_allocations(id,activity_id,resource_id,quantity,planned_cost,actual_cost) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version",
        [
          uid(),
          b.activity_id,
          b.resource_id,
          b.quantity,
          b.planned_cost,
          b.actual_cost,
        ],
      )
    ).rows[0];
  await audit(
    c,
    b.workspace_id,
    actor,
    approved ? "审批生效资源费用变更" : "更新作业资源分配",
    b.activity_id,
    {
      reason: b.reason,
      before: b.before,
      after:
        b.action === "delete"
          ? null
          : {
              quantity: b.quantity,
              planned_cost: b.planned_cost,
              actual_cost: b.actual_cost,
              version: result.version,
            },
      requester: user,
    },
  );
  return result;
}
