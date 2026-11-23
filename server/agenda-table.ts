import { Router } from "express";
import { pool, tx, uid, audit, requestTransaction } from "./db.ts";
import { access, tableAccess, rowAllowed, requireThat } from "./auth.ts";
import { id } from "./validation.ts";
import { projectReferenceRows } from "./references.ts";
import { updateTodo } from "./todo-actions.ts";
export const agendaTables = Router();
export const agendaCore = [
  { id: "title", name: "事项名称", type: "text", required: true },
  { id: "due_date", name: "到期日期", type: "date", required: true },
  {
    id: "owner",
    name: "负责人",
    type: "single_select",
    required: true,
    options: [] as string[],
  },
  { id: "done", name: "已完成", type: "boolean" },
  {
    id: "priority",
    name: "优先级",
    type: "single_select",
    options: ["低", "普通", "高", "紧急"],
  },
  {
    id: "recurrence",
    name: "重复规则",
    type: "single_select",
    options: ["不重复", "每天", "每周", "每月"],
  },
  { id: "recurrence_until", name: "重复截止", type: "date" },
  { id: "content", name: "内容说明", type: "text" },
  { id: "created_at", name: "创建时间", type: "created_time" },
  { id: "updated_at", name: "更新时间", type: "modified_time" },
];
agendaTables.get("/projects/:project/agenda-table", async (req, res) => {
  const project = id.parse(req.params.project),
    a = await access(req.user.id, project);
  const table = await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "agenda:" + project,
    ]);
    let row = (
      await c.query(
        "SELECT t.* FROM project_agenda_tables a JOIN data_tables t ON t.id=a.table_id WHERE a.project_id=$1",
        [project],
      )
    ).rows[0];
    const users = (
      await c.query(
        "SELECT DISTINCT u.username FROM users u WHERE (u.active AND public.agenda_owner_allowed($1,u.id)) OR EXISTS(SELECT 1 FROM todos d WHERE d.project_id=$1 AND d.owner_id=u.id) ORDER BY u.username",
        [project],
      )
    ).rows.map((u) => u.username);
    if (!row) {
      requireThat(
        a.lifecycle === "active" && a.workspace_lifecycle === "active",
        409,
        "项目不可编辑，无法启用事项表",
      );
      let department = (
        await c.query(
          "SELECT id FROM departments WHERE project_id=$1 ORDER BY (name='经理') DESC,id LIMIT 1",
          [project],
        )
      ).rows[0]?.id;
      if (!department) {
        department = uid();
        await c.query(
          "INSERT INTO departments(id,project_id,name) VALUES($1,$2,$3)",
          [department, project, "经理"],
        );
      }
      const key = uid(),
        columns = agendaCore.map((f) =>
          f.id === "owner" ? { ...f, options: users } : f,
        );
      row = (
        await c.query(
          "INSERT INTO data_tables(id,project_id,department_id,name,description,columns,is_agenda,review_mode) VALUES($1,$2,$3,'事项与日历','事项、日历、提醒共用数据；本人及项目管理员可见。',$4,true,'supervisor') RETURNING *",
          [key, project, department, JSON.stringify(columns)],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO project_agenda_tables(project_id,table_id) VALUES($1,$2)",
        [project, key],
      );
      await c.query(
        "SELECT public.agenda_sync_todo(id) FROM todos WHERE project_id=$1",
        [project],
      );
      await audit(
        c,
        a.workspace_id,
        req.user.id,
        "agenda.table.initialize",
        key,
        {},
      );
    } else {
      const owner = row.columns.find((f: any) => f.id === "owner");
      if (JSON.stringify(owner.options) !== JSON.stringify(users)) {
        row = (
          await c.query(
            "UPDATE data_tables SET columns=$2,object_version=object_version+1 WHERE id=$1 RETURNING *",
            [
              row.id,
              JSON.stringify(
                row.columns.map((f: any) =>
                  f.id === "owner" ? { ...f, options: users } : f,
                ),
              ),
            ],
          )
        ).rows[0];
      }
    }
    return row;
  });
  res.json({ table });
});
agendaTables.get(
  "/projects/:project/agenda-records/:todo",
  async (req, res) => {
    const a = await access(req.user.id, id.parse(req.params.project));
    const record = (
      await pool.query(
        "SELECT r.* FROM records r JOIN project_agenda_tables t ON t.table_id=r.table_id WHERE t.project_id=$1 AND r.id=$2 AND r.lifecycle<>'deleted'",
        [a.id, id.parse(req.params.todo)],
      )
    ).rows[0];
    requireThat(record, 404, "事项不存在");
    const { table, permission } = await tableAccess(
      req.user.id,
      record.table_id,
    );
    requireThat(rowAllowed(permission, record, req.user.id));
    res.json(
      (await projectReferenceRows(req.user.id, table, permission, [record]))[0],
    );
  },
);
export async function writeAgendaRecord(
  c: any,
  user: string,
  table: any,
  record: any,
  value: any,
) {
  if (!table.is_agenda) return false;
  const todo = (await c.query("SELECT * FROM todos WHERE id=$1", [record.id]))
    .rows[0];
  requireThat(todo, 409, "待办联动记录不存在");
  const owner = (
    await c.query("SELECT id FROM users WHERE username=$1", [value.owner])
  ).rows[0];
  requireThat(owner, 400, "请选择有效负责人");
  const result = await requestTransaction.run(c, () =>
    updateTodo(user, record.id, {
      title: value.title,
      due_date: value.due_date,
      done: value.done ?? false,
      content: value.content || "",
      priority:
        ({ 低: "low", 普通: "normal", 高: "high", 紧急: "urgent" } as any)[
          value.priority
        ] || "normal",
      recurrence:
        (
          {
            不重复: "none",
            每天: "daily",
            每周: "weekly",
            每月: "monthly",
          } as any
        )[value.recurrence] || "none",
      recurrence_until: value.recurrence_until || null,
      ...(owner.id !== todo.owner_id ? { owner_id: owner.id } : {}),
      version: todo.version,
    }),
  );
  await c.query(
    "UPDATE records SET data=$1,status='draft',version=$3,updated_at=now() WHERE id=$2",
    [JSON.stringify(value), record.id, result.version],
  );
  return true;
}
