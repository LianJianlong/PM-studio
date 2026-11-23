import type {Request} from 'express';
import {numericTypes} from '../shared/fields.ts';
import {needsRelationDiagram,needsProcurementImpact,needsClosureAnalysis} from '../shared/ai-ontology.ts';
import {needsBusinessRuleCheck} from '../shared/business-rule-checks.ts';
import {readCoverage} from '../shared/ai-read-evidence.ts';
import {readBusinessTool} from './ai-business-read.ts';
import {HttpError,access} from './auth.ts';import {pool,audit} from './db.ts';
export type PreparedRead={mode:string;data:any;model_context:any};
/** Execute only unambiguous, authorized reads; never guess a table, metric or relationship. */
export async function prepareBusinessReads(req:Request,project:string,prompt:string,seed:any):Promise<PreparedRead[]>{
 if(/\u4ec0\u4e48\u662f|\u539f\u7406|\u6982\u5ff5|\u65b9\u6cd5|\u6a21\u677f|what is|how to/i.test(prompt))return [];
 const result:PreparedRead[]=[],permission=await access(req.user.id,project);
 const read=async(args:any)=>{try{const data:any=await readBusinessTool(req,project,'business_context',args),mode=args.mode;let model_context:any={mode,source:data.source,coverage:readCoverage(data)};
  if(mode==='search')model_context={...model_context,records:data.rows.slice(0,3).map((r:any)=>({id:r.id,title:r.title,status:r.status})),records_truncated:data.rows.length>3};
  if(mode==='aggregate')model_context={...model_context,metric:data.metric,unit:data.unit,overall:data.overall,rows:data.rows.slice(0,5),scope:data.scope,groups_truncated:data.rows.length>5};
  if(mode==='related')model_context={...model_context,nodes:data.nodes.slice(0,20).map((n:any)=>({id:n.id,table_id:n.table_id,title:n.title,status:n.status})),links:data.visualization?.edges?.slice(0,20),model_nodes_truncated:data.nodes.length>20,model_links_truncated:data.visualization?.edges?.length>20,notice:data.notice};
  if(mode==='closure')model_context={...model_context,kind:'closure',summary:data.readable_summary,missing:data.missing,next_steps:data.next_steps,coverage:data.coverage};
  if(mode==='check')model_context={...model_context,counts:data.counts,findings:data.findings.slice(0,2),model_findings_truncated:data.findings.length>2,notice:data.notice};
  if(mode==='procurement_impact')model_context={...model_context,status:data.status,summary:data.readable_summary,missing:data.missing};
  result.push({mode,data,model_context});await audit(pool,permission.workspace_id,req.user.id,'AI业务只读准备',project,{mode,source:data.source,coverage:readCoverage(data)});return data;
 }catch(e){if(e instanceof HttpError&&[401,403].includes(e.status))throw e;return null}};
 for(const table of (seed?.tables||[]).slice(0,3)){
  const fields=table.fields||[],rows=await read({mode:'search',table_id:table.table_id});
  const labelFields=fields.filter((f:any)=>['code','name','title'].includes(f.id)).map((f:any)=>f.name),specific=(rows?.rows||[]).filter((r:any)=>[r.title,...labelFields.map((name:string)=>r.fields[name])].some(v=>typeof v==='string'&&v!=='\u8bb0\u5f55'&&v.length>1&&prompt.includes(v))),narrow=/\u672c\u5468|\u4e0a\u5468|\u672c\u6708|\u4e0a\u6708|\u4eca\u5929|\u6628\u5929|\u65e5\u671f|\u671f\u95f4|\u5927\u4e8e|\u5c0f\u4e8e|\u7b5b\u9009|\u6309|\u4ec5|\u53ea\u770b|\d{4}-\d{2}|\bfilter\b|\bwhere\b|\bbetween\b|\bthis\b|\blast\b|\bby\b/i.test(prompt);
  if(!needsClosureAnalysis(prompt)&&needsBusinessRuleCheck(prompt)&&!narrow&&!specific.length)await read({mode:'check',table_id:table.table_id});
  if(!narrow&&!specific.length&&/\u6c47\u603b|\u5408\u8ba1|\u603b\u989d|\u603b\u6570|\u5e73\u5747|\u7edf\u8ba1|aggregate|\btotal\b/i.test(prompt)){
   const metrics=fields.filter((f:any)=>(numericTypes.includes(f.type)||f.type==='formula')&&(prompt.includes(f.name)||prompt.includes(f.id)));
   const metric=metrics.length===1?metrics[0].id:/\u591a\u5c11\u6761|\u8bb0\u5f55\u6570|\u603b\u6761\u6570|\bcount\b/i.test(prompt)?'__count__':null;
   if(metric)await read({mode:'aggregate',table_id:table.table_id,metric,dimension:'__status__',aggregation:/\u5e73\u5747|\baverage\b/i.test(prompt)?'average':metric==='__count__'?'count':'sum'});
  }
  const roots=rows?.complete&&!narrow?(specific.length===1?specific:(rows.rows||[]).length<=3?rows.rows:[]):[],root=roots.length===1?roots[0]:null;
  if(root&&needsClosureAnalysis(prompt))await read({mode:'closure',table_id:table.table_id,record_id:root.id});
  if(!needsClosureAnalysis(prompt)&&needsRelationDiagram(prompt))for(const r of roots.slice(0,3))await read({mode:'related',table_id:table.table_id,record_id:r.id,depth:2});
  if(root&&!needsClosureAnalysis(prompt)&&needsProcurementImpact(prompt)&&['procurement','purchase_orders','arrivals','purchase_requests','material_demands'].includes(table.type))await read({mode:'procurement_impact',table_id:table.table_id,record_id:root.id});
 }
 return result;
}
