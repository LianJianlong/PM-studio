import {isReference} from '../shared/fields.ts';
import {Router} from 'express';import {z} from 'zod';import {pool} from './db.ts';
import {access,tableAllowed,visibleColumns,recordVisibilitySql,projectRecord,rowAllowed,tableAccess} from './auth.ts';import {canReadFullPlan} from './planning-read-access.ts';import {effectiveActivities} from './effective-activities.ts';import {projectCapabilities} from './project-capabilities.ts';
export const dataReadiness=Router();
dataReadiness.get('/projects/:project/capabilities',async(req,res)=>res.json(await projectCapabilities(await access(req.user.id,z.uuid().parse(req.params.project)))));
dataReadiness.get('/projects/:project/data-readiness',async(req,res)=>{
 const a=await access(req.user.id,z.uuid().parse(req.params.project)),tables=(await pool.query("SELECT t.*,d.name department_name FROM data_tables t LEFT JOIN departments d ON d.id=t.department_id WHERE t.project_id=$1 AND t.lifecycle<>'deleted' ORDER BY t.name",[a.id])).rows.filter(t=>tableAllowed(a,t)),issues:any[]=[],summaries:any[]=[];let sampled=0;
 for(const t of tables){
  const scope=recordVisibilitySql(a,'$2','r'),counts=(await pool.query(`SELECT status,count(*)::int n FROM records r WHERE r.table_id=$1 AND r.lifecycle='active' AND ${scope} GROUP BY status`,[t.id,req.user.id])).rows;
  summaries.push({table_id:t.id,name:t.name,department:t.department_name,counts:Object.fromEntries(counts.map(r=>[r.status,r.n]))});
  if(sampled>=500)continue;
  const rows=(await pool.query(`SELECT r.* FROM records r WHERE r.table_id=$1 AND r.lifecycle='active' AND ${scope} ORDER BY r.updated_at DESC LIMIT $3`,[t.id,req.user.id,Math.min(100,500-sampled)])).rows;sampled+=rows.length;
  const fields=visibleColumns(a,t);
  const references=new Map<string,{readable:boolean;rows:Map<string,any>}>();
  for(const f of fields.filter(isReference)){const ids=[...new Set(rows.flatMap(r=>Array.isArray(r.data?.[f.id])?r.data[f.id]:[]))].filter((v:any)=>typeof v==='string'&&z.uuid().safeParse(v).success) as string[];if(!ids.length)continue;try{const target=await tableAccess(req.user.id,f.target_table);const found=(await pool.query('SELECT id,created_by,updated_by,status,lifecycle,table_id FROM records WHERE table_id=$1 AND id=ANY($2::uuid[])',[target.table.id,ids])).rows.filter(r=>rowAllowed(target.permission,r,req.user.id));references.set(f.id,{readable:true,rows:new Map(found.map(r=>[r.id,r]))})}catch{references.set(f.id,{readable:false,rows:new Map()})}}
  for(const r of rows){const p=projectRecord(a,t,r),label=[p.data.code,p.data.name,p.data.title].filter(Boolean).join(' · ')||'记录';
   const add=(type:string,reason:string,field?:string)=>issues.push({table_id:t.id,table_name:t.name,record_id:r.id,label,type,reason,field,status:r.status,responsible:'由录入人员或本表主管处理'});
   if(['draft','rejected','pending','obsolete'].includes(r.status))add('status',r.status==='draft'?'草稿未生效，主管确认有效后参与共享计算':r.status==='pending'?'等待审批完成':r.status==='rejected'?'已退回，需要修改并重新确认':'已作废，不参与计算');
   for(const f of fields){const v=p.data[f.id];if(isReference(f)&&Array.isArray(v)&&v.length){const target=references.get(f.id);if(!target?.readable)add('reference','关联对象不在当前可校验范围，请联系主管',f.name);else if(v.some((id:string)=>!target.rows.has(id)||target.rows.get(id).lifecycle!=='active'))add('reference','关联记录不可用或不可读，请核查引用',f.name);else if(v.some((id:string)=>target.rows.get(id).status!=='approved'))add('reference','关联记录尚未确认有效',f.name);}if(f.required&&(v===null||v===undefined||v===''||Array.isArray(v)&&!v.length))add('required','缺少必填值',f.name);if(f.type==='formula'&&typeof v==='string'&&v.startsWith('#ERROR'))add('formula','公式计算错误，请核查字段与表达式',f.name)}
  }
 }
 const full=await canReadFullPlan(a);let excluded:any[]=[];
 if(full){const effective=await effectiveActivities(a.id),ids=new Set(effective.map(r=>r.id)),all=(await pool.query('SELECT a.id,a.code,a.name,a.predecessors,r.status,r.lifecycle FROM activities a LEFT JOIN plan_activity_records l ON l.activity_id=a.id LEFT JOIN records r ON r.id=l.record_id WHERE a.project_id=$1',[a.id])).rows;const byId=new Map(all.map(r=>[r.id,r]));excluded=all.filter(r=>!ids.has(r.id)).map(r=>({label:[r.code,r.name].filter(Boolean).join(' · '),reason:r.status!=='approved'?'作业尚未确认有效或源记录不可用':(r.predecessors||[]).some((p:any)=>!byId.has(p.id))?'前置作业不存在':'前置作业链尚未全部确认有效'}));}
 res.json({project_name:a.name,tables:summaries,issues,excluded,full_plan_read:full,sampled_records:sampled,inspection_limit:500,scope:'只检查当前账号可见数据；字段检查最多500条最近记录，状态数量按授权范围完整统计，不自动修改或确认。'});
});
