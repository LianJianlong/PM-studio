import {Router} from 'express';import {z} from 'zod';import {createHash,randomUUID} from 'node:crypto';
import {access,tableAccess,canManage,canRecordAction,rowAllowed,visibleColumns,operationAllowed,requireThat} from './auth.ts';
import {pool,tx,requestTransaction,audit} from './db.ts';import {id,field} from './validation.ts';import {lockReferenceProject} from './references.ts';
import {editableRecord} from '../shared/record-policy.ts';import {codeRule,codeSuggestions,renumberActivityCodes} from '../shared/activity-codes.ts';
import {updateRecord} from './data.ts';import {BATCH_UPDATE_LIMIT} from '../shared/batch-limits.ts';
export const activityCodes=Router(),path='/projects/:project/activity-codes';
const ruleSchema=z.object({auto_code:z.boolean(),code_prefix:z.string().max(20).regex(/^[A-Za-z0-9._-]*$/),code_start:z.string().regex(/^[1-9][0-9]{0,11}$/),code_step:z.string().regex(/^[1-9][0-9]{0,6}$/),code_width:z.number().int().min(1).max(12),code_fill_gaps:z.boolean()}).strict();
const numbering=z.object({records:z.array(z.object({id,version:z.number().int().positive()}).strict()).min(1).max(BATCH_UPDATE_LIMIT),rule:ruleSchema,source_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirm:z.boolean().optional()}).strict();
async function scope(user:string,project:string,c:any=pool){
 const link=(await c.query('SELECT table_id FROM plan_data_tables WHERE project_id=$1',[project])).rows[0];requireThat(link,404,'此项目尚未建立作业数据表');
 const {table,permission:a}=await tableAccess(user,link.table_id,c);requireThat(a.id===project,404,'作业表不属于当前项目');
 requireThat(operationAllowed(a,'$data','read')&&visibleColumns(a,table).some((f:any)=>f.id==='code'),403,'没有作业编码读取权限');
 const code=table.columns.find((f:any)=>f.id==='code'&&f.type==='text');requireThat(code,409,'未找到作业编码列');return {table,a,code};
}
async function usedCodes(c:any,project:string,table:string){return (await c.query(`SELECT code FROM activities WHERE project_id=$1 UNION SELECT data->>'code' FROM records WHERE table_id=$2 AND lifecycle<>'deleted' AND data->>'code' IS NOT NULL`,[project,table])).rows.map((r:any)=>r.code);}
activityCodes.get(path,async(req,res)=>{const s=await scope(req.user.id,id.parse(req.params.project));const rule=codeRule(s.code);let examples:string[]=[],warning='';try{examples=codeSuggestions(rule,await usedCodes(pool,s.a.id,s.table.id));}catch(e){warning=(e as Error).message;}res.json({rule,version:s.table.object_version,table_id:s.table.id,examples,warning,can_manage:canManage(s.a)&&operationAllowed(s.a,'$data','update')&&[s.a.lifecycle,s.a.workspace_lifecycle,s.table.lifecycle].every(v=>v==='active')});});
activityCodes.put(path,async(req,res)=>{
 const project=id.parse(req.params.project),body=z.object({version:z.number().int().positive(),rule:ruleSchema}).strict().parse(req.body);
 await tx(async c=>{await lockReferenceProject(c,project);const s=await scope(req.user.id,project,c);requireThat(canManage(s.a)&&operationAllowed(s.a,'$data','update'));requireThat([s.a.lifecycle,s.a.workspace_lifecycle,s.table.lifecycle].every(v=>v==='active'),409,'仅活动项目及作业表可设置编码');
  const t=(await c.query('SELECT * FROM data_tables WHERE id=$1 FOR UPDATE',[s.table.id])).rows[0];requireThat(t.object_version===body.version,409,'作业表设置已变化，请刷新后重试');
  const old=t.columns.find((f:any)=>f.id==='code'),next={...old,...body.rule};if(!body.rule.auto_code)for(const k of ['code_prefix','code_start','code_step','code_width','code_fill_gaps'])delete next[k];field.parse(next);
  await c.query('UPDATE data_tables SET columns=$2,object_version=object_version+1 WHERE id=$1',[t.id,JSON.stringify(t.columns.map((f:any)=>f.id==='code'?next:f))]);await audit(c,s.a.workspace_id,req.user.id,'更新作业编码规则',project,{before:codeRule(old),after:body.rule});
 });res.json({ok:true});
});
async function preview(c:any,user:string,project:string,b:z.infer<typeof numbering>){
 requireThat(new Set(b.records.map(r=>r.id)).size===b.records.length,400,'不能重复选择同一作业');const s=await scope(user,project,c);requireThat(canRecordAction(s.a,s.table,'update')&&operationAllowed(s.a,'$data','update'),403,'没有作业编码修改权限');requireThat([s.a.lifecycle,s.a.workspace_lifecycle,s.table.lifecycle].every(v=>v==='active'),409,'仅活动项目及作业表可重新编号');
 const records=(await c.query(`SELECT r.*,l.activity_id,a.code AS activity_code,a.version AS activity_version FROM records r JOIN plan_activity_records l ON l.record_id=r.id JOIN activities a ON a.id=l.activity_id AND a.project_id=$2 WHERE r.table_id=$1 AND r.id=ANY($3::uuid[]) ORDER BY r.id FOR UPDATE OF r,a`,[s.table.id,project,b.records.map(r=>r.id)])).rows;
 requireThat(records.length===b.records.length,409,'部分所选作业已变化或不属于当前项目');const byId=new Map<string,any>(records.map((r:any)=>[r.id,r]));const ordered=b.records.map(input=>{const r=byId.get(input.id)!;requireThat(rowAllowed(s.a,r,user),403,'部分作业不在可修改范围');requireThat(r.lifecycle==='active'&&editableRecord(s.table,r.status),409,'部分作业待审、冻结或不可编辑');requireThat(r.version===input.version,409,'作业已被修改，请刷新后重新预览');return r;});
 const outside=(await c.query(`SELECT data->>'code' AS code FROM records WHERE table_id=$1 AND lifecycle='active' AND status<>'obsolete' AND NOT id=ANY($2::uuid[]) UNION SELECT code FROM activities WHERE project_id=$3 AND NOT id=ANY($4::uuid[])`,[s.table.id,b.records.map(r=>r.id),project,ordered.map(r=>r.activity_id)])).rows.map((r:any)=>r.code);
 let numbered;try{numbered=renumberActivityCodes(b.rule,ordered.map(r=>({id:r.id,code:r.data.code})),outside)}catch(e){requireThat(false,400,(e as Error).message);throw e}
 const changes=numbered.map((r,i)=>({...r,name:visibleColumns(s.a,s.table).some((f:any)=>f.id==='name')?ordered[i].data.name:'作业',status_before:ordered[i].status,status_after:r.changed?'draft':ordered[i].status}));
 const source_hash=createHash('sha256').update(JSON.stringify({table:s.table.id,columns:s.table.columns,version:s.table.object_version,records:ordered,outside:[...new Set(outside)].sort(),input:b.rule,changes})).digest('hex');
 return {s,ordered,changes,source_hash};
}
activityCodes.post(path+'/preview',async(req,res)=>{const project=id.parse(req.params.project),b=numbering.parse(req.body);const p=await tx(async c=>{await lockReferenceProject(c,project);return preview(c,req.user.id,project,b)});res.json({changes:p.changes,source_hash:p.source_hash,changed:p.changes.filter(r=>r.changed).length});});
activityCodes.post(path+'/apply',async(req,res)=>{
 const project=id.parse(req.params.project),b=numbering.parse(req.body);requireThat(b.confirm&&b.source_hash,400,'请先预览并确认重新编号');
 const count=await tx(async c=>requestTransaction.run(c,async()=>{await lockReferenceProject(c,project);const p=await preview(c,req.user.id,project,b);requireThat(p.source_hash===b.source_hash,409,'作业或编码设置已变化，请重新预览');
  const changed=p.changes.filter(r=>r.changed);if(!changed.length)return 0;
  // Temporary codes break swaps/cycles; neither temporary values nor partial updates commit.
  for(const row of changed){let temporary='RN'+randomUUID().replaceAll('-','');while((await c.query('SELECT 1 FROM activities WHERE project_id=$1 AND code=$2',[project,temporary])).rowCount)temporary='RN'+randomUUID().replaceAll('-','');await c.query("UPDATE records SET data=jsonb_set(data,'{code}',to_jsonb($2::text)) WHERE id=$1",[row.id,temporary]);}
  for(const row of changed){const original=p.ordered.find(r=>r.id===row.id);await updateRecord(req.user.id,row.id,{version:original.version,data:{code:row.after}});}
  await audit(c,p.s.a.workspace_id,req.user.id,'批量重新编号作业',project,{rule:b.rule,changes:changed.map(r=>({id:r.id,before:r.before,after:r.after})),order:'用户显示顺序'});return changed.length;
 }));res.json({ok:true,count,status:'draft'});
});
