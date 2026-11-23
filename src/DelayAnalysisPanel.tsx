import DelayEvidencePanel from './DelayEvidencePanel';
import {useState,useRef,useEffect} from 'react';import {api,useApi,useApp,ErrorBox,Loading} from './lib';import {translateUiValue as ui} from './i18n';
export default function DelayAnalysisPanel(){
 const {project,tick}=useApp();const [scope,setScope]=useState('published'),[baseline,setBaseline]=useState(''),[target,setTarget]=useState(''),[extra,setExtra]=useState('0'),[late,setLate]=useState('0'),[date,setDate]=useState(''),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const {data:plan,error:planError}=useApi(`/projects/${project.id}/plan?view=${scope==='preview'?'gantt':'delay'}`,tick),{data:catalog}=useApi<any[]>(`/projects/${project.id}/baselines/catalog`,tick);
 const serial=useRef(0);useEffect(()=>{serial.current++;setResult(null);setBusy(false)},[project.id,tick,plan]);
 async function analyze(whatIf:boolean,traceId?:string){const request=++serial.current;setBusy(true);setError('');try{const response=await api(`/projects/${project.id}/delay-analysis`,'POST',{scope,baseline_id:baseline||undefined,mode:whatIf?'what_if':'current',data_date:date||undefined,activity_id:whatIf?target||plan?.activities?.[0]?.id:undefined,additional_duration_hours:whatIf?Number(extra):0,start_delay_hours:whatIf?Number(late):0,trace_activity_id:traceId});if(serial.current===request)setResult(response);}catch(e){if(serial.current===request){setResult(null);setError((e as Error).message)}}finally{if(serial.current===request)setBusy(false)}}
 if(planError)return <ErrorBox message={planError}/>;if(!plan)return <Loading/>;
 return <section className="delay-analysis-panel"><h4>{ui('延误偏差与只读假设分析')}</h4><div className="gantt-settings-fields">
  <label>{ui('分析范围')}<select aria-label={ui('延误分析范围')} disabled={busy} value={scope} onChange={e=>{setScope(e.target.value);setTarget('');setResult(null)}}><option value="published">{ui('正式有效计划')}</option><option value="preview">{ui('授权草稿预排')}</option></select></label>
  <label>{ui('比较基线')}<select aria-label={ui('延误比较基线')} disabled={busy} value={baseline} onChange={e=>{setBaseline(e.target.value);setResult(null)}}><option value="">{ui('项目基线或最新基线')}</option>{catalog?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  <button disabled={busy} onClick={()=>void analyze(false)}>{ui('分析当前偏差')}</button>
 </div><p className="help">{ui('列出日期、工期、逻辑和约束差异线索，可并存；真实致因需结合施工记录核对。分析不会修改业务数据。')}</p>
 <div className="gantt-settings-fields">
  <label>{ui('假设作业')}<select aria-label={ui('假设作业')} disabled={busy} value={target||plan.activities[0]?.id||''} onChange={e=>{setTarget(e.target.value);setResult(null)}}>{plan.activities.filter((a:any)=>a.activity_type!=='LOE持续性作业').map((a:any)=><option value={a.id} key={a.id}>{a.code} · {a.name}</option>)}</select></label>
  <label>{ui('剩余工期增加（小时）')}<input aria-label={ui('剩余工期增加（小时）')} type="number" min="0" max="87600" step="1" disabled={busy} value={extra} onChange={e=>{if(/^\d*$/.test(e.target.value)){setExtra(e.target.value);setResult(null)}}}/></label>
  <label>{ui('剩余开始推迟（小时）')}<input aria-label={ui('剩余开始推迟（小时）')} type="number" min="0" max="87600" step="1" disabled={busy} value={late} onChange={e=>{if(/^\d*$/.test(e.target.value)){setLate(e.target.value);setResult(null)}}}/></label>
  <label>{ui('假设状态日期')}<input type="date" aria-label={ui('假设状态日期')} disabled={busy} value={date} onChange={e=>{setDate(e.target.value);setResult(null)}}/></label>
  <button className="primary" disabled={busy||!plan.activities.length} onClick={()=>void analyze(true)}>{ui('试算延误影响（不写入）')}</button>
 </div><p className="help">{ui('同一状态日期下比较两次剩余预测；未填写时沿用项目状态日期或今天。已完成作业不改写实际历史，强制日期可能抵消假设推迟。')}</p>
 {error&&<ErrorBox message={error}/>} {result&&<>
 <p role="status">{ui(result.scope==='preview'?'授权草稿预排':'正式有效计划')} · {ui('比较基线')}：{result.baseline_name||ui('未指定')}</p>
 {result.warnings.map((m:string)=><p className="help" key={m}>{ui(m)}</p>)}
 {result.scenario&&<><div className="performance-forecast"><strong>{ui('原预测完成')}：{result.scenario.before_finish}</strong><strong>{ui('假设后完成')}：{result.scenario.after_finish}</strong><span>{ui('项目延误（工作小时）')}：{result.scenario.project_delay_hours}</span><span>{ui('完工日期变化（自然日）')}：{result.scenario.calendar_delay_days}</span></div>
 <h4 className="section-heading plan-subtable-heading">{ui('受影响作业')}</h4><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['编码','作业名称','原预测完成','假设后完成','推迟（工作小时）','关键性变化'].map(t=><th key={t}>{ui(t)}</th>)}</tr></thead><tbody>{result.scenario.affected.map((a:any)=><tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{a.before_finish}</td><td>{a.after_finish}</td><td>{a.work_delay_hours}</td><td>{ui(a.critical_before?'是':'否')} → {ui(a.critical_after?'是':'否')}</td></tr>)}</tbody></table>{!result.scenario.affected.length&&<p>{ui('此假设未改变作业完成或关键性')}</p>}</div>
 {!!result.scenario.logic_violations.length&&<p className="help">{ui('假设后存在逻辑冲突，请在排程检查中核对强制日期和实际日期')}</p>}
 </>}
 <p className="help">{ui('分析时间')}：{result.analyzed_at?new Date(result.analyzed_at).toLocaleString():'—'}</p>
 <DelayEvidencePanel report={result.evidence} busy={busy} onTrace={id=>void analyze(false,id)}/>
 </>}
 </section>;
}
