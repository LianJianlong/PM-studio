import type {Request} from 'express';
import {access,tableAccess,rowAllowed,projectRecord,requireThat} from './auth.ts';
import {pool} from './db.ts';
import {dataCatalog} from './ai-data-tools.ts';
export async function authorizedMentionContext(req:Request,prompt:string){
 const contexts:any[]=[],seen=new Set<string>();
 for(const match of prompt.matchAll(/@\[[\s\S]*?\]\(project:([a-f0-9-]{36});([^)]*)\)/gi)){
  const project=match[1];await access(req.user.id,project);const nodes=match[2].split(';').map(p=>p.split(':'));let table=nodes.find(n=>n[0]==='table'&&/^[a-f0-9-]{36}$/i.test(n[1]))?.[1];
  if(!table){const kind=nodes.find(n=>['plan','planning_table'].includes(n[0])&&['wbs','organization'].includes(n[1]))?.[1];if(kind){table=(await pool.query('SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind=$2',[project,kind])).rows[0]?.table_id;requireThat(table,404,'计划管理尚未绑定该表，请先在计划管理中启用');}}
  if(!table)continue;
  const row=nodes.find(n=>n[0]==='leaf'&&/^[a-f0-9-]{36}$/i.test(n[1]))?.[1];const key=table+':'+(row||'');if(seen.has(key))continue;seen.add(key);requireThat(contexts.length<8,400,'一次最多引用8张表或行，请分次处理');
  const context=await dataCatalog(req,project,{table_id:table});requireThat(context.project?.id===project,403,'引用的表不属于所选项目');
  if(row&&!(await pool.query('SELECT 1 FROM data_tables WHERE id=$1',[table])).rowCount){(context as any).selected_record_id=row;(context as any).record_help='授权视图行，通过该视图记录接口继续读取；不能直接写入计算视图';}
  else if(row){const r=(await pool.query('SELECT * FROM records WHERE id=$1 AND table_id=$2 AND lifecycle=\'active\'',[row,table])).rows[0];const t=await tableAccess(req.user.id,table);requireThat(r&&rowAllowed(t.permission,r,req.user.id),403,'无权读取引用记录或记录已删除');(context as any).selected_record=projectRecord(t.permission,t.table,r);}
  contexts.push(context);
 }return contexts;
}
