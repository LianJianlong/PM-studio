import type pg from 'pg';import {uid,audit} from './db.ts';import {buildReportTemplates} from '../shared/report-template-catalog.ts';
export async function installReportTemplates(c:pg.PoolClient,project:any,actor:string,refreshSeeded=false){
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['report-template-suite:'+project.id]);
 const registered=(await c.query("SELECT * FROM project_business_templates WHERE project_id=$1",[project.id])).rows;
 const ts=(await c.query("SELECT * FROM data_tables WHERE project_id=$1 AND lifecycle='active'",[project.id])).rows;
 const vs=(await c.query('SELECT * FROM project_public_views WHERE project_id=$1 AND deleted_at IS NULL',[project.id])).rows;
 const tables:Record<string,any>={};for(const r of registered){const t=ts.find(t=>t.id===r.object_id);if(r.kind==='table'&&t)tables[r.template_key]=t;if(r.kind==='view'){const v=vs.find(v=>v.id===r.object_id);if(v)tables[r.template_key]={...v,columns:v.definition.columns.map((f:any)=>({id:f.id,name:f.name,type:f.aggregation&&f.aggregation!=='none'?'decimal':'text'}))}}}
 let created=0,skipped=0,refreshed=0;const missing:string[]=[];
 for(const spec of buildReportTemplates(tables,project.name,project.currency||'CNY')){const key='suite-v1:'+spec.key;
  const existing=registered.find(r=>r.kind==='report'&&r.template_key===key);if(existing){if(refreshSeeded){const old=(await c.query('SELECT * FROM report_documents WHERE id=$1 AND version=1 AND deleted_at IS NULL',[existing.object_id])).rows[0];if(old&&JSON.stringify(old.layout)!==JSON.stringify(spec.layout)){await c.query('UPDATE report_documents SET layout=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=1',[JSON.stringify(spec.layout),old.id]);refreshed++;}}skipped++;continue;}
  const id=uid();await c.query('INSERT INTO report_documents(id,project_id,name,layout,created_by) VALUES($1,$2,$3,$4,$5)',[id,project.id,spec.name,JSON.stringify(spec.layout),actor]);
  await c.query("INSERT INTO project_business_templates(project_id,kind,template_key,object_id,applied_version) VALUES($1,'report',$2,$3,1)",[project.id,key,id]);created++;missing.push(...spec.missing.map((name:string)=>spec.name+'：'+name));
 }
 await audit(c,project.workspace_id,actor,'report.templates.install',project.id,{created,skipped,refreshed,missing});return {created,skipped,refreshed,missing};
}
