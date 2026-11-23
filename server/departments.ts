import { Router } from "express";
import { z } from "zod";
import { pool, tx, uid, audit } from "./db.ts";
import { access, canManage, requireThat } from "./auth.ts";
import { id, name } from "./validation.ts";

export const departmentRoutes = Router();
departmentRoutes.get("/projects/:project/departments", async (req, res) => {
  const project = id.parse(req.params.project);
  requireThat(canManage(await access(req.user.id, project)));
  res.json(
    (
      await pool.query(
        "SELECT * FROM departments WHERE project_id=$1 ORDER BY name",
        [project],
      )
    ).rows,
  );
});
departmentRoutes.post("/projects/:project/departments", async (req, res) => {
  const project = id.parse(req.params.project);
  const body = z.object({ name }).strict().parse(req.body);
  const row = await tx(async (c) => {
    const permission = await access(req.user.id, project, c);
    requireThat(canManage(permission));
    const result = (
      await c.query(
        "INSERT INTO departments(id,project_id,name) VALUES($1,$2,$3) RETURNING *",
        [uid(), project, body.name],
      )
    ).rows[0];
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "department.create",
      result.id,
      { project_id: project, name: body.name },
    );
    return result;
  });
  res.status(201).json(row);
});
departmentRoutes.patch("/departments/:department", async (req, res) => {
  const key = id.parse(req.params.department);
  const body = z
    .object({ name, version: z.number().int().positive() })
    .strict()
    .parse(req.body);
  const row = await tx(async (c) => {
    const before = (
      await c.query("SELECT * FROM departments WHERE id=$1 FOR UPDATE", [key])
    ).rows[0];
    requireThat(before, 404, "部门不存在");
    const permission = await access(req.user.id, before.project_id, c);
    requireThat(canManage(permission));
    requireThat(
      before.object_version === body.version,
      409,
      "部门已被修改，请关闭弹窗并重新打开",
    );
    const result = (
      await c.query(
        "UPDATE departments SET name=$2,object_version=object_version+1 WHERE id=$1 RETURNING *",
        [key, body.name],
      )
    ).rows[0];
    await audit(
      c,
      permission.workspace_id,
      req.user.id,
      "department.rename",
      key,
      { before: before.name, after: body.name },
    );
    return result;
  });
  res.json(row);
});
