import { Router } from "express";
import { z } from "zod";
import { access, canManage, requireThat } from "./auth.ts";
import { pool, tx, uid, audit } from "./db.ts";
import { id, name, date } from "./validation.ts";
import { notifyUser } from "./notifications.ts";
import {lockReferenceProject} from "./references.ts";
import { nextTodoDate } from "../shared/todo-recurrence.ts";

export const todoActions = Router();
export async function updateTodo(user:string,todoId:string,input:unknown) {
  todoId=id.parse(todoId);
  const body = z.object({ content:z.string().max(20000).optional(),done: z.boolean().optional(), title: name.optional(), due_date: date.optional(), owner_id: id.optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(), recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
    recurrence_until: date.nullable().optional(), version: z.number().int().positive().optional(),
  }).strict().refine((v) => Object.keys(v).some((key) => key !== "version"), "至少修改一项").parse(input);
  const meta = (await pool.query("SELECT project_id FROM todos WHERE id=$1", [todoId])).rows[0];
  requireThat(meta, 404, "待办不存在");
  const result = await tx(async (c) => {
    await lockReferenceProject(c,meta.project_id);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR SHARE", [meta.project_id]);
    const todo = (await c.query("SELECT t.*,t.due_date::text AS due_date,t.recurrence_until::text AS recurrence_until FROM todos t WHERE id=$1 FOR UPDATE", [todoId])).rows[0];
    requireThat(todo, 404, "待办不存在");
    const permission = await access(user, todo.project_id, c);
    requireThat(permission.role!=='viewer',403,'只读账号不能修改待办');
    requireThat(todo.owner_id === user || canManage(permission));
    requireThat(!todo.archived, 409, "待办已归档，请先恢复后操作");
    requireThat(body.version === undefined || body.version === todo.version, 409, "待办已被修改，请刷新后重试");
    if (body.owner_id) {
      requireThat(body.owner_id === todo.owner_id || canManage(permission), 403, "只有项目经理可以更换负责人");
      await access(body.owner_id, todo.project_id, c);
      requireThat((await c.query("SELECT 1 FROM users WHERE id=$1 AND active", [body.owner_id])).rowCount, 400, "负责人账号已停用");
    }
    const next = { ...todo, ...body, recurrence_until: body.recurrence_until === undefined ? todo.recurrence_until : body.recurrence_until };
    requireThat(!next.recurrence_until || next.recurrence_until >= next.due_date, 400, "重复截止日期不能早于待办日期");
    const anchor = body.due_date && body.due_date !== todo.due_date ? Number(body.due_date.slice(8)) : todo.recurrence_day ?? Number(todo.due_date.slice(8));
    const existing = (await c.query("SELECT id FROM todos WHERE parent_todo_id=$1 ORDER BY created_at,id LIMIT 1", [todo.id])).rows[0];
    // Replayed completion is a no-op. Editing an already completed item never creates a child.
    if (body.done !== undefined && body.done === todo.done && Object.keys(body).every((key) => ["done", "version"].includes(key))) return { ok: true, version: todo.version, next_todo_id: existing?.id || null };
    await c.query("UPDATE todos SET done=$1,title=$2,due_date=$3,owner_id=$4,priority=$5,recurrence=$6,recurrence_until=$7,recurrence_day=$8,content=$10,version=version+1,updated_at=now() WHERE id=$9",
      [next.done, next.title, next.due_date, next.owner_id, next.priority, next.recurrence, next.recurrence_until, anchor, todo.id,next.content||'']);
    let nextId = existing?.id || null;
    if (body.done === true && !todo.done && next.recurrence !== "none" && !existing) {
      const nextDate = nextTodoDate(next.due_date, next.recurrence, anchor)!;
      if (!next.recurrence_until || nextDate <= next.recurrence_until) {
        await access(next.owner_id, todo.project_id, c);
        requireThat((await c.query("SELECT 1 FROM users WHERE id=$1 AND active", [next.owner_id])).rowCount, 400, "负责人账号已停用，请更换负责人后完成");
        const inserted = await c.query(`INSERT INTO todos(id,project_id,title,due_date,owner_id,priority,recurrence,recurrence_until,parent_todo_id,generated_from_id,recurrence_day,content)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11) ON CONFLICT(generated_from_id) WHERE generated_from_id IS NOT NULL DO NOTHING RETURNING id`,
          [uid(), todo.project_id, next.title, nextDate, next.owner_id, next.priority, next.recurrence, next.recurrence_until, todo.id, anchor,next.content||'']);
        if (inserted.rowCount) {
          nextId = inserted.rows[0].id;
          await notifyUser(c, next.owner_id, todo.project_id, "todo", nextId, "一项重复待办的下一期已生成");
        }
      }
    }
    if (next.owner_id !== todo.owner_id) await notifyUser(c, next.owner_id, todo.project_id, "todo", todo.id, "你被指派为一项待办的负责人");
    await audit(c, permission.workspace_id, user, body.done === undefined ? "编辑待办" : next.done ? "完成待办" : "重新打开待办", todo.id, { next_todo_id: nextId });
    return { ok: true, version: todo.version + 1, next_todo_id: nextId };
  });
  return result;
}
todoActions.patch("/todos/:todo",async(req,res)=>res.json(await updateTodo(req.user.id,req.params.todo,req.body)));
