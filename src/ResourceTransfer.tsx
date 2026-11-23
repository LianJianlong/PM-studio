import {useState} from 'react';
import {api,useApi,useApp,Modal,Form,Field} from './lib';
import {translateUiValue as ui,formatUiTemplate as fmt} from './i18n';

export default function ResourceTransfer({source,ids,onClose}:{source:string;ids:string[];onClose:()=>void}){
 const {workspace,reload,notify}=useApp(),[space,setSpace]=useState(workspace.id),[target,setTarget]=useState('');
 const {data:spaces}=useApi<any[]>('/objects/workspaces');
 const {data:projects}=useApi<any[]>(space?`/objects/workspaces/${space}/projects`:null);
 return <Modal title={ui('跨项目转移资源')} onClose={onClose}>
  <Form submit="确认转移" onClose={onClose} onSubmit={async d=>{
    const result=await api(`/projects/${source}/resources/transfer`,'POST',{target,ids,action:d.get('action'),recode:d.get('recode')==='on'});
    notify(fmt('已转移 {0} 项资源',[result.count]));reload();onClose();
  }}>
   <p>{fmt('选中 {0} 项资源；作业分配和费用历史不会转移。',[ids.length])}</p>
   <Field label={ui('目标工作空间')}><select required value={space} onChange={e=>{setSpace(e.target.value);setTarget('')}}><option value="">{ui('请选择')}</option>{spaces?.filter(x=>x.lifecycle==='active').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
   <Field label={ui('目标项目')}><select required value={target} onChange={e=>setTarget(e.target.value)}><option value="">{ui('请选择')}</option>{projects?.filter(x=>x.lifecycle==='active'&&x.id!==source).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
   <Field label={ui('操作')}><select name="action"><option value="copy">{ui('复制到目标')}</option><option value="move">{ui('移动到目标')}</option></select></Field>
   <label className="checkbox-label"><input type="checkbox" name="recode"/>{ui('在目标项目重新生成资源编码')}</label>
  </Form>
 </Modal>;
}
