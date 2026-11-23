import {pool,uid,audit,requestTransaction} from './db.ts';import {captureTemplateSnapshot} from './report-documents.ts';
export async function saveTemplateSnapshot(user:string,projectId:string,templateId:string,name?:string,range?:{dateFrom?:string;dateTo?:string},origin?:string){
 const shared=requestTransaction.getStore(),c=shared||await pool.connect();try{
 if(!shared){await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query("SELECT set_config('app.actor_id',$1,true)",[user]);}
 const result=await requestTransaction.run(c,async()=>{const snapshot=await captureTemplateSnapshot(user,projectId,templateId,range);const id=uid();await c.query('INSERT INTO reports(id,project_id,name,snapshot,created_by) VALUES($1,$2,$3,$4,$5)',[id,projectId,name||snapshot.reportName+' · '+new Intl.DateTimeFormat('en-CA',{timeZone:process.env.REPORT_TIME_ZONE||'Europe/Helsinki'}).format(new Date(snapshot.generatedAt)),JSON.stringify({...snapshot,...(origin?{origin}:{})}),user]);const project=(await c.query('SELECT workspace_id FROM projects WHERE id=$1',[projectId])).rows[0];await audit(c,project.workspace_id,user,'report.snapshot.period',id,{template_id:templateId,category:snapshot.category});return {id}});
 if(!shared)await c.query('COMMIT');return result;
 }catch(e){if(!shared)await c.query('ROLLBACK');throw e}finally{if(!shared)c.release()}
}
