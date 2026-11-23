import {needsBusinessRuleCheck} from './business-rule-checks.ts';
import {needsProcurementImpact,needsRelationDiagram,needsClosureAnalysis} from './ai-ontology.ts';
export function readCoverage(result:any){const c=result?.coverage;
 if(result?.kind==='closure')return `闭环已核验 ${c.checked}/${c.nodes} 个已读对象；最多 ${c.depth} 层${c.truncated?'，路径已截取':''}；不是全项目检查`;
 if(c&&'checked'in c)return `\u5df2\u68c0\u67e5 ${c.checked}/${c.matched} \u6761\u8bb0\u5f55${c.complete?'':'\uff08\u8303\u56f4\u672a\u5b8c\u6574\u8986\u76d6\uff09'}`;
 if(c&&'nodes'in c)return `${c.nodes} \u4e2a\u5bf9\u8c61 / ${c.edges} \u6761\u5173\u7cfb${c.truncated?'\uff08\u8303\u56f4\u5df2\u622a\u53d6\uff09':''}`;
 if(c&&'matched'in c)return `\u5339\u914d ${c.matched} \u6761\u6709\u6548\u8bb0\u5f55 / \u663e\u793a ${c.shown}/${c.groups} \u7ec4${c.groups_truncated?'\uff08\u5206\u7ec4\u5df2\u622a\u53d6\uff09':''}`;
 if(result&&'total'in result)return `${result.loaded??result.entities?.length??result.tables?.length??0}/${result.total}`;
 return '\u539f\u4e1a\u52a1\u63a5\u53e3\u5f53\u524d\u6388\u6743\u7ed3\u679c';
}
export function compactReadResult(result:any){
 if(result?.kind==='closure')return {kind:'closure',source:result.source,read_only:true,scope:result.scope,coverage:result.coverage,stages:result.stages,readable_summary:result.readable_summary,missing:result.missing,next_steps:result.next_steps};
 if(!result||!Array.isArray(result.findings))return result;
 return {...result,findings:result.findings.slice(0,8),readable_summary:undefined,model_findings_truncated:result.findings.length>8};
}
export function addReadArtifact(state:{visualizations:any[];rule_reports:any[];closure_reports?:any[]},mode:string,result:any){
 if(mode==='closure'&&result?.kind==='closure'){const reports=state.closure_reports??=[];const at=reports.findIndex(r=>r.scope.table_id===result.scope.table_id&&r.scope.record_id===result.scope.record_id);if(at>=0)reports[at]=result;else if(reports.length<2)reports.push(result);return;}
 if(mode==='check'&&Array.isArray(result?.findings)){
  const at=state.rule_reports.findIndex(r=>r.scope.table_id===result.scope.table_id&&r.scope.record_id===result.scope.record_id&&r.coverage.page===result.coverage.page);
  if(at>=0)state.rule_reports[at]=result;else if(state.rule_reports.length<4)state.rule_reports.push(result);
 }
 if(result?.visualization){const graph=result.visualization,at=state.visualizations.findIndex(g=>g.nodes?.[0]?.key===graph.nodes?.[0]?.key);if(at>=0)state.visualizations[at]=graph;else if(state.visualizations.length<4)state.visualizations.push(graph);}
}
export function missingReadEvidence(prompt:string,evidence:{mode:string;delivered?:boolean}[]){
 const conceptual=/\u4ec0\u4e48\u662f|\u539f\u7406|\u6982\u5ff5|\u65b9\u6cd5|\u6a21\u677f|what is|how to/i.test(prompt);if(conceptual)return '';
 if(needsClosureAnalysis(prompt)&&!evidence.some(e=>e.mode==='closure'&&e.delivered))return '本轮尚未取得真实业务闭环报告';
 if(needsBusinessRuleCheck(prompt)&&!evidence.some(e=>['check','closure'].includes(e.mode)&&e.delivered))return '\u672c\u8f6e\u5c1a\u672a\u53d6\u5f97\u53ef\u6838\u9a8c\u7684\u4e1a\u52a1\u89c4\u5219\u68c0\u67e5\u7ed3\u679c';
 if(needsProcurementImpact(prompt)&&!evidence.some(e=>['procurement_impact','closure'].includes(e.mode)&&e.delivered))return '\u672c\u8f6e\u5c1a\u672a\u53d6\u5f97\u91c7\u8d2d\u5b89\u88c5\u4ea4\u4ed8\u5f71\u54cd\u7684\u53ef\u6838\u9a8c\u8bd5\u7b97';
 if(!conceptual&&/\u6c47\u603b|\u5408\u8ba1|\u603b\u989d|\u603b\u6570|\u5e73\u5747|\u7edf\u8ba1|aggregate|\btotal\b/i.test(prompt)&&!evidence.some(e=>e.mode==='aggregate'&&e.delivered))return '\u672c\u8f6e\u5c1a\u672a\u53d6\u5f97\u6709\u6548\u6570\u636e\u7684\u7cbe\u786e\u6c47\u603b';
 if(!conceptual&&needsRelationDiagram(prompt)&&!evidence.some(e=>['related','procurement_impact','closure'].includes(e.mode)&&e.delivered))return '\u672c\u8f6e\u5c1a\u672a\u53d6\u5f97\u771f\u5b9e\u4e1a\u52a1\u5173\u8054\u4f9d\u636e';
 if(!conceptual&&/\u67e5\u8be2|\u67e5\u4e00\u4e0b|\u54ea\u4e9b|\u591a\u5c11|query/i.test(prompt)&&!evidence.some(e=>e.delivered&&['search','query','related','aggregate','plan','check','procurement_impact','closure'].includes(e.mode)))return '\u672c\u8f6e\u5c1a\u672a\u8bfb\u53d6\u53ef\u6838\u9a8c\u7684\u4e1a\u52a1\u6570\u636e';
 return '';
}
export function verifiedReadSummary(prompt:string,summaries:{mode:string;summary:string}[]){
 const modes=needsClosureAnalysis(prompt)?['closure']:needsBusinessRuleCheck(prompt)?['check']:needsProcurementImpact(prompt)?['procurement_impact']:[];
 return modes.length?([...new Set(summaries.filter(s=>modes.includes(s.mode)).map(s=>s.summary))].join('\n\n')||null):null;
}
export function addReadLabels(labels:Record<string,string>,data:any){
 for(const row of [...(data?.rows||[]),...(data?.nodes||[]),...(data?.entities||[])])if(typeof row.id==='string'&&(row.title||row.name))labels[row.id]=String(row.title||row.name);
 for(const row of data?.visualization?.nodes||[])if(row.record_id&&row.label)labels[row.record_id]=String(row.label);
}
