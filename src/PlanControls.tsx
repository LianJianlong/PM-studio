import BaselineVersionsPanel from './BaselineVersionsPanel';
import ActualRemainingPanel from './ActualRemainingPanel';
import ReforecastReview from './ReforecastReview';
import ConstraintTrialPanel from './ConstraintTrialPanel';
import CpmPanel from './CpmPanel';
import DurationLinkPanel from './DurationLinkPanel';
import {planDurationLabels} from './plan-duration';
import DelayAnalysisPanel from './DelayAnalysisPanel';
import {durationText} from '../shared/duration-summary';
import ProgressControlPanel from './ProgressControlPanel';
import ActivitySteps from './ActivitySteps';
import {useState,useEffect} from 'react';
import {api,useApi,useApp,ErrorBox,Loading} from './lib';
import {inspectSchedule} from '../shared/plan-inspection';
import {translateUiValue as ui} from './i18n';
export default function PlanControls({data,editableSteps=false,standalone=false}:{data:any;editableSteps?:boolean;standalone?:boolean}){
 const {project,canLeave}=useApp(),[open,setOpen]=useState(false);
 if(standalone)return <section className="plan-controls plan-controls-standalone"><h3>{ui("排程设置与检查")}</h3><ControlBody key={project.id} data={data} editableSteps={editableSteps}/></section>;
 return <section className="plan-controls"><button type="button" onClick={async()=>{if(!open||await canLeave())setOpen(v=>!v)}} aria-expanded={open}>{ui('排程设置与检查')}</button>{open&&<ControlBody key={project.id} data={data} editableSteps={editableSteps}/>}</section>;
}
function ControlBody({data,editableSteps}:{data:any;editableSteps:boolean}){
 const {project,tick,notify}=useApp(),path=`/projects/${project.id}/schedule-options`;
 const {data:settings,error,refresh}=useApi(path,tick);
 const [local,setLocal]=useState<any>(null),[preview,setPreview]=useState<any>(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState('');
 const [ackReforecast,setAckReforecast]=useState(false);
 const [baselineOpen,setBaselineOpen]=useState(false);const options=local??settings?.options??{};
 useEffect(()=>{setPreview(null);setAckReforecast(false);setLocal(null)},[settings?.version]);
 useEffect(()=>{setPreview(null);setAckReforecast(false)},[data]);
 const changeOptions=(value:any)=>{setLocal(value);setPreview(null);setAckReforecast(false)};
 const needsReforecast=!!options.forecast_remaining&&(!settings?.options?.forecast_remaining||settings?.options?.data_date!==options.data_date);
 const cannotSaveReforecast=needsReforecast&&(!preview?.reforecast_source_hash||!preview?.progress_quality||!preview?.previewed_at||preview?.progress_quality?.blocking_count>0||preview?.progress_quality?.warning_count>0&&!ackReforecast);
 const check=data?inspectSchedule(data):null;
 async function submit(save:boolean){setBusy(true);setFailure('');try{
  const body={...options,data_date:options.data_date||undefined,must_finish_by:options.must_finish_by||undefined,baseline_id:options.baseline_id||undefined,path_end_id:options.path_end_id||undefined};
  if(save){await api(path,'PUT',{options:body,version:settings.version,...(needsReforecast?{source_hash:preview?.reforecast_source_hash,previewed_at:preview?.previewed_at,confirm_reforecast:true,accept_warnings:ackReforecast}:{})});await refresh();setLocal(null);setPreview(null);notify(ui('排程设置已保存'));}
  else {setAckReforecast(false);setPreview(await api(`/projects/${project.id}/schedule-preview`,'POST',body));}
 }catch(e){setFailure((e as Error).message);setPreview(null);setAckReforecast(false)}finally{setBusy(false)}}
 return <div className="plan-control-body">
 {error&&<ErrorBox message={error}/>} {!settings&&!error&&<Loading/>}
 {settings&&<><div className="gantt-settings-fields">
  <label>{ui('项目基线')}<select aria-label={ui('项目基线')} disabled={busy||!settings.can_edit} value={options.baseline_id||''} onChange={e=>changeOptions({...options,baseline_id:e.target.value})}><option value="">{ui('未指定')}</option>{settings.baselines?.map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
  {[0,1,2].map((slot)=><label key={slot}>{ui(['主比较基线','次比较基线','第三比较基线'][slot])}<select aria-label={ui(['主比较基线','次比较基线','第三比较基线'][slot])} disabled={busy||!settings.can_edit} value={options.comparison_baseline_ids?.[slot]||''} onChange={e=>{const ids=[...(options.comparison_baseline_ids||[null,null,null])];ids[slot]=e.target.value||null;changeOptions({...options,comparison_baseline_ids:ids})}}><option value="">{ui('未指定')}</option>{settings.baselines?.map((b:any)=><option key={b.id} value={b.id} disabled={(options.comparison_baseline_ids||[]).some((key:string|null,i:number)=>i!==slot&&key===b.id)}>{b.name}</option>)}</select></label>)}
  <label>{ui('项目状态日期')}<input type="date" aria-label={ui('项目状态日期')} disabled={busy||!settings.can_edit} value={options.data_date||''} onChange={e=>changeOptions({...options,data_date:e.target.value})}/></label>
  <label className="checkbox-label"><input type="checkbox" disabled={busy||!settings.can_edit} checked={!!options.forecast_remaining} onChange={e=>changeOptions({...options,forecast_remaining:e.target.checked})}/>{ui('按剩余工期重排（保留逻辑）')}</label>
  <label>{ui('要求完工日期')}<input type="date" aria-label={ui('要求完工日期')} disabled={busy||!settings.can_edit} value={options.must_finish_by||''} onChange={e=>changeOptions({...options,must_finish_by:e.target.value})}/></label>
  <label>{ui('关键路线判定')}<select aria-label={ui('关键路线判定')} disabled={busy||!settings.can_edit} value={options.critical_method||'float'} onChange={e=>changeOptions({...options,critical_method:e.target.value})}><option value="float">{ui('总浮时阈值')}</option><option value="longest">{ui('最长路径')}</option></select></label>
  <label>{ui('关键浮时阈值（小时）')}<input aria-label={ui('关键浮时阈值（小时）')} type="number" min="0" max={3650*(data?.calendar_config?.hours_per_day||8)} step="1" disabled={busy||!settings.can_edit} value={(options.critical_threshold??0)*(data?.calendar_config?.hours_per_day||8)} onChange={e=>changeOptions({...options,critical_threshold:Number(e.target.value)/(data?.calendar_config?.hours_per_day||8)})}/></label>
  <label>{ui('近关键总浮时上限（小时）')}<input aria-label={ui('近关键总浮时上限（小时）')} type="number" min="0" max="87600" step="1" disabled={busy||!settings.can_edit} value={options.near_critical_hours??16} onChange={e=>changeOptions({...options,near_critical_hours:Number(e.target.value)})}/></label>
  <label>{ui('浮时路径数量')}<input aria-label={ui('浮时路径数量')} type="number" min="1" max="20" step="1" disabled={busy||!settings.can_edit} value={options.path_count??5} onChange={e=>changeOptions({...options,path_count:Number(e.target.value)})}/></label>
  <label>{ui('路径终点')}<select aria-label={ui('路径终点')} disabled={busy||!settings.can_edit} value={options.path_end_id||''} onChange={e=>changeOptions({...options,path_end_id:e.target.value})}><option value="">{ui('项目完工及各终点')}</option>{data?.activities.filter((a:any)=>a.activity_type!=='LOE持续性作业').map((a:any)=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
  <button disabled={busy} onClick={()=>void submit(false)}>{ui('试算（不保存）')}</button>{settings.can_edit&&<button className="primary" disabled={busy||cannotSaveReforecast} onClick={()=>void submit(true)}>{ui('保存排程设置')}</button>}
 </div><p className="help">{ui('默认维持原计划。启用剩余工期重排后，未完工作移至状态日期之后；保留实际日期和前置逻辑。要求完工日期影响晚日期及浮时，不强行缩短工期。')}</p></>}
 {failure&&<ErrorBox message={failure}/>} {preview&&<p role="status">{ui('试算总工期')}：{planDurationLabels({...preview,calendar_config:data?.calendar_config}).both} · {ui('关键作业')}：{preview.inspection.critical} · {ui('负浮时作业')}：{preview.inspection.negative} · {ui('试算不包含草稿')}</p>}
 <p className="help">{ui('项目基线用于项目进度与默认挣值口径；主次比较基线仅用于版本对照。选择后点击保存排程设置，适用于当前项目全部用户。')}</p>
 <p className="help">{ui('红色为所选口径的关键作业；橙色为非关键且总浮时大于0、不超过近关键上限的未完成作业，设0关闭。负浮时独立预警。两种口径同时计算，阈值使用整数工作小时。')}</p>
 {needsReforecast&&<p className="help">{ui('启用或更改状态日期重排须先试算；阻断项需修正，警告需确认。试算10分钟有效，保存仅更新排程设置，不改实际历史。')}</p>}
 {needsReforecast&&preview?.progress_quality?.warning_count>0&&!preview?.progress_quality?.blocking_count&&<label className="checkbox-label"><input type="checkbox" checked={ackReforecast} onChange={e=>setAckReforecast(e.target.checked)}/>{ui('已核对状态日期、排除的数据及重排警告，确认采用本次试算')}</label>}
 <details open={!!preview}><summary>{ui('状态日期检查与重排预览')}</summary><ReforecastReview data={preview||data} preview={!!preview}/></details>
 <details><summary>{ui('实际与剩余：资源实绩与预测')}</summary><ActualRemainingPanel/></details>
 <details><summary>{ui('日期约束冲突诊断与试算')}</summary><ConstraintTrialPanel/></details>
 <details><summary>{ui('CPM排程明细与驱动分析')}</summary><CpmPanel data={data} preview={preview}/></details>
 <details><summary>{ui('LOE持续性作业')}</summary><p className="help">{ui('在作业表点击新增LOE，填写名称并在LOE关联作业中选择覆盖的普通作业。起止、工期和剩余工期自动计算；LOE不使用手工日期约束，不驱动施工关键路线。实际日期及实际费用仍以录入为准。')}</p><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['作业编码','作业名称','关联作业数','工作工期','完成率（%）'].map(t=><th key={t}>{ui(t)}</th>)}</tr></thead><tbody>{data?.activities.filter((a:any)=>a.activity_type==='LOE持续性作业').map((a:any)=><tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{a.loe_scope?.length||0}</td><td>{ui(durationText(a.duration,data.calendar_config?.hours_per_day||8))}</td><td>{a.progress}</td></tr>)}</tbody></table></div></details>
 <details><summary>{ui('作业类型与工期资源联动')}</summary><DurationLinkPanel/></details>
 {editableSteps&&<details><summary>{ui('作业步骤与加权进度')}</summary><ActivitySteps/></details>}
 <details><summary>{ui('进度控制：多基线、期间绩效与预测')}</summary><ProgressControlPanel/></details>
 <details><summary>{ui('多条浮时路径')}</summary><p className="help">{ui('按关系余量排序的驱动链和次关键候选；路径排名不替代总浮时或最长路径的关键性判定。')}</p><h4 className="section-heading plan-subtable-heading">{ui('路径明细')}</h4><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['路径','作业顺序','关系余量','最小总浮时'].map(t=><th key={t}>{ui(t)}</th>)}</tr></thead><tbody>{data?.critical_paths?.map((path:any)=><tr key={path.rank}><td>{path.rank}</td><td>{path.codes.join(' → ')}</td><td>{ui(durationText(path.gap_work_days,data.calendar_config?.hours_per_day||8))}</td><td>{path.total_float< -1e-7?'-':''}{ui(durationText(Math.abs(path.total_float),data.calendar_config?.hours_per_day||8))}</td></tr>)}</tbody></table></div></details>
 <details><summary>{ui('延误分析与假设试算')}</summary><DelayAnalysisPanel/></details>
 {check&&<details><summary>{ui(data.preview?'预排检查（含授权草稿）':'正式计划检查')} · {check.count} {ui('项作业')} · {check.critical} {ui('项关键作业')} · {check.negative} {ui('项负浮时')}</summary><h4 className="section-heading plan-subtable-heading">{ui("计划检查与比较")}</h4><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr><th>{ui('作业编码')}</th><th>{ui('作业名称')}</th><th>{ui('级别')}</th><th>{ui('检查结果')}</th></tr></thead><tbody>{check.items.map((v,i)=><tr key={i}><td>{v.code}</td><td>{v.name}</td><td>{ui(v.severity)}</td><td>{ui(v.message)}</td></tr>)}</tbody></table>{!check.items.length&&<p>{ui('未发现检查项')}</p>}</div></details>}
 <details onToggle={e=>setBaselineOpen(e.currentTarget.open)}><summary>{ui('基线管理与多版本对照')}</summary>{baselineOpen&&<BaselineVersionsPanel/>}</details>
 </div>;
}
