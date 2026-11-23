import {useState,useEffect,useRef} from 'react';import {api,useApp,Modal,Field,ErrorBox,Loading} from './lib';
import {codeRule,activityCode,type ActivityCodeRule} from '../shared/activity-codes';import {translateUiValue as ui} from './i18n';
type Row={id:string;version:number;data:any};
export default function ActivityCodeTools({rows,selected,disabled,onSaved}:{rows:Row[];selected:string[];disabled?:boolean;onSaved:()=>void}){
 const {project,notify}=useApp(),path=`/projects/${project.id}/activity-codes`;
 const [open,setOpen]=useState(false),[settings,setSettings]=useState<any>(null),[rule,setRule]=useState<ActivityCodeRule>(codeRule(null)),[preview,setPreview]=useState<any>(null),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false);const form=useRef<HTMLFormElement>(null);
 const targets=selected.length?rows.filter(r=>selected.includes(r.id)):rows;
 const orderKey=JSON.stringify(targets.map(r=>[r.id,r.version]));useEffect(()=>setPreview(null),[orderKey]);
 function change<K extends keyof ActivityCodeRule>(key:K,value:ActivityCodeRule[K]){setRule(r=>({...r,[key]:value}));setPreview(null);setFailure('')}
 async function load(){setOpen(true);setSettings(null);setPreview(null);setFailure('');try{const r=await api(path);setSettings(r);setRule(r.rule)}catch(e){setFailure((e as Error).message)}}
 async function act(kind:'rule'|'preview'|'apply'){
  if(!form.current?.reportValidity())return;setBusy(true);setFailure('');
  try{
   if(kind==='rule'){await api(path,'PUT',{version:settings.version,rule});setSettings(await api(path));notify(ui('作业编码规则已保存，已有编码不变'));setPreview(null)}
   else {const body={rule,records:targets.map(r=>({id:r.id,version:r.version})),...(kind==='apply'?{confirm:true,source_hash:preview.source_hash}:{})};const r=await api(path+'/'+kind,'POST',body);if(kind==='preview')setPreview(r);else{setOpen(false);onSaved();notify(ui('作业已重新编号，变更记录需主管确认有效'))}}
  }catch(e){setFailure((e as Error).message)}finally{setBusy(false)}
 }
 let sample='';try{sample=activityCode(rule,BigInt(rule.code_start))}catch{}
 return <><button type="button" disabled={disabled} onClick={()=>void load()}>{ui('作业编码')}</button>{open&&<Modal wide title={ui('作业编码与批量编号')} onClose={()=>{if(!busy)setOpen(false)}}>
 {failure&&<ErrorBox message={failure}/>} {!settings&&!failure&&<Loading/>}{settings&&<form className='activity-code-form' ref={form} onSubmit={e=>{e.preventDefault();void act('preview')}}>
 <div className="form-grid"><label className="checkbox-label"><input type="checkbox" checked={rule.auto_code} disabled={busy} onChange={e=>change('auto_code',e.target.checked)}/>{ui('新建作业自动编码')}</label>
 <Field label={ui('编码前缀')}><input aria-label={ui('作业编码前缀')} maxLength={20} pattern="[A-Za-z0-9._-]*" value={rule.code_prefix} disabled={busy} onChange={e=>change('code_prefix',e.target.value)}/></Field>
 <Field label={ui('起始数字')}><input aria-label={ui('作业编码起始数字')} required inputMode="numeric" pattern="[1-9][0-9]{0,11}" value={rule.code_start} disabled={busy} onChange={e=>change('code_start',e.target.value)}/></Field>
 <Field label={ui('自增间隔')}><input aria-label={ui('作业编码自增间隔')} required inputMode="numeric" pattern="[1-9][0-9]{0,6}" value={rule.code_step} disabled={busy} onChange={e=>change('code_step',e.target.value)}/></Field>
 <Field label={ui('数字最少位数')}><input aria-label={ui('作业编码数字位数')} type="number" min="1" max="12" required value={rule.code_width} disabled={busy} onChange={e=>change('code_width',Number(e.target.value))}/></Field>
 <label className="checkbox-label"><input type="checkbox" checked={rule.code_fill_gaps} disabled={busy} onChange={e=>change('code_fill_gaps',e.target.checked)}/>{ui('新建作业优先填补空号')}</label></div>
 <p className="help">{ui('编号形式示例')}：<strong>{sample||'—'}</strong>。{ui('自动编码只影响以后新建的作业；手工自定义编码仍可使用。各项目独立计数。')}</p>
 <p className="help">{ui('当前已保存规则下的后续编码参考')}：{settings.examples?.join('、')||'—'}{settings.warning&&' · '+settings.warning}</p>
 {settings.can_manage&&<button type="button" disabled={busy} onClick={()=>void act('rule')}>{ui('保存新建编码规则')}</button>}
 <hr/><p><strong>{ui(selected.length?'本次范围：当前页面已选作业':'本次范围：当前页面可见作业')} · {targets.length}{ui('条')}</strong></p>
 <p className="help">{ui('按表内当前显示顺序编号，不包含其他页或已折叠隐藏的作业。批量编号从上述起始数字开始，不按空号或最大值续编；不会自动保存新建规则。')}</p>
 <button type="submit" disabled={busy||!targets.length}>{ui('预览重新编号')}</button>
 {preview&&<><div className="plan-inspection-scroll grid-scroll"><table className="data-grid"><thead><tr>{['作业名称','原编码','新编码','保存后状态'].map(t=><th key={t}>{ui(t)}</th>)}</tr></thead><tbody>{preview.changes.map((r:any)=><tr key={r.id}><td>{r.name}</td><td>{r.before}</td><td>{r.after}</td><td>{ui(r.changed?'草稿':'不变')}</td></tr>)}</tbody></table></div>
 <p className="help">{ui('仅修改编码；逻辑关系、WBS归属和资源分配保留。发生编码变化的记录回到草稿，主管确认后参与正式计算；基线历史不改写。')}</p>
 <button className="primary" type="button" disabled={busy||!preview.changed} onClick={()=>void act('apply')}>{ui('确认重新编号')} · {preview.changed}{ui('条')}</button></>}
 </form>}
 </Modal>}</>;
}
