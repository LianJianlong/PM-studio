import {useState} from 'react';
import {api,useApp,Modal,Form,Field} from './lib';
import {translateUiValue as ui} from './i18n';

export default function ActivityResourceCell({activity,context,onChanged}:{activity:any;context:any;onChanged?:()=>Promise<unknown>}){
 const {reload,notify}=useApp(),[open,setOpen]=useState(false),[selected,setSelected]=useState(''),[quantity,setQuantity]=useState('1');
 const allocations:any[]=activity?.allocations||[],resources:any[]=(context?.resources||[]).filter((r:any)=>r.currency===context.currency);
 const text=allocations.map(a=>[a.name,a.remaining_quantity!=null?ui('计划')+' '+a.quantity+' / '+ui('剩余')+' '+a.remaining_quantity:a.quantity,a.unit].filter(Boolean).join(' ')).join('；');
 const writable=!!activity?.can_assign_resources;
 function choose(id:string){setSelected(id);setQuantity(String(allocations.find(a=>a.resource_id===id)?.quantity||'1'))}
 async function updated(){if(onChanged)await onChanged();else reload();notify(ui('作业资源分配已更新'))}
 return <td className="plan-resource-cell" title={text||ui('未分配资源')} onDoubleClick={e=>e.stopPropagation()}>
  <button type="button" className="plan-resource-trigger" disabled={!activity} aria-label={ui('资源分配')+' '+(activity?.code||'')} onClick={e=>{e.stopPropagation();choose(allocations[0]?.resource_id||resources[0]?.id||'');setOpen(true)}}>{text||ui(writable?'分配资源':'未分配资源')}</button>
  {open&&<Modal title={ui('作业资源分配')} onClose={()=>setOpen(false)}>
   <p>{activity.code} · {activity.name}</p><p className='help'>{ui('此处修改原计划分配；进行中剩余投入请使用排程设置与检查中的工期资源联动。')}</p>
   <table className="data-grid"><thead><tr><th>{ui('资源名称')}</th><th>{ui('计划每日投入率')}</th><th>{ui('剩余每日投入率')}</th><th>{ui('单位')}</th><th>{ui('操作')}</th></tr></thead><tbody>{allocations.map(a=><tr key={a.id}><td>{a.code} · {a.name}</td><td>{a.quantity}</td><td>{a.remaining_quantity??'—'}</td><td>{a.unit||'—'}</td><td>{writable&&<button type="button" onClick={()=>choose(a.resource_id)}>{ui('编辑')}</button>}{writable&&context.can_remove_resources&&<button type="button" className="danger" onClick={async()=>{
    try{await api('/activity-resources/'+a.id,'DELETE',{version:a.version,reason:'作业表移除资源分配'});await updated();setOpen(false)}catch(e){notify((e as Error).message)}
   }}>{ui('移除')}</button>}</td></tr>)}</tbody></table>
   {writable&&resources.length>0?<Form submit="保存资源分配" onClose={()=>setOpen(false)} onSubmit={async()=>{
    if(!selected)throw Error(ui('请选择资源'));
    const existing=allocations.find(a=>a.resource_id===selected);
    await api('/activities/'+activity.id+'/resources','POST',{resource_id:selected,quantity,version:existing?.version||0,reason:'作业表资源分配'});
    await updated();setOpen(false);
   }}>
    <Field label={ui('资源名称')}><select required aria-label={ui('资源名称')} value={selected} onChange={e=>choose(e.target.value)}><option value="">{ui('请选择资源')}</option>{resources.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name} {r.unit?'('+r.unit+')':''}</option>)}</select></Field>
    <Field label={ui("分配数量")} hint={ui("每日分配数量；累计工量＝数量×持续工作日，费用＝累计工量×单价。")}><input required aria-label={ui('分配数量')} inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></Field>
   </Form>:<p className="help">{ui(!resources.length?'请先在资源池添加可用资源':'当前作业的资源分配只读，核准作业的资源变更请按原权限和审批流程办理。')}</p>}
  </Modal>}
 </td>;
}
