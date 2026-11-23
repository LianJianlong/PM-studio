import { Router } from "express";
import type pg from "pg";
import { pool, uid } from "./db.ts";
import { id } from "./validation.ts";
import { requireThat } from "./auth.ts";

export async function notifyUser(
  c: pg.PoolClient,
  user: string,
  project: string,
  kind: "approval" | "todo" | "owner_item",
  resource: string,
  title: string,
) {
  // Store event labels only; no record values or free-form approval opinions.
  await c.query(
    "INSERT INTO notifications(id,user_id,project_id,kind,resource_id,title) VALUES($1,$2,$3,$4,$5,$6)",
    [uid(), user, project, kind, resource, title],
  );
}
export const notifications = Router();
const visibility = `n.user_id=$1 AND p.lifecycle<>'deleted' AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=p.workspace_id AND w.lifecycle<>'deleted')
  AND (n.dedupe_key IS NULL OR EXISTS(SELECT 1 FROM todos t WHERE t.id=n.resource_id AND t.project_id=p.id AND t.owner_id=$1 AND NOT t.done AND NOT t.archived AND n.dedupe_key='todo-due:'||t.id::text||':'||t.due_date::text))
  AND (EXISTS(SELECT 1 FROM users WHERE id=$1 AND system_admin AND active) OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=p.workspace_id AND wm.user_id=$1 AND
  (wm.role='owner' OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=p.id AND m.user_id=$1 AND (m.expires_at IS NULL OR m.expires_at>now()))
  OR (n.kind='approval' AND EXISTS(SELECT 1 FROM approvals ap WHERE ap.id=n.resource_id AND ap.kind='access' AND ap.requester_id=$1)))))`;
notifications.get("/notifications", async (req, res) => {
  // Derived reminders are created when the recipient polls; no email or external delivery.
  await pool.query(`INSERT INTO notifications(id,user_id,project_id,kind,resource_id,title,dedupe_key)
    SELECT gen_random_uuid(),t.owner_id,t.project_id,'todo',t.id,'你有一项到期待办尚未完成','todo-due:'||t.id::text||':'||t.due_date::text
    FROM todos t JOIN projects p ON p.id=t.project_id JOIN workspaces w ON w.id=p.workspace_id
    WHERE t.owner_id=$1 AND NOT t.done AND NOT t.archived AND t.due_date<=(now() AT TIME ZONE 'Asia/Shanghai')::date
      AND p.lifecycle<>'deleted' AND w.lifecycle<>'deleted'
      AND (EXISTS(SELECT 1 FROM users WHERE id=$1 AND system_admin AND active) OR EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=p.workspace_id AND wm.user_id=$1
        AND (wm.role='owner' OR EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=p.id AND m.user_id=$1 AND (m.expires_at IS NULL OR m.expires_at>now())))))
    ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`, [req.user.id]);
  const [items, count] = await Promise.all([
    pool.query(
      `SELECT n.*,p.name AS project_name,p.workspace_id,
        CASE WHEN n.kind='todo' AND t.owner_id=$1 THEN t.due_date::text END AS due_date,
        CASE WHEN n.kind='todo' AND t.owner_id=$1 THEN u.name END AS owner_name
        FROM notifications n JOIN projects p ON p.id=n.project_id LEFT JOIN todos t ON t.id=n.resource_id AND t.project_id=p.id LEFT JOIN users u ON u.id=t.owner_id
        WHERE ${visibility} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      [req.user.id],
    ),
    pool.query(
      `SELECT count(*)::int AS unread FROM notifications n JOIN projects p ON p.id=n.project_id WHERE ${visibility} AND n.read_at IS NULL`,
      [req.user.id],
    ),
  ]);
  res.json({ items: items.rows, unread: count.rows[0].unread });
});
notifications.post("/notifications/read-all", async (req, res) => {
  await pool.query(
    `UPDATE notifications SET read_at=now() WHERE read_at IS NULL AND id IN(SELECT n.id FROM notifications n JOIN projects p ON p.id=n.project_id WHERE ${visibility})`,
    [req.user.id],
  );
  res.json({ ok: true });
});
notifications.patch("/notifications/:notification", async (req, res) => {
  const result = await pool.query(
    `UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$2 AND id IN(SELECT n.id FROM notifications n JOIN projects p ON p.id=n.project_id WHERE ${visibility})`,
    [req.user.id, id.parse(req.params.notification)],
  );
  requireThat(result.rowCount, 404, "消息不存在或已无访问权限");
  res.json({ ok: true });
});
