import {useState} from 'react';
import {api,Field,Form,Modal,useApi,useApp} from './lib';
import {formatUiTemplate as fmt,translateUiValue as ui} from './i18n';

export default function TransferTable({table,onClose}:{table:any;onClose:()=>void}){
 const {workspace,project,reload,notify}=useApp();
 const [space,setSpace]=useState(workspace.id),[target,setTarget]=useState(project.id),[preview,setPreview]=useState<any>(null);
 const {data:spaces}=useApi<any[]>('/objects/workspaces');
 const {data:projects}=useApi<any[]>(space?`/objects/workspaces/${space}/projects`:null);
 const {data:departments}=useApi<any[]>(target?`/objects/projects/${target}/departments`:null);
 const endpoint=`/tables/${table.id}/transfer`;
 return <Modal title={ui('跨项目复制或移动数据表')} onClose={onClose}>
  <Form onClose={onClose} submit={preview?'确认转移':'预览转移'} onSubmit={async d=>{
   if(preview){
    await api(endpoint,'POST',{...preview.body,fingerprint:preview.fingerprint});
    notify(ui('数据表转移完成'));reload();onClose();return;
   }
   const body={project:target,department:d.get('department'),name:d.get('name'),action:d.get('action'),include_records:d.get('include_records')==='on',clear_external_links:d.get('clear_external_links')==='on'};
   setPreview({...await api(endpoint+'-preview','POST',body),body});
  }}>
   {preview?<div>
    <p>{fmt('将转移 {0} 条记录，新表记录以草稿保存。',[preview.records])}</p>
    {preview.bound&&<p>{ui('副本为普通数据表，不会替换目标项目的计划或日历绑定。')}</p>}
    {!!preview.external.length&&<p>{ui('不会带入其他表的关联：')}{preview.external.join('、')}</p>}
    <button type="button" onClick={()=>setPreview(null)}>{ui('返回修改')}</button>
   </div>:<>
    <Field label={ui('目标工作空间')}><select required value={space} onChange={e=>{setSpace(e.target.value);setTarget('')}}><option value="">{ui('请选择')}</option>{spaces?.filter(x=>x.lifecycle==='active').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    <Field label={ui('目标项目')}><select required value={target} onChange={e=>setTarget(e.target.value)}><option value="">{ui('请选择')}</option>{projects?.filter(x=>x.lifecycle==='active').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    <Field label={ui('目标部门')}><select key={target} name="department" required><option value="">{ui('请选择')}</option>{departments?.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    <Field label={ui('目标表名称')}><input name="name" maxLength={120} defaultValue={table.name} required/></Field>
    <Field label={ui('操作')}><select name="action"><option value="copy">{ui('复制到目标')}</option><option value="move">{ui('移动到目标')}</option></select></Field>
    <label className="checkbox-label"><input name="include_records" type="checkbox" defaultChecked/>{ui('包含记录')}</label>
    <label className="checkbox-label"><input name="clear_external_links" type="checkbox"/>{ui('允许清空其他表的关联')}</label>
   </>}
  </Form>
 </Modal>;
}
