import EarnedValueReview from './EarnedValueReview';
import {useEffect,useState} from 'react';import {api,useApi,useApp,useRememberedState,ErrorBox,Loading} from './lib';
import {periodBounds} from '../shared/period-bounds';import {translateUiValue as ui,interfaceLocale} from './i18n';
const fields=[['bac','基线总预算 BAC'],['pv','计划价值 PV'],['ev','挣值 EV'],['ac','实际费用 AC'],['cv','成本偏差 CV'],['sv','进度偏差 SV'],['cpi','成本绩效指数 CPI'],['spi','进度绩效指数 SPI'],['eac','预计完工费用 EAC'],['etc','尚需费用 ETC'],['vac','完工偏差 VAC'],['tcpi','尚需绩效 TCPI（BAC目标）'],['tcpi_eac','尚需绩效 TCPI（EAC目标）']];
export default function ProgressControlPanel(){
 const {project,boot,tick,notify}=useApp();const [choice,setChoice]=useRememberedState(`progress-control:${boot.user.id}:${project.id}`,{baseline_id:'',data_date:'',budget_basis:'baseline',eac_method:'cpi'});
 const [page,setPage]=useState(1),[reviewOpen,setReviewOpen]=useState(false);
 const query=new URLSearchParams({budget_basis:choice.budget_basis,eac_method:choice.eac_method,period_page:String(page)});if(choice.baseline_id)query.set('baseline_id',choice.baseline_id);if(choice.data_date)query.set('data_date',choice.data_date);
 const url=`/projects/${project.id}/progress-control?${query}`;
 const {data,error,refresh}=useApi(url,tick);
 const [series,setSeries]=useState('monthly'),[periodName,setPeriodName]=useState(''),[from,setFrom]=useState(''),[until,setUntil]=useState(''),[preview,setPreview]=useState<any>(null),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[history,setHistory]=useState<any>(null);
 useEffect(()=>{const changed=(event:Event)=>{const path=(event as CustomEvent).detail?.url||'';if(!path.endsWith('/preview')&&(/^\/(records|tables|activities|activity-resources)\//.test(path)||path.startsWith(`/projects/${project.id}/`)))void refresh().catch(()=>{});};window.addEventListener('studio-data-changed',changed);return()=>window.removeEventListener('studio-data-changed',changed)},[refresh,project.id]);
 useEffect(()=>{setPreview(null);setConfirmed(false)},[data?.source_hash]);
 if(error)return <><ErrorBox message={error}/><button onClick={()=>{setChoice({baseline_id:'',data_date:'',budget_basis:'current',eac_method:'cpi'});setPage(1);setPreview(null);setHistory(null)}}>{ui('重置分析选项')}</button></>;if(!data)return <Loading/>;
 const bounds=periodBounds(data.data_date,series),start=from||bounds.start,end=until||bounds.end;
 const selected=history?.payload||data;
 function change(key:string,value:string){setHistory(null);setChoice({...choice,[key]:value});setPreview(null);setConfirmed(false)}
 const request={...choice,baseline_id:choice.baseline_id||data.baseline_id||undefined,data_date:data.data_date,name:periodName||`${data.data_date.slice(0,7)} ${ui('期间绩效')}`,series,period_start:start,period_end:end};
 const latest=data.periods;
 async function trial(){setHistory(null);setBusy(true);setFailure('');setConfirmed(false);try{setPreview({request,result:await api(`/projects/${project.id}/progress-periods/preview`,'POST',request)})}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}}
 async function capture(){if(!preview||!confirmed)return;setBusy(true);setFailure('');try{await api(`/projects/${project.id}/progress-periods`,'POST',{...preview.request,source_hash:preview.result.source_hash,expected_revision:preview.result.expected_revision,confirm_current_data:true});setPreview(null);setConfirmed(false);setPage(1);await refresh();notify(ui('期间绩效已封存，原始版本保留'));}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}}
 const exportPeriods=()=>{const headers=['名称','周期','开始','结束','统计日期','版本','预算口径','PV','EV','AC','期间PV','期间EV','期间AC','封存时间'];const rows=latest.map((r:any)=>[r.name,r.series,r.period_start,r.period_end,r.data_date,r.revision,r.payload.budget_basis,r.payload.financial.pv,r.payload.financial.ev,r.payload.financial.ac,r.payload.period_values?.pv,r.payload.period_values?.ev,r.payload.period_values?.ac,r.captured_at]);const cell=(v:any)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const link=document.createElement('a'),blob=URL.createObjectURL(new Blob(['\uFEFF'+[headers.map(ui),...rows].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));link.href=blob;link.download='period-performance.csv';link.click();URL.revokeObjectURL(blob);};
 return <section className="progress-control-panel">
 <h4>{ui('多基线绩效与预测完工')} · {selected.currency}</h4>
 <div className="gantt-settings-fields">
  <label>{ui('分析基线')}<select aria-label={ui('分析基线')} value={choice.baseline_id} onChange={e=>change('baseline_id',e.target.value)}><option value="">{ui('项目基线或最新基线')}</option>{data.baselines.map((b:any)=><option key={b.id} value={b.id}>{b.name}{b.budget_available?'':' · '+ui('无成本快照')}</option>)}</select></label>
  <label>{ui('分析统计日期')}<input type="date" aria-label={ui('分析统计日期')} value={data.data_date} onChange={e=>{if(e.target.value)change('data_date',e.target.value)}}/></label>
  <label>{ui('预算口径')}<select aria-label={ui('预算口径')} value={choice.budget_basis} onChange={e=>change('budget_basis',e.target.value)}><option value="baseline">{ui('批准基线预算')}</option><option value="current">{ui('当前预算参考（非基线）')}</option></select></label>
  <label>{ui('完工费用预测方法')}<select aria-label={ui('完工费用预测方法')} value={choice.eac_method} onChange={e=>change('eac_method',e.target.value)}><option value="cpi">{ui('按成本绩效 CPI')}</option><option value="remaining_budget">{ui('实际费用加剩余预算')}</option><option value="cpi_spi">{ui('按成本与进度绩效 CPI×SPI')}</option></select></label>
 </div>
 <p className="help">{ui('PV按基线工作时段分摊，EV按同一预算乘有效完成率，AC仅取实际录入；预测不会改写计划、实际费用或基线。')}</p>
 {selected.warnings.map((warning:string)=><p className="help" key={warning}>{ui(warning)}</p>)}
 {history&&<div className="row-actions"><strong>{ui('查看封存版本')}：{history.name} · V{history.revision}</strong><button onClick={()=>setHistory(null)}>{ui('返回当前预测')}</button></div>}
 <div className="performance-metrics">{fields.map(([key,label])=><div key={key}><span>{ui(label)}</span><strong data-performance-metric={key}>{selected.financial[key]??'—'}</strong></div>)}</div>
 <div className="performance-forecast"><strong>{ui('预计完成日期')}：<span data-forecast-finish>{selected.forecast.finish||'—'}</span></strong><span>{ui('基线完成日期')}：{selected.forecast.baseline_finish||'—'}</span><span>{ui('预计完成偏差（日）')}：{selected.forecast.variance_days??'—'}</span><span>{ui('剩余工作量（作业小时）')}：{selected.forecast.remaining_work_hours}</span></div>
 {selected.resource_forecast&&<p className='help'>{ui('剩余资源预测费用')}：{selected.resource_forecast.remaining_cost} · {ui('实际加剩余预测费用')}：{selected.resource_forecast.forecast_total_cost} · {ui('独立资源预测口径，不替代基线挣值或绩效公式EAC')}</p>}
 <p className="help">{ui('完工日期由状态日期、剩余工期、实际日期和保留逻辑重排预测；不使用SPI简单缩放日期。空白指数表示分母为零或基础数据不足。')}</p>
 <details open={reviewOpen} onToggle={e=>setReviewOpen(e.currentTarget.open)}><summary>{ui('挣值口径与预测校验')}</summary><EarnedValueReview data={selected}/></details>
 <details><summary>{ui('预测作业明细')}</summary><h4 className="section-heading plan-subtable-heading">{ui('预测作业明细')}</h4><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['编码','作业名称','完成率（%）','剩余工时','预测完成','关键作业'].map(n=><th key={n}>{ui(n)}</th>)}</tr></thead><tbody>{selected.forecast.activities.map((a:any)=><tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{a.progress}%</td><td>{a.remaining_hours}</td><td>{a.finish}</td><td>{ui(a.critical?'是':'否')}</td></tr>)}</tbody></table></div></details>
 <details><summary>{ui('期间绩效封存与历史')}</summary>
 <p className="help">{ui('封存当前有效数据，并记录声明统计日期与实际封存时间；不会回溯编造历史。更正会新增版本，原版本不可改写。资源超载仅提示，不自动调平。')}</p>
 <div className="gantt-settings-fields">
  <label>{ui('期间名称')}<input aria-label={ui('期间名称')} value={periodName} placeholder={request.name} onChange={e=>{setPeriodName(e.target.value);setPreview(null)}}/></label>
  <label>{ui('期间周期')}<select aria-label={ui('期间周期')} value={series} onChange={e=>{setSeries(e.target.value);setFrom('');setUntil('');setPreview(null)}}><option value="monthly">{ui('月')}</option><option value="weekly">{ui('周')}</option><option value="custom">{ui('自定义')}</option></select></label>
  <label>{ui('期间开始')}<input type="date" aria-label={ui('期间开始')} value={start} onChange={e=>{setFrom(e.target.value);setPreview(null)}}/></label>
  <label>{ui('期间结束')}<input type="date" aria-label={ui('期间结束')} value={end} onChange={e=>{setUntil(e.target.value);setPreview(null)}}/></label>
  <button disabled={busy} onClick={()=>void trial()}>{ui('预览期间封存')}</button>
 </div>
 {failure&&<ErrorBox message={failure}/>}
 {preview&&<div className="period-capture-preview"><strong>{ui('待封存版本')} V{preview.result.expected_revision+1}</strong><p>{preview.request.period_start} — {preview.request.period_end} · {ui('统计日期')} {preview.request.data_date} · {ui('预算口径')} {ui(preview.result.payload.budget_basis==='baseline'?'批准基线预算':'当前预算参考（非基线）')}</p><p>PV {preview.result.payload.financial.pv??'—'} · EV {preview.result.payload.financial.ev??'—'} · AC {preview.result.payload.financial.ac}</p>{preview.result.payload.warnings.map((message:string)=><p className="help" key={message}>{ui(message)}</p>)}<p>{ui('期间增量')}：PV {preview.result.payload.period_values.pv??'—'} · EV {preview.result.payload.period_values.ev??'—'} · AC {preview.result.payload.period_values.ac??'—'}</p>{preview.result.expected_revision>0&&<p className="help">{ui('将新增更正版本，保留原版本；后续期间不会被自动改写。')}</p>}<label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{ui('确认当前有效数据对应声明统计日期')}</label><button className="primary" disabled={busy||!confirmed||!preview.result.payload.can_capture} onClick={()=>void capture()}>{ui('确认封存')}</button>{!preview.result.payload.can_capture&&<p className="help">{ui('当前权限或基线数据不满足封存要求')}</p>}</div>}
 <h4 className="section-heading plan-subtable-heading">{ui('期间封存记录')} <button onClick={exportPeriods}>{ui('导出本页期间绩效CSV')}</button></h4>
 <div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['名称','周期','期间开始','期间结束','统计日期','版本','期间PV','期间EV','期间AC','封存人','封存时间','操作'].map(n=><th key={n}>{ui(n)}</th>)}</tr></thead><tbody>{data.periods.map((r:any)=><tr key={r.id}><td>{r.name}</td><td>{ui(r.series==='monthly'?'月':r.series==='weekly'?'周':'自定义')}</td><td>{r.period_start}</td><td>{r.period_end}</td><td>{r.data_date}</td><td>V{r.revision}</td><td>{r.payload.period_values?.pv??'—'}</td><td>{r.payload.period_values?.ev??'—'}</td><td>{r.payload.period_values?.ac??'—'}</td><td>{r.created_by_name}</td><td>{new Date(r.captured_at).toLocaleString(interfaceLocale(),{timeZone:'Europe/Helsinki'})}</td><td><button onClick={()=>setHistory(r)}>{ui('查看封存版本')}</button></td></tr>)}</tbody></table>{!data.periods.length&&<p className="help">{ui('尚无封存期间')}</p>}</div>
 <div className="row-actions"><span>{ui('封存版本总数')}：{data.period_total}</span><button disabled={page<=1} onClick={()=>setPage(v=>v-1)}>{ui('上一页')}</button><span>{page}</span><button disabled={page*100>=data.period_total} onClick={()=>setPage(v=>v+1)}>{ui('下一页')}</button></div>
 </details>
 </section>;
}
