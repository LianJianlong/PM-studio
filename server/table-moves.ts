import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool, tx, audit, uid } from "./db.ts";
import { tableAccess, tableAllowed, canManage, requireThat, access } from "./auth.ts";
import { id } from "./validation.ts";
import { lockReferenceProject } from "./references.ts";
import type pg from "pg";

export const tableMoves = Router();
async function preview(
  c: pg.Pool | pg.PoolClient,
  user: string,
  key: string,
  department: string,
) {
  const { table, permission } = await tableAccess(user, key, c);
  requireThat(canManage(permission));
  requireThat(
    table.lifecycle === "active" &&
      permission.lifecycle === "active" &&
      permission.workspace_lifecycle === "active",
    409,
    "请先激活空间、项目和数据表",
  );
  const target = (
    await c.query(
      "SELECT id,name FROM departments WHERE id=$1 AND project_id=$2",
      [department, table.project_id],
    )
  ).rows[0];
  requireThat(target, 400, "目标部门不属于当前项目");
  requireThat(department !== table.department_id, 400, "数据表已在此部门");
  const pending = (
    await c.query(
      "SELECT count(*)::int AS count FROM records WHERE table_id=$1 AND status='pending'",
      [key],
    )
  ).rows[0].count;
  const rows = (
    await c.query(
      `SELECT m.*,u.name,u.username FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.project_id=$1 AND u.active AND (m.expires_at IS NULL OR m.expires_at>now())
    AND NOT EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=$2 AND wm.user_id=m.user_id AND wm.role='owner') ORDER BY m.user_id`,
      [table.project_id, permission.workspace_id],
    )
  ).rows;
  const changes = rows
    .map((m) => ({
      user_id: m.user_id,
      name: m.name,
      username: m.username,
      before: tableAllowed(m, table),
      after: tableAllowed(m, { ...table, department_id: department }),
    }))
    .filter((r) => r.before !== r.after);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: table.object_version,
        target: department,
        grants: rows.map((m) => [m.user_id, m.revision]),
        changes,
      }),
    )
    .digest("hex");
  return {
    table,
    workspace: permission.workspace_id,
    target,
    pending,
    changes,
    fingerprint,
  };
}

tableMoves.get("/tables/:table/move-preview", async (req, res) => {
  const p = await preview(
    pool,
    req.user.id,
    id.parse(req.params.table),
    id.parse(req.query.department),
  );
  res.json({
    version: p.table.object_version,
    target: p.target,
    pending: p.pending,
    changes: p.changes,
    fingerprint: p.fingerprint,
  });
});

tableMoves.post("/tables/:table/move", async (req, res) => {
  const key = id.parse(req.params.table);
  const body = z
    .object({
      department_id: id,
      version: z.number().int().positive(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(req.body);
  const initial = await tableAccess(req.user.id, key);
  requireThat(canManage(initial.permission));
  await tx(async (c) => {
    await lockReferenceProject(c, initial.table.project_id);
    await c.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
      initial.permission.workspace_id,
    ]);
    await c.query("SELECT id FROM projects WHERE id=$1 FOR SHARE", [
      initial.table.project_id,
    ]);
    await c.query("SELECT id FROM data_tables WHERE id=$1 FOR UPDATE", [key]);
    const p = await preview(c, req.user.id, key, body.department_id);
    requireThat(
      p.table.object_version === body.version &&
        p.fingerprint === body.fingerprint,
      409,
      "表或成员权限已变化，请重新预览移动影响",
    );
    requireThat(
      p.pending === 0,
      409,
      "存在待审核记录，请先完成审批或撤回再移动",
    );
    await c.query(
      "UPDATE data_tables SET department_id=$1,object_version=object_version+1 WHERE id=$2",
      [body.department_id, key],
    );
    await audit(c, p.workspace, req.user.id, "移动数据表", key, {
      project: p.table.project_id,
      from: p.table.department_id,
      to: body.department_id,
      access_changes: p.changes,
    });
  });
  res.json({ ok: true });
});

const transferInput=z.object({
  project:id,department:id,name:z.string().trim().min(1).max(120),
  action:z.enum(['copy','move']),include_records:z.boolean(),clear_external_links:z.boolean().default(false),
  fingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
async function transfer(c:pg.PoolClient,user:string,key:string,b:z.infer<typeof transferInput>,apply:boolean){
  const initial=await tableAccess(user,key);
  const projects=[...new Set([initial.table.project_id,b.project])].sort();
  for(const project of projects)await lockReferenceProject(c,project);
  await c.query('SELECT id FROM data_tables WHERE id=$1 FOR NO KEY UPDATE',[key]);
  const {table,permission}=await tableAccess(user,key,c);
  const target=await access(user,b.project,c);
  requireThat(canManage(permission)&&canManage(target));
  requireThat(table.lifecycle==='active'&&permission.lifecycle==='active'&&permission.workspace_lifecycle==='active'&&target.lifecycle==='active'&&target.workspace_lifecycle==='active',409,'仅可转移活动项目中的活动数据表');
  requireThat((await c.query('SELECT 1 FROM departments WHERE id=$1 AND project_id=$2',[b.department,b.project])).rowCount,400,'目标部门不属于目标项目');
  requireThat(!(await c.query("SELECT 1 FROM data_tables WHERE project_id=$1 AND department_id=$2 AND name=$3 AND lifecycle<>'deleted'",[b.project,b.department,b.name])).rowCount,409,'目标部门已有同名数据表');
  const flags=(await c.query(`SELECT
    EXISTS(SELECT 1 FROM plan_data_tables WHERE table_id=$1 UNION ALL SELECT 1 FROM planning_tables WHERE table_id=$1 UNION ALL SELECT 1 FROM project_agenda_tables WHERE table_id=$1 UNION ALL SELECT 1 FROM project_public_mappings WHERE source_table_id=$1) AS bound,
    EXISTS(SELECT 1 FROM project_public_views v WHERE v.deleted_at IS NULL AND v.definition->'sources' ? $1::text UNION ALL SELECT 1 FROM data_tables t CROSS JOIN LATERAL jsonb_array_elements(t.columns) f WHERE t.id<>$1 AND t.lifecycle<>'deleted' AND f->>'target_table'=$1::text AND coalesce(f->>'lifecycle','active')<>'deleted') AS incoming,
    EXISTS(SELECT 1 FROM records WHERE table_id=$1 AND lifecycle<>'deleted' AND (status='pending' OR (lifecycle<>'active' AND status<>'obsolete'))) AS pending`,[key])).rows[0];
  const external=table.columns.filter((f:any)=>f.lifecycle!=='deleted'&&(f.type==='backlink'||(f.type==='reference'&&f.target_table!==key))).map((f:any)=>f.name);
  requireThat(b.action!=='move'||(b.include_records&&!flags.bound&&!flags.incoming&&!flags.pending&&!external.length),409,'绑定表、有外部引用或存在待审记录时只能复制；移动必须包含记录');
  const rows=b.include_records?(await c.query("SELECT id,data,version FROM records WHERE table_id=$1 AND lifecycle='active' AND status IN ('draft','approved','rejected') ORDER BY created_at,id LIMIT 5001",[key])).rows:[];
  requireThat(rows.length<=5000,409,'单次最多转移 5000 条记录，请分批导入');
  const fingerprint=createHash('sha256').update(JSON.stringify({key,version:table.object_version,b:{...b,fingerprint:undefined},flags,rows:rows.map(r=>[r.id,r.version])})).digest('hex');
  if(!apply)return {fingerprint,records:rows.length,external,bound:flags.bound};
  requireThat(b.fingerprint===fingerprint,409,'源表已改变，请重新预览');
  requireThat(!external.length||b.clear_external_links,409,'请确认跨表关联不会随单表复制');
  const dest=uid(), ids=new Map(rows.map(r=>[r.id,uid()]));
  const fields=table.columns.filter((f:any)=>f.lifecycle!=='deleted'&&f.type!=='backlink').map((f:any)=>{
    const {inverse_id,source_field,derived_reference,bidirectional,...col}=f;
    if(derived_reference||f.type==='reference'&&f.target_table!==key){
      const {target_table,display_column,...rest}=col;
      return {...rest,type:'text',required:false};
    }
    return f.type==='reference'?{...col,target_table:dest}:col;
  });
  const fieldIds=new Set(fields.map((f:any)=>f.id));
  const sourceFields=new Map<string,any>(table.columns.map((f:any)=>[f.id,f]));
  await c.query('INSERT INTO data_tables(id,project_id,department_id,name,description,columns) VALUES($1,$2,$3,$4,$5,$6)',[dest,b.project,b.department,b.name,table.description,JSON.stringify(fields)]);
  const links:Array<{key:string;data:Record<string,unknown>}>=[];
  for(const row of rows){
    const value:Record<string,unknown>={}, deferred:Record<string,unknown>={};
    for(const [id,v] of Object.entries(row.data)){
      const f=sourceFields.get(id);
      if(!f||!fieldIds.has(id)||f.derived_reference||f.type==='formula')continue;
      if(f.type==='reference'){
        if(f.target_table===key&&Array.isArray(v))deferred[id]=v.flatMap(ref=>ids.has(ref)?[ids.get(ref)]:[]);
      }else value[id]=v;
    }
    const rowId=ids.get(row.id)!;
    await c.query("INSERT INTO records(id,table_id,data,created_by,status) VALUES($1,$2,$3,$4,'draft')",[rowId,dest,JSON.stringify(value),user]);
    if(Object.keys(deferred).length)links.push({key:rowId,data:deferred});
  }
  for(const row of links)await c.query('UPDATE records SET data=data||$2::jsonb WHERE id=$1',[row.key,JSON.stringify(row.data)]);
  if(b.action==='move')await c.query("UPDATE data_tables SET lifecycle='deleted',object_version=object_version+1 WHERE id=$1",[key]);
  const event={from:table.project_id,to:b.project,target_table:dest,records:rows.length};
  await audit(c,permission.workspace_id,user,b.action==='move'?'跨项目移动数据表':'跨项目复制数据表',key,event);
  if(target.workspace_id!==permission.workspace_id)await audit(c,target.workspace_id,user,'接收跨空间数据表',dest,event);
  return {id:dest,records:rows.length};
}
tableMoves.post('/tables/:table/transfer-preview',async(req,res)=>res.json(await tx(c=>transfer(c,req.user.id,id.parse(req.params.table),transferInput.parse(req.body),false))));
tableMoves.post('/tables/:table/transfer',async(req,res)=>res.json(await tx(c=>transfer(c,req.user.id,id.parse(req.params.table),transferInput.parse(req.body),true))));
