import { Router } from "express";
import { z } from "zod";
import pg from "pg";
import mysql from "mysql2/promise";
import {connect as connectSocket} from 'node:net';
import { pool, uid, audit, tx } from "./db.ts";
import { workspaceOwner, requireThat, HttpError } from "./auth.ts";
import { id, name } from "./validation.ts";
import { encrypt, decrypt } from "./security.ts";
import { queryLibrary, recordQueryHistory } from "./query-library.ts";
import {rateLimit} from 'express-rate-limit';import {requestBudget} from './request-budget.ts';
export const connections = Router();
import {validateEndpoint,resolveTarget} from './outbound.ts';
import {requireRemoteDatabase} from '../shared/database-target.ts';
import {probeDatabase} from './database-probe.ts';
connections.use(queryLibrary);
const connection = z.object({
  name,
  engine: z.enum(["postgres", "mysql"]),
  host: z.string().min(1).max(250),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1).max(128),
  schema:z.string().trim().max(128).default('public'),
  user: z.string().min(1).max(128),
  password: z.string().max(500),
  tls: z.boolean().default(true),
});
async function withConnection(config: any, engine: string, sql?: string) {
  const target=validateEndpoint(config.host,'database',config.tls),resolved=await resolveTarget(target.host,target.local);
  try{requireRemoteDatabase(resolved.address,config.user);}catch(e){throw new HttpError(403,(e as Error).message);}
  const options = {
    host: resolved.address,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  };
  if (engine === "postgres") {
    const client = new pg.Client({
      ...options,
      ssl: config.tls ? { rejectUnauthorized: true,servername:target.host } : false,
      connectionTimeoutMillis: 7000,
      statement_timeout: 7000,
      query_timeout: 8000,
    });
    try {
      await client.connect();
      if (!sql) {
        const r = await client.query(
          "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND ($1='' OR table_schema=$1) ORDER BY table_schema,table_name LIMIT 500",[config.schema||''],
        );
        return { rows: r.rows, columns: r.fields.map((f) => f.name) };
      }
      await client.query("BEGIN READ ONLY");
      if(config.schema)await client.query("SELECT set_config('search_path',quote_ident($1),true)",[config.schema]);
      const r = await client.query(sql);
      await client.query("ROLLBACK");
      return { rows: r.rows, columns: r.fields.map((f) => f.name) };
    } finally {
      await client.end().catch(() => {});
    }
  }
  const client = await mysql.createConnection({
    ...options,
    host:target.host,
    stream:()=>connectSocket({host:resolved.address,port:config.port}),
    ssl: config.tls ? { rejectUnauthorized: true,verifyIdentity:true } : undefined,
    connectTimeout: 7000,
    multipleStatements: false,
  });
  try {
    await client.query("SET SESSION MAX_EXECUTION_TIME=7000");
    if (!sql) {
      const [rows] = await client.query(
        "SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY table_name LIMIT 500",
      );
      return { rows, columns: ["table_schema", "table_name"] };
    }
    await client.query("START TRANSACTION READ ONLY");
    const [rows, fields] = await client.query({ sql, timeout: 8000 });
    await client.rollback();
    return { rows, columns: fields.map((f) => f.name) };
  } finally {
    await client.end();
  }
}
connections.get("/workspaces/:workspace/connections", async (req, res) => {
  const workspace = id.parse(req.params.workspace);
  requireThat(await workspaceOwner(req.user.id, workspace));
  res.json(
    (
      await pool.query(
        "SELECT id,name,engine,created_at FROM connections WHERE workspace_id=$1 ORDER BY name",
        [workspace],
      )
    ).rows,
  );
});
connections.post('/workspaces/:workspace/connections/test',rateLimit({windowMs:60000,limit:8,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'\u6d4b\u8bd5\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'}}),requestBudget(4,1),async(req,res)=>{
 requireThat(await workspaceOwner(req.user.id,id.parse(req.params.workspace)));
 res.json(await probeDatabase(connection.parse(req.body),'query'));
});
connections.post("/workspaces/:workspace/connections", async (req, res) => {
  const workspace = id.parse(req.params.workspace),
    body = connection.parse(req.body);
  requireThat(await workspaceOwner(req.user.id, workspace));
  const connectionId = uid();
  const target=validateEndpoint(body.host,'database',body.tls);const resolved=await resolveTarget(target.host,target.local);try{requireRemoteDatabase(resolved.address,body.user);}catch(e){throw new HttpError(403,(e as Error).message);}
  await tx(async (c) => {
    await c.query(
      "INSERT INTO connections(id,workspace_id,name,engine,config_cipher) VALUES($1,$2,$3,$4,$5)",
      [connectionId, workspace, body.name, body.engine, encrypt(body)],
    );
    await audit(c, workspace, req.user.id, "保存数据库连接", connectionId, {
      engine: body.engine,
    });
  });
  res.status(201).json({ id: connectionId });
});
connections.post("/connections/:connection/query",rateLimit({windowMs:60_000,limit:12,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'外部查询过多，请稍后重试'}}),requestBudget(12,2), async (req, res) => {
  const body = z
    .object({ sql: z.string().trim().min(1).max(20000).optional() })
    .parse(req.body);
  const con = (
    await pool.query("SELECT * FROM connections WHERE id=$1", [
      id.parse(req.params.connection),
    ])
  ).rows[0];
  requireThat(con, 404, "连接不存在");
  requireThat(await workspaceOwner(req.user.id, con.workspace_id));
  let sql: string | undefined;
  if (body.sql) {
    const raw = body.sql.replace(/;\s*$/, "");
    requireThat(
      /^(select|with)\s/i.test(raw) && !raw.includes(";"),
      400,
      "首版仅允许单条 SELECT 或 WITH 查询",
    );
    sql = `SELECT * FROM (${raw}) AS studio_result LIMIT 501`;
  }
  const start = Date.now();
  let executionSucceeded = false;
  try {
    const result: any = await withConnection(
      decrypt(con.config_cipher),
      con.engine,
      sql,
    );
    const truncated = result.rows.length > 500;
    executionSucceeded = true;
    if (body.sql)
      await recordQueryHistory(
        con.id,
        req.user.id,
        body.sql,
        true,
        Date.now() - start,
        Math.min(result.rows.length, 500),
        truncated,
      );
    await audit(
      pool,
      con.workspace_id,
      req.user.id,
      sql ? "只读SQL查询" : "测试连接与浏览对象",
      con.id,
      { duration_ms: Date.now() - start },
    );
    res.json({
      ...result,
      rows: result.rows.slice(0, 500),
      truncated,
      duration_ms: Date.now() - start,
    });
  } catch (e) {
    if (body.sql && !executionSucceeded)
      await recordQueryHistory(
        con.id,
        req.user.id,
        body.sql,
        false,
        Date.now() - start,
        null,
      );
    console.error("External connection query failed", {
      engine: con.engine,
      code: (e as any).code,
    });
    throw new HttpError(
      400,
      "连接或查询失败，请检查地址、凭据、TLS、SQL语法及只读权限；查询超时上限约8秒",
    );
  }
});
connections.delete("/connections/:connection", async (req, res) => {
  const con = (
    await pool.query("SELECT * FROM connections WHERE id=$1", [
      id.parse(req.params.connection),
    ])
  ).rows[0];
  requireThat(con, 404, "连接不存在");
  requireThat(await workspaceOwner(req.user.id, con.workspace_id));
  await tx(async (c) => {
    await c.query("DELETE FROM connections WHERE id=$1", [con.id]);
    await audit(c, con.workspace_id, req.user.id, "移除数据库连接", con.id);
  });
  res.json({ ok: true });
});
