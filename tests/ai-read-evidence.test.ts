import {test} from 'node:test';import assert from 'node:assert/strict';
import {readCoverage,compactReadResult,addReadArtifact,missingReadEvidence,verifiedReadSummary} from '../shared/ai-read-evidence.ts';
test('business evidence distinguishes checks, aggregates and partial coverage',()=>{
 assert.match(readCoverage({coverage:{checked:2,matched:5,complete:false}}),/2\/5.*\u672a\u5b8c\u6574/);
 assert.match(readCoverage({coverage:{matched:10,shown:2,groups:4,groups_truncated:true}}),/10.*2.*4.*\u622a\u53d6/);
 assert.match(readCoverage({coverage:{nodes:3,edges:2,truncated:true}}),/3.*2.*\u622a\u53d6/);
});
test('required analyses cannot be fulfilled by a catalog or undelivered result',()=>{
 assert(missingReadEvidence('检查数据的一致性',[{mode:'catalog',delivered:true}]));assert(missingReadEvidence('检查数据的一致性',[{mode:'check',delivered:false}]));
 assert.equal(missingReadEvidence('检查数据的一致性',[{mode:'check',delivered:true}]),'');assert(missingReadEvidence('采购到货对交付延期的影响',[{mode:'related',delivered:true}]));assert.equal(missingReadEvidence('采购到货对交付延期的影响',[{mode:'procurement_impact',delivered:true}]),'');assert.equal(missingReadEvidence('写一份培训提纲',[]),'');
});
test('model receives compact findings while the UI retains genuine complete artifacts',()=>{
 const report={scope:{table_id:'t',record_id:'r'},coverage:{page:1},findings:Array.from({length:12},(_,i)=>({rule:i})),readable_summary:'summary'},compact=compactReadResult(report);assert.equal(compact.findings.length,8);assert.equal(report.findings.length,12);assert(compact.model_findings_truncated);
 const state={visualizations:[] as any[],rule_reports:[] as any[]};addReadArtifact(state,'check',report);addReadArtifact(state,'check',{...report,findings:[]});assert.equal(state.rule_reports.length,1);assert.equal(state.rule_reports[0].findings.length,0);
 addReadArtifact(state,'related',{visualization:{nodes:[{key:'root'}],edges:[]}});addReadArtifact(state,'related',{visualization:{nodes:[{key:'root'},{key:'child'}],edges:[]}});assert.equal(state.visualizations.length,1);assert.equal(state.visualizations[0].nodes.length,2);
});

test('verified analyses use business summaries rather than model claims',()=>{assert.equal(verifiedReadSummary('采购到货影响交付延期',[{mode:'procurement_impact',summary:'Verified 8 work hours'}]),'Verified 8 work hours');assert.equal(verifiedReadSummary('写培训提纲',[]),null)});
