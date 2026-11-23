import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { access, canWrite,workspaceOwner, HttpError, requireThat } from "./auth.ts";
import { audit, pool, tx, uid } from "./db.ts";
import { notifyUser } from "./notifications.ts";
import { id } from "./validation.ts";

type Db = pg.Pool | pg.PoolClient;
type Item = Record<string, any>;

const itemFields = `i.*, proposer.name AS proposer_name, reviewer.name AS reviewer_name,
  approver.name AS approver_name`;
const itemJoins = `owner_items i
  JOIN users proposer ON proposer.id=i.proposer_id
  JOIN users reviewer ON reviewer.id=i.reviewer_id
  JOIN users approver ON approver.id=i.approver_id`;
const title = z.string().trim().min(1).max(160);
const content = z.string().max(5000).default("");
const assignment = z.object({ reviewer_id: id, approver_id: id });
const createBody = assignment.extend({ title, content }).strict();
const updateBody = createBody
  .extend({ version: z.number().int().positive() })
  .strict();
const actionBody = z
  .object({
    action: z.enum([
      "submit",
      "review",
      "approve",
      "reject",
      "withdraw",
      "reopen",
    ]),
    version: z.number().int().positive(),
    opinion: z.string().trim().max(2000).default(""),
  })
  .strict();

async function businessRole(c: Db, project: string, user: string) {
  return (
    await c.query(
      `SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND m.user_id=$2
       AND u.active AND (m.expires_at IS NULL OR m.expires_at>now())`,
      [project, user],
    )
  ).rows[0]?.role as string | undefined;
}

async function isWorkspaceOwner(c: Db, workspace: string, user: string) {
  return workspaceOwner(user,workspace,c);
}

async function validateAssignments(
  c: Db,
  project: string,
  workspace: string,
  proposer: string,
  reviewer: string,
  approver: string,
) {
  requireThat(
    new Set([proposer, reviewer, approver]).size === 3,
    400,
    "提出人、审核人和批复人必须分别指定不同人员",
  );
  const [reviewRole, approveRole, owner] = await Promise.all([
    businessRole(c, project, reviewer),
    businessRole(c, project, approver),
    isWorkspaceOwner(c, workspace, approver),
  ]);
  requireThat(
    reviewRole === "reviewer" || reviewRole === "manager" || await isWorkspaceOwner(c,workspace,reviewer),
    400,
    "审核人必须是当前项目的审核员或项目经理",
  );
  requireThat(
    approveRole === "manager" || owner,
    400,
    "批复人必须是当前项目经理或空间所有者",
  );
}

function isActive(permission: any) {
  return (
    permission.lifecycle === "active" &&
    permission.workspace_lifecycle === "active"
  );
}

async function allowedActions(
  c: Db,
  item: Item,
  user: string,
  permission: any,
) {
  const actions = ["view"];
  if (!isActive(permission)) return actions;
  const role = await businessRole(c, item.project_id, user);
  if (item.proposer_id === user && canWrite(permission)) {
    if (item.status === "draft") actions.push("edit", "submit", "withdraw");
    else if (["submitted", "reviewed"].includes(item.status))
      actions.push("withdraw");
    else if (["rejected", "withdrawn"].includes(item.status))
      actions.push("reopen");
  }
  if (
    item.status === "submitted" &&
    item.reviewer_id === user &&
    user !== item.proposer_id &&
    (role === "reviewer" || role === "manager" || await isWorkspaceOwner(c,permission.workspace_id,user))
  )
    actions.push("review", "reject");
  if (
    item.status === "reviewed" &&
    item.approver_id === user &&
    user !== item.proposer_id
  ) {
    const owner = await isWorkspaceOwner(c, permission.workspace_id, user);
    if ((role === "manager" || owner) && user !== item.reviewer_id)
      actions.push("approve", "reject");
  }
  return actions;
}

async function present(c: Db, item: Item, user: string, permission: any) {
  return {
    ...item,
    allowed_actions: await allowedActions(c, item, user, permission),
  };
}

async function candidates(c: Db, project: string, workspace: string) {
  const reviewers = (
    await c.query(
      `SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id
       WHERE m.project_id=$1 AND m.role IN ('reviewer','manager') AND u.active
       AND (m.expires_at IS NULL OR m.expires_at>now())
       UNION SELECT u.id,u.name,'owner' AS role FROM users u WHERE u.active AND (u.system_admin OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=$2 AND wm.user_id=u.id AND wm.role='owner')) ORDER BY name,id`,
      [project,workspace],
    )
  ).rows;
  const approvers = (
    await c.query(
      `SELECT DISTINCT u.id,u.name,x.role FROM users u JOIN (
         SELECT m.user_id,'manager'::text AS role FROM memberships m
          WHERE m.project_id=$1 AND m.role='manager' AND (m.expires_at IS NULL OR m.expires_at>now())
         UNION ALL
         SELECT wm.user_id,'owner'::text AS role FROM workspace_members wm
          WHERE wm.workspace_id=$2 AND wm.role='owner'
         UNION ALL SELECT id,'owner'::text FROM users WHERE system_admin AND active
       ) x ON x.user_id=u.id WHERE u.active ORDER BY u.name,u.id`,
      [project, workspace],
    )
  ).rows;
  return { reviewers:[...new Map(reviewers.map(u=>[u.id,u])).values()], approvers:[...new Map(approvers.map(u=>[u.id,u])).values()] };
}

async function itemForUpdate(c: pg.PoolClient, key: string) {
  const item = (
    await c.query(
      `SELECT ${itemFields} FROM ${itemJoins} WHERE i.id=$1 FOR UPDATE OF i`,
      [key],
    )
  ).rows[0];
  requireThat(item, 404, "业主事项不存在");
  return item;
}

async function addEvent(
  c: pg.PoolClient,
  item: Item,
  actor: string,
  action: string,
  fromStatus: string | null,
  opinion = "",
) {
  await c.query(
    `INSERT INTO owner_item_events(item_id,actor_id,action,from_status,to_status,opinion,version,snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      item.id,
      actor,
      action,
      fromStatus,
      item.status,
      opinion,
      item.version,
      JSON.stringify(item),
    ],
  );
}

export const ownerItems = Router();

ownerItems.get("/projects/:project/owner-items", async (req, res) => {
  const project = id.parse(req.params.project);
  const permission = await access(req.user.id, project);
  const [rows, people, role] = await Promise.all([
    pool.query(
      `SELECT ${itemFields} FROM ${itemJoins} WHERE i.project_id=$1 ORDER BY i.updated_at DESC,i.id`,
      [project],
    ),
    candidates(pool, project, permission.workspace_id),
    businessRole(pool, project, req.user.id),
  ]);
  res.json({
    items: await Promise.all(
      rows.rows.map((item) => present(pool, item, req.user.id, permission)),
    ),
    candidates: people,
    allowed_actions:
      isActive(permission) && canWrite(permission) && (role || permission.role === "owner")
        ? ["create"]
        : [],
  });
});

ownerItems.get("/owner-items/:item", async (req, res) => {
  const key = id.parse(req.params.item);
  const item = (
    await pool.query(`SELECT ${itemFields} FROM ${itemJoins} WHERE i.id=$1`, [
      key,
    ])
  ).rows[0];
  requireThat(item, 404, "业主事项不存在");
  const permission = await access(req.user.id, item.project_id);
  const history = (
    await pool.query(
      `SELECT e.id,e.action,e.from_status,e.to_status,e.opinion,e.version,e.snapshot,e.created_at,
              u.id AS actor_id,u.name AS actor_name
       FROM owner_item_events e JOIN users u ON u.id=e.actor_id
       WHERE e.item_id=$1 ORDER BY e.id`,
      [key],
    )
  ).rows;
  res.json({
    ...(await present(pool, item, req.user.id, permission)),
    history,
  });
});

ownerItems.post("/projects/:project/owner-items", async (req, res) => {
  const project = id.parse(req.params.project);
  const body = createBody.parse(req.body);
  const item = await tx(async (c) => {
    const permission = await access(req.user.id, project, c);
    requireThat(
      isActive(permission),
      409,
      "工作空间或项目非活动状态，请先激活",
    );
    requireThat(
      canWrite(permission),
      403,
      "只有项目成员可以提出业主事项",
    );
    await validateAssignments(
      c,
      project,
      permission.workspace_id,
      req.user.id,
      body.reviewer_id,
      body.approver_id,
    );
    const created = (
      await c.query(
        `INSERT INTO owner_items(id,project_id,title,content,proposer_id,reviewer_id,approver_id)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          uid(),
          project,
          body.title,
          body.content,
          req.user.id,
          body.reviewer_id,
          body.approver_id,
        ],
      )
    ).rows[0];
    await addEvent(c, created, req.user.id, "create", null);
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "owner_item.create",
      created.id,
      {
        project_id: project,
        reviewer_id: created.reviewer_id,
        approver_id: created.approver_id,
      },
    );
    return created;
  });
  res.status(201).json(item);
});

ownerItems.patch("/owner-items/:item", async (req, res) => {
  const key = id.parse(req.params.item);
  const body = updateBody.parse(req.body);
  const item = await tx(async (c) => {
    const before = await itemForUpdate(c, key);
    const permission = await access(req.user.id, before.project_id, c);
    requireThat(
      isActive(permission),
      409,
      "工作空间或项目非活动状态，请先激活",
    );
    requireThat(
      before.proposer_id === req.user.id,
      403,
      "只有提出人可以修改草稿",
    );
    requireThat(canWrite(permission),403,'只读账号不能修改事项');
    requireThat(
      before.status === "draft",
      409,
      "仅草稿可以修改；最终批复不得直接改写",
    );
    requireThat(
      before.version === body.version,
      409,
      "事项已被修改，请刷新后重试",
    );
    await validateAssignments(
      c,
      before.project_id,
      permission.workspace_id,
      req.user.id,
      body.reviewer_id,
      body.approver_id,
    );
    const updated = (
      await c.query(
        `UPDATE owner_items SET title=$2,content=$3,reviewer_id=$4,approver_id=$5,
          version=version+1,updated_at=now() WHERE id=$1 AND version=$6 RETURNING *`,
        [
          key,
          body.title,
          body.content,
          body.reviewer_id,
          body.approver_id,
          body.version,
        ],
      )
    ).rows[0];
    if (!updated) throw new HttpError(409, "事项已被修改，请刷新后重试");
    await addEvent(c, updated, req.user.id, "update", "draft");
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "owner_item.update",
      key,
      { version: updated.version },
    );
    return updated;
  });
  res.json(item);
});

ownerItems.post("/owner-items/:item/actions", async (req, res) => {
  const key = id.parse(req.params.item);
  const body = actionBody.parse(req.body);
  const item = await tx(async (c) => {
    const before = await itemForUpdate(c, key);
    const permission = await access(req.user.id, before.project_id, c);
    requireThat(
      isActive(permission),
      409,
      "工作空间或项目非活动状态，请先激活",
    );
    requireThat(
      before.version === body.version,
      409,
      "事项已被修改，请刷新后重试",
    );
    const allowed = await allowedActions(c, before, req.user.id, permission);
    requireThat(
      allowed.includes(body.action),
      403,
      "当前身份或事项状态不允许执行此操作",
    );
    let next: string;
    if (body.action === "submit") next = "submitted";
    else if (body.action === "review") next = "reviewed";
    else if (body.action === "approve") next = "approved";
    else if (body.action === "reject") next = "rejected";
    else if (body.action === "reopen") next = "draft";
    else next = "withdrawn";
    if (["review", "approve", "reject"].includes(body.action))
      requireThat(body.opinion.length > 0, 400, "请填写处理意见");
    if (body.action === "submit")
      await validateAssignments(
        c,
        before.project_id,
        permission.workspace_id,
        before.proposer_id,
        before.reviewer_id,
        before.approver_id,
      );
    const updated = (
      await c.query(
        `UPDATE owner_items SET status=$2,version=version+1,updated_at=now()
         WHERE id=$1 AND version=$3 AND status=$4 RETURNING *`,
        [key, next, body.version, before.status],
      )
    ).rows[0];
    if (!updated) throw new HttpError(409, "事项状态已变化，请刷新后重试");
    await addEvent(
      c,
      updated,
      req.user.id,
      body.action,
      before.status,
      body.opinion,
    );
    const target =
      body.action === "submit"
        ? before.reviewer_id
        : body.action === "review"
          ? before.approver_id
          : before.proposer_id;
    const labels: Record<string, string> = {
      submit: "有业主事项等待审核",
      review: "有业主事项等待批复",
      approve: "业主事项已批复",
      reject: "业主事项已退回",
      withdraw: "业主事项已撤回",
    };
    if (target !== req.user.id)
      await notifyUser(
        c,
        target,
        before.project_id,
        "owner_item",
        key,
        labels[body.action],
      );
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      `owner_item.${body.action}`,
      key,
      {
        from_status: before.status,
        to_status: next,
        version: updated.version,
      },
    );
    return updated;
  });
  res.json(item);
});
