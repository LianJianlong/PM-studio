import { Router } from 'express';
import { access, canManage, tableAllowed, rowScopeAllowed } from './auth.ts';
import { pool } from './db.ts';
import { id } from './validation.ts';
export const workItems=Router();
workItems.get('/projects/:project/work-items',async(req,res)=>{
 const a=await access(req.user.id,id.parse(req.params.project));const tasks:any[]=[];
 const approvals=(await pool.query("SELECT id,title,kind,record_id,created_at FROM approvals WHERE project_id=$1 AND approver_id=$2 AND status='pending' ORDER BY created_at,id LIMIT 100",[a.id,req.user.id])).rows;
 const tables=(await pool.query('SELECT id,department_id,lifecycle FROM data_tables WHERE project_id=$1',[a.id])).rows;
 const records=(await pool.query('SELECT id,table_id,created_by,lifecycle FROM records WHERE id=ANY($1::uuid[])',[approvals.filter(item=>item.kind==='record').map(item=>item.record_id)])).rows;
 for(const item of approvals){
  if(item.kind==='access'&&a.role!=='owner')continue;
  if(['stage','baseline','resource'].includes(item.kind)&&!canManage(a))continue;
  if(item.kind==='record'){
   if(!['owner','manager','reviewer'].includes(a.role))continue;
   const r=records.find(r=>r.id===item.record_id),t=tables.find(t=>t.id===r?.table_id);
   if(!r||!t||!tableAllowed(a,t)||!rowScopeAllowed(a,r,req.user.id)||r.lifecycle==='deleted')continue;
  }
  tasks.push({kind:'approval',id:item.id,title:item.title,action:'审批',created_at:item.created_at});
 }
 const owners=(await pool.query("SELECT id,title,status,updated_at FROM owner_items WHERE project_id=$1 AND ((status='submitted' AND reviewer_id=$2) OR (status='reviewed' AND approver_id=$2)) ORDER BY updated_at,id LIMIT 100",[a.id,req.user.id])).rows;
 for(const item of owners){if(item.status==='submitted'&&!['owner','manager','reviewer'].includes(a.role))continue;if(item.status==='reviewed'&&!canManage(a))continue;tasks.push({kind:'owner_item',id:item.id,title:item.title,action:item.status==='submitted'?'业主事项审核':'业主事项批复',created_at:item.updated_at});}
 res.json({items:tasks.sort((x,y)=>new Date(x.created_at).getTime()-new Date(y.created_at).getTime()),readonly:a.lifecycle!=='active'||a.workspace_lifecycle!=='active'});
});
