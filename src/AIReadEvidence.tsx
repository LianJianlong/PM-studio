import AIClosureReport from './AIClosureReport';
import AIImpactPath from './AIImpactPath';
import {BusinessCheckReport} from './AIBusinessChecks';
import {translateUiValue as ui} from './i18n';
const modes:Record<string,string>={closure:'业务闭环分析',catalog:'\u4e1a\u52a1\u5bf9\u8c61\u76ee\u5f55',query:'\u6570\u636e\u67e5\u8be2',search:'\u6570\u636e\u67e5\u8be2',aggregate:'\u6709\u6548\u6570\u636e\u7edf\u8ba1',plan:'\u8ba1\u5212\u6570\u636e',related:'\u5173\u8054\u8ffd\u8e2a',check:'\u4e1a\u52a1\u89c4\u5219\u68c0\u67e5',procurement_impact:'\u91c7\u8d2d\u5b89\u88c5\u4ea4\u4ed8\u8bd5\u7b97'};
export default function AIReadEvidence({result,project}:{result:any;project:string}){
 const evidence=(result.evidence||[]).filter((e:any)=>e.tool!=='document_web_search');
 return <div className="ai-shared-evidence">
 {result.closure_reports?.map((report:any,i:number)=><AIClosureReport key={i} report={report} project={project}/>)}
 {evidence.length>0&&<details><summary>{ui('\u4e1a\u52a1\u4f9d\u636e\u4e0e\u8bfb\u53d6\u8303\u56f4')} · {evidence.length}</summary><ul>{evidence.map((e:any,i:number)=><li key={i}>{ui(e.source)} · {ui(modes[e.mode]||'\u6570\u636e\u67e5\u8be2')}{e.coverage?' · '+ui(e.coverage):''}{e.delivered===false?' · '+ui('\u7ed3\u679c\u8fc7\u5927\uff0c\u672a\u4ea4\u7ed9\u6a21\u578b'):''}</li>)}</ul></details>}
 {result.rule_reports?.map((report:any,i:number)=><BusinessCheckReport key={i} report={report}/>)}
 {result.visualizations?.map((graph:any,i:number)=><AIImpactPath key={i} graph={graph} project={project}/>)}
 </div>;
}
