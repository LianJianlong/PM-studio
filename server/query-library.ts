import { Router } from "express";
import { z } from "zod";
import { pool, tx, uid, audit } from "./db.ts";
import { workspaceOwner, requireThat } from "./auth.ts";
import { id } from "./validation.ts";
import { encrypt, decrypt } from "./security.ts";

export const queryLibrary = Router();
const sqlText = z.string().trim().min(1).max(20000);
const savedBody = z.object({
  name: z.string().trim().min(1).max(120),
  sql: sqlText,
});
async function access(connection: string, user: string, c: any = pool) {
  const con = (
    await c.query("SELECT id,workspace_id FROM connections WHERE id=$1", [
      connection,
    ])
  ).rows[0];
  requireThat(con, 404, "连接不存在");
  requireThat(await workspaceOwner(user, con.workspace_id, c));
  return con;
}
const reveal = (row: any) => {
  const { sql_cipher, ...rest } = row;
  return { ...rest, sql: decrypt(sql_cipher).sql };
};
queryLibrary.get("/connections/:connection/query-library", async (req, res) => {
  const connection = id.parse(req.params.connection);
  await access(connection, req.user.id);
  const [saved, history] = await Promise.all([
    pool.query(
      "SELECT id,name,sql_cipher,version,archived,updated_at FROM saved_queries WHERE connection_id=$1 AND user_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 200",
      [connection, req.user.id],
    ),
    pool.query(
      "SELECT id,sql_cipher,succeeded,duration_ms,row_count,truncated,created_at FROM query_history WHERE connection_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100",
      [connection, req.user.id],
    ),
  ]);
  res.json({
    saved: saved.rows.map(reveal),
    history: history.rows.map(reveal),
  });
});
queryLibrary.post(
  "/connections/:connection/saved-queries",
  async (req, res) => {
    const connection = id.parse(req.params.connection),
      body = savedBody.parse(req.body);
    const result = await tx(async (c) => {
      const con = await access(connection, req.user.id, c);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,709))", [
        connection + req.user.id,
      ]);
      const count = (
        await c.query(
          "SELECT count(*)::int AS n FROM saved_queries WHERE connection_id=$1 AND user_id=$2",
          [connection, req.user.id],
        )
      ).rows[0].n;
      requireThat(
        count < 200,
        400,
        "每个账号在单个连接下最多保存200条查询（含归档）",
      );
      const queryId = uid();
      await c.query(
        "INSERT INTO saved_queries(id,connection_id,user_id,name,sql_cipher) VALUES($1,$2,$3,$4,$5)",
        [
          queryId,
          connection,
          req.user.id,
          body.name,
          encrypt({ sql: body.sql }),
        ],
      );
      await audit(c, con.workspace_id, req.user.id, "保存SQL查询", queryId);
      return { id: queryId, version: 1 };
    });
    res.status(201).json(result);
  },
);
queryLibrary.patch(
  "/connections/:connection/saved-queries/:query",
  async (req, res) => {
    const connection = id.parse(req.params.connection),
      queryId = id.parse(req.params.query);
    const body = z
      .union([
        savedBody.extend({ version: z.number().int().positive() }),
        z.object({
          version: z.number().int().positive(),
          archived: z.boolean(),
        }),
      ])
      .parse(req.body);
    const result = await tx(async (c) => {
      const con = await access(connection, req.user.id, c);
      const current = (
        await c.query(
          "SELECT * FROM saved_queries WHERE id=$1 AND connection_id=$2 AND user_id=$3 FOR UPDATE",
          [queryId, connection, req.user.id],
        )
      ).rows[0];
      requireThat(current, 404, "保存的查询不存在");
      requireThat(
        current.version === body.version,
        409,
        "查询已在其他窗口修改，请刷新后重试",
      );
      const archived = "archived" in body ? body.archived : current.archived;
      requireThat(
        "archived" in body || !current.archived,
        400,
        "请先恢复归档查询",
      );
      await c.query(
        "UPDATE saved_queries SET name=$2,sql_cipher=$3,archived=$4,version=version+1,updated_at=now() WHERE id=$1",
        [
          queryId,
          "name" in body ? body.name : current.name,
          "sql" in body ? encrypt({ sql: body.sql }) : current.sql_cipher,
          archived,
        ],
      );
      await audit(
        c,
        con.workspace_id,
        req.user.id,
        "archived" in body
          ? archived
            ? "归档SQL查询"
            : "恢复SQL查询"
          : "修改SQL查询",
        queryId,
      );
      return { id: queryId, version: current.version + 1 };
    });
    res.json(result);
  },
);

export async function recordQueryHistory(
  connection: string,
  user: string,
  sql: string,
  succeeded: boolean,
  duration: number,
  rowCount: number | null,
  truncated = false,
) {
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,710))", [
      connection + user,
    ]);
    // A connection can be removed while an external query is running.
    const exists = await c.query(
      "SELECT id FROM connections WHERE id=$1 FOR KEY SHARE",
      [connection],
    );
    if (!exists.rowCount) return;
    await c.query(
      "INSERT INTO query_history(id,connection_id,user_id,sql_cipher,succeeded,duration_ms,row_count,truncated) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        uid(),
        connection,
        user,
        encrypt({ sql }),
        succeeded,
        Math.max(0, Math.min(duration, 2147483647)),
        rowCount,
        truncated,
      ],
    );
    await c.query(
      "DELETE FROM query_history WHERE id IN (SELECT id FROM query_history WHERE connection_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC OFFSET 100)",
      [connection, user],
    );
  });
}
