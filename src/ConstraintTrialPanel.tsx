import {useEffect,useState} from 'react';import {api,useApi,useApp,ErrorBox,Loading} from './lib';
import {constraintTypes} from '../shared/constraint-diagnostics';import {translateUiValue as ui} from './i18n';
export default function ConstraintTrialPanel(){
 const {project,tick,reload}=useApp(),base=`/projects/${project.id}/constraint-trial`,{data,error,refresh}=useApi(base,tick);
 const [page,setPage]=useState(1),[diagPage,setDiagPage]=useState(1);
 const [activity,setActivity]=useState(''),[type,setType]=useState('尽早开始'),[date,setDate]=useState(''),[preview,setPreview]=useState<any>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[message,setMessage]=useState('');
 const rows=data?.activities||[],selected=rows.find((a:any)=>a.id===activity)||rows[0];
 useEffect(()=>{if(selected){setType(selected.constraint_type);setDate(selected.constraint_date)}setPreview(null);setAck(false)},[selected?.id,data]);
 function change(action:()=>void){action();setPreview(null);setAck(false);setMessage('')}
 useEffect(()=>{setPage(1);setDiagPage(1)},[preview]);
 const body={activity_id:selected?.id,constraint_type:type,constraint_date:type==='尽早开始'?undefined:date||undefined};
 async function trial(){setBusy(true);setFailure('');setPreview(null);setAck(false);try{setPreview(await api(base+'/preview','POST',body))}catch(e){setFailure((e as Error).message)}finally{setBusy(false)}}
 async function apply(){if(!preview)return;setBusy(true);setFailure('');try{await api(base+'/apply','POST',{...body,source_hash:preview.source_hash,issued_at:preview.issued_at,confirm:true,accept_conflicts:ack});setPreview(null);setMessage(ui('约束已写入草稿，主管确认有效后参与正式计算'));await refresh();reload()}catch(e){setFailure((e as Error).message);setPreview(null);setAck(false)}finally{setBusy(false)}}
 if(error)return <ErrorBox message={error}/>;if(!data)return <Loading/>;
 return <div className="constraint-trial-panel">
 <p className="help">{ui('授权预排试算，包含当前可见草稿；保留项目当前排程设置。实际日期、原工期、实际费用和批准基线不被改写。先试算，最后确认才写入所选作业约束。')}</p>
 <div className="gantt-settings-fields"><label>{ui('约束试算作业')}<select aria-label={ui('约束试算作业')} disabled={busy} value={selected?.id||''} onChange={e=>change(()=>setActivity(e.target.value))}>{rows.map((a:any)=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label><label>{ui('试算约束类型')}<select aria-label={ui('试算约束类型')} disabled={busy} value={type} onChange={e=>change(()=>setType(e.target.value))}>{constraintTypes.map(t=><option key={t} value={t}>{ui(t)}</option>)}</select></label>{type!=='尽早开始'&&<label>{ui('试算约束日期')}<input type="date" aria-label={ui('试算约束日期')} disabled={busy} value={date} onChange={e=>change(()=>setDate(e.target.value))}/></label>}<button disabled={busy||!selected||type!=='尽早开始'&&!date} onClick={()=>void trial()}>{ui('试算日期约束')}</button></div>
 {failure&&<ErrorBox message={failure}/>} {message&&<p role="status">{message}</p>}
 {preview&&<><p role="status">{ui('项目完成日期')}：{preview.before_finish} → {preview.after_finish} · {ui('变化及所选作业')}：{preview.changes.length} · {ui(preview.forecast_remaining?'按剩余工期重排':'原计划口径')}</p>
 <p className="help">{ui('软约束保留网络逻辑，可能产生负浮时；强制约束可能破坏逻辑。与实际历史冲突、非工作日或无法容纳剩余工期的强制约束禁止在此写入。')}</p>
 {!!preview.warnings.length&&<ul>{preview.warnings.map((w:string)=><li key={w}>{ui(w)}</li>)}</ul>}
 <h4 className="section-heading plan-subtable-heading">{ui('约束传播影响')}</h4><div className="plan-inspection-scroll grid-scroll"><table className="data-grid" aria-label={ui('约束传播影响')}><thead><tr>{['作业编码','作业名称','原开始','试算开始','原完成','试算完成','原总浮时（小时）','试算总浮时（小时）'].map(t=><th key={t}>{ui(t)}</th>)}</tr></thead><tbody>{preview.changes.slice((page-1)*100,page*100).map((r:any)=><tr key={r.id}>{[r.code,r.name,r.before_start,r.after_start,r.before_finish,r.after_finish,r.before_float_hours,r.after_float_hours].map((v:any,i:number)=><td key={i}>{v}</td>)}</tr>)}</tbody></table></div>
 <div className="gantt-settings-fields"><span>{page} / {Math.max(1,Math.ceil(preview.changes.length/100))}</span><button disabled={page<=1} onClick={()=>setPage(page-1)}>{ui('上一页')}</button><button disabled={page*100>=preview.changes.length} onClick={()=>setPage(page+1)}>{ui('下一页')}</button></div>
 <details><summary>{ui('试算后约束诊断')}</summary><h4 className="section-heading plan-subtable-heading">{ui('诊断')}</h4><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['作业编码','约束类型','约束日期','诊断'].map(t=><th key={t}>{ui(t)}</th>)}</tr></thead><tbody>{preview.after_diagnostics.slice((diagPage-1)*100,diagPage*100).map((r:any)=><tr key={r.id}><td>{r.code}</td><td>{ui(r.type)}</td><td>{r.date}</td><td>{r.messages.length?r.messages.map(ui).join('；'):ui('约束满足')}</td></tr>)}</tbody></table></div><div className="gantt-settings-fields"><span>{diagPage} / {Math.max(1,Math.ceil(preview.after_diagnostics.length/100))}</span><button disabled={diagPage<=1} onClick={()=>setDiagPage(diagPage-1)}>{ui('上一页')}</button><button disabled={diagPage*100>=preview.after_diagnostics.length} onClick={()=>setDiagPage(diagPage+1)}>{ui('下一页')}</button></div></details>
 {preview.blocked?<p className="error-box">{ui('此强制约束不可应用，请先解决诊断中的阻断项')}</p>:preview.can_apply?<><label className="checkbox-label">{preview.needs_ack&&<><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>{ui('我已了解以上约束冲突，仍采用本次设置')}</>}</label><button className="primary" disabled={busy||preview.needs_ack&&!ack} onClick={()=>void apply()}>{ui('确认写入日期约束')}</button></>:<p className="help">{ui('当前权限或记录状态仅允许试算')}</p>}
 </>}
 {!rows.length&&<p>{ui('当前没有可试算约束的普通作业')}</p>}
 </div>;
}
