import {editableRecord} from '../shared/record-policy.ts';
import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { access, tableAccess, rowAllowed, rowScopeAllowed, visibleColumns, canWrite, canRecordAction, operationAllowed, canManage, requireThat, tableAllowed, projectRecord } from "./auth.ts";
import { pool, tx, uid, audit } from "./db.ts";
import { id } from "./validation.ts";
export const recordLinks = Router();
recordLinks.get('/activities/:activity/records',async(req,res)=>{
 const activity=(await pool.query('SELECT * FROM activities WHERE id=$1',[id.parse(req.params.activity)])).rows[0];requireThat(activity,404,'作业不存在');const a=await access(req.user.id,activity.project_id);
 const rows=(await pool.query('SELECT DISTINCT r.* FROM records r LEFT JOIN record_activity_links l ON r.id=l.record_id WHERE (l.activity_id=$1 OR r.id IN(SELECT record_id FROM plan_activity_records WHERE activity_id=$1)) AND r.lifecycle<>\'deleted\' ORDER BY r.created_at DESC LIMIT 200',[activity.id])).rows;
 const tables=(await pool.query('SELECT * FROM data_tables WHERE project_id=$1',[activity.project_id])).rows;const result=[];
 for(const r of rows){const t=tables.find(t=>t.id===r.table_id);if(!t||!tableAllowed(a,t)||!rowAllowed(a,r,req.user.id))continue;const record=projectRecord(a,t,r);const value=Object.values(record.data).find(v=>typeof v==='string'||typeof v==='number');result.push({id:r.id,table_name:t.name,status:r.status,title:String(value??r.id).slice(0,160)});}
 res.json(result);
});
async function recordScope(user: string, key: string, c: pg.Pool | pg.PoolClient = pool, write = false, version?: number) {
 const r = (await c.query("SELECT * FROM records WHERE id=$1"+(write?" FOR UPDATE":""),[key])).rows[0];
 requireThat(r,404,"记录不存在"); const { table, permission:a }=await tableAccess(user,r.table_id,c);
 requireThat(rowAllowed(a,r,user)); requireThat(r.lifecycle!=="deleted"&&table.lifecycle!=="deleted",404,"记录不可访问");
 if(write){requireThat(canRecordAction(a,table,"update"));requireThat(r.version===version,409,"记录版本已变化，请刷新关联");requireThat(editableRecord(table,r.status)&&r.lifecycle==="active"&&table.lifecycle==="active"&&a.lifecycle==="active"&&a.workspace_lifecycle==="active",409,"仅活动草稿或退回记录可修改关联，请先发起变更");}
 return {r,table,a};
}
recordLinks.get('/records/:record/links',async(req,res)=>{
 const {r,table,a}=await recordScope(req.user.id,id.parse(req.params.record));
 const attachments=(await pool.query(`SELECT l.id,l.file_name,v.version,v.size_bytes,v.sha256,f.lifecycle AS file_lifecycle,l.created_at FROM record_file_links l JOIN project_file_versions v ON v.id=l.file_version_id JOIN project_files f ON f.id=v.file_id WHERE l.record_id=$1 ORDER BY l.created_at,l.id`,[r.id])).rows;
 const activities=(await pool.query(`SELECT a.id,a.code,a.name,a.progress,a.duration FROM record_activity_links l JOIN activities a ON a.id=l.activity_id WHERE l.record_id=$1 ORDER BY a.code,a.id`,[r.id])).rows;
 res.json({record_version:r.version,status:r.status,project_id:table.project_id,editable:canRecordAction(a,table,"update")&&editableRecord(table,r.status)&&r.lifecycle==='active'&&table.lifecycle==='active'&&a.lifecycle==='active'&&a.workspace_lifecycle==='active',attachments,activities});
});
recordLinks.get('/records/:record/link-candidates',async(req,res)=>{
 const {table}=await recordScope(req.user.id,id.parse(req.params.record));const search=z.string().trim().max(120).default('').parse(req.query.search);
 const scope=await access(req.user.id,table.project_id);const files=operationAllowed(scope,'$files','read')?(await pool.query("SELECT id,name,current_version FROM project_files WHERE project_id=$1 AND kind='file' AND lifecycle='active' AND strpos(lower(name),lower($2))>0 ORDER BY name,id LIMIT 100",[table.project_id,search])).rows:[];
 const activities=(await pool.query("SELECT id,code,name FROM activities WHERE project_id=$1 AND (strpos(lower(name),lower($2))>0 OR strpos(lower(code),lower($2))>0) ORDER BY code,id LIMIT 100",[table.project_id,search])).rows;
 res.json({files,activities});
});
const attachBody=z.object({version:z.number().int().positive(),file_id:id,file_version:z.number().int().positive()});
recordLinks.post('/records/:record/attachments',async(req,res)=>{
 const body=attachBody.parse(req.body);const result=await tx(async(c)=>{
  const {r,table,a}=await recordScope(req.user.id,id.parse(req.params.record),c,true,body.version);requireThat(operationAllowed(a,"$files","read"));
  const f=(await c.query(`SELECT f.id,f.name,f.project_id,f.lifecycle,f.kind,v.id AS version_id FROM project_files f JOIN project_file_versions v ON v.file_id=f.id AND v.version=$2 WHERE f.id=$1 FOR SHARE OF f`,[body.file_id,body.file_version])).rows[0];
  requireThat(f&&f.kind==='file'&&f.lifecycle==='active',404,'文件版本不存在或已删除');requireThat(f.project_id===table.project_id,403,'不能关联其他项目文件');
  requireThat(!(await c.query('SELECT 1 FROM record_file_links WHERE record_id=$1 AND file_version_id=$2',[r.id,f.version_id])).rowCount,409,'该文件版本已关联');
  requireThat(Number((await c.query('SELECT count(*) AS total FROM record_file_links WHERE record_id=$1',[r.id])).rows[0].total)<50,409,'每条记录最多关联50个文件版本');const link=uid();
  await c.query('INSERT INTO record_file_links(id,record_id,file_version_id,file_name,created_by) VALUES($1,$2,$3,$4,$5)',[link,r.id,f.version_id,f.name,req.user.id]);
  await c.query("UPDATE records SET version=version+1,status='draft',updated_at=now() WHERE id=$1",[r.id]);await audit(c,a.workspace_id,req.user.id,'关联记录附件',r.id,{link_id:link,file_version_id:f.version_id});return{id:link,version:r.version+1};
 });res.status(201).json(result);
});
recordLinks.delete('/records/:record/attachments/:link',async(req,res)=>{
 const version=z.number().int().positive().parse(req.body.version);await tx(async(c)=>{const {r,a}=await recordScope(req.user.id,id.parse(req.params.record),c,true,version);const deleted=await c.query('DELETE FROM record_file_links WHERE id=$1 AND record_id=$2',[id.parse(req.params.link),r.id]);requireThat(deleted.rowCount,404,'关联不存在');await c.query("UPDATE records SET version=version+1,status='draft',updated_at=now() WHERE id=$1",[r.id]);await audit(c,a.workspace_id,req.user.id,'解除记录附件',r.id,{link_id:req.params.link});});res.json({ok:true});
});
recordLinks.get('/records/:record/attachments/:link/download',async(req,res)=>{
 const {r}=await recordScope(req.user.id,id.parse(req.params.record));
 const link=(await pool.query(`SELECT l.file_name,v.mime_type,v.content FROM record_file_links l JOIN project_file_versions v ON v.id=l.file_version_id WHERE l.record_id=$1 AND l.id=$2`,[r.id,id.parse(req.params.link)])).rows[0];requireThat(link,404,'关联不存在');
 res.set({'Content-Type':link.mime_type,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(link.file_name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(link.content);
});
recordLinks.post('/records/:record/activities',async(req,res)=>{
 const body=z.object({version:z.number().int().positive(),activity_id:id}).parse(req.body);await tx(async(c)=>{const {r,a,table}=await recordScope(req.user.id,id.parse(req.params.record),c,true,body.version);const activity=(await c.query('SELECT * FROM activities WHERE id=$1 FOR SHARE',[body.activity_id])).rows[0];requireThat(activity&&activity.project_id===table.project_id,403,'作业不存在或不属于当前项目');requireThat(!(await c.query('SELECT 1 FROM record_activity_links WHERE record_id=$1 AND activity_id=$2',[r.id,activity.id])).rowCount,409,'该作业已关联');await c.query('INSERT INTO record_activity_links(record_id,activity_id,created_by) VALUES($1,$2,$3)',[r.id,activity.id,req.user.id]);await c.query("UPDATE records SET version=version+1,status='draft',updated_at=now() WHERE id=$1",[r.id]);await audit(c,a.workspace_id,req.user.id,'关联计划作业',r.id,{activity_id:activity.id});});res.status(201).json({ok:true});
});
recordLinks.delete('/records/:record/activities/:activity',async(req,res)=>{const version=z.number().int().positive().parse(req.body.version);await tx(async(c)=>{const {r,a}=await recordScope(req.user.id,id.parse(req.params.record),c,true,version);const d=await c.query('DELETE FROM record_activity_links WHERE record_id=$1 AND activity_id=$2',[r.id,id.parse(req.params.activity)]);requireThat(d.rowCount,404,'关联不存在');await c.query("UPDATE records SET version=version+1,status='draft',updated_at=now() WHERE id=$1",[r.id]);await audit(c,a.workspace_id,req.user.id,'解除作业关联',r.id,{activity_id:req.params.activity});});res.json({ok:true});});

async function approvalEvidence(user:string,key:string){
 const ap=(await pool.query('SELECT * FROM approvals WHERE id=$1',[key])).rows[0];requireThat(ap?.kind==='record',404,'记录审批不存在');
 const r=(await pool.query('SELECT * FROM records WHERE id=$1',[ap.record_id])).rows[0];requireThat(r&&r.lifecycle!=='deleted',404,'记录不可访问');const {table,permission:a}=await tableAccess(user,r.table_id);requireThat(rowScopeAllowed(a,r,user)&&visibleColumns(a,table).length===table.columns.filter((f:any)=>f.lifecycle!=='deleted').length);
 requireThat(canManage(a)||ap.requester_id===user||ap.approver_id===user||(await pool.query('SELECT 1 FROM approval_events WHERE approval_id=$1 AND actor_id=$2',[ap.id,user])).rowCount,403,'无权查看此审批证据');
 return ap.payload._record_links;
}
recordLinks.get('/approvals/:approval/record-evidence',async(req,res)=>{
 const evidence=await approvalEvidence(req.user.id,id.parse(req.params.approval));
 res.json({snapshot:!!evidence,attachments:evidence?.attachments??[],activities:evidence?.activities??[]});
});
recordLinks.get('/approvals/:approval/record-evidence/:version/download',async(req,res)=>{
 const evidence=await approvalEvidence(req.user.id,id.parse(req.params.approval));
 const item=evidence?.attachments.find((f:any)=>f.id===id.parse(req.params.version));requireThat(item,404,'审批附件快照不存在');
 const file=(await pool.query('SELECT mime_type,content FROM project_file_versions WHERE id=$1',[item.id])).rows[0];requireThat(file,404,'附件版本不存在');
 res.set({'Content-Type':file.mime_type,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(item.file_name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.send(file.content);
});
