import DatabaseConnectionForm from './DatabaseConnectionForm';
import {useState} from 'react';
import {api,useApi,useApp,ErrorBox,Confirm} from './lib';
import {translateUiValue as ui} from './i18n';
export default function StorageTargets(){
 const {tick,reload,notify}=useApp(),{data,error}=useApi<any>('/storage-targets',tick),[edit,setEdit]=useState<any>(null),[remove,setRemove]=useState<any>(null),[failure,setFailure]=useState('');
 async function open(id:string){try{setFailure('');setEdit(await api('/storage-targets/'+id))}catch(e){setFailure((e as Error).message)}}
 return <section className="storage-targets"><h3>{ui('\u5de5\u4f5c\u7a7a\u95f4\u4e1a\u52a1\u5b58\u50a8')}</h3>
 <p className="help">{ui('\u5728\u5f53\u524d\u9875\u9762\u65b0\u589e\u6216\u7f16\u8f91\u8fde\u63a5\uff0c\u53ef\u6d4b\u8bd5\u8fde\u901a\u6027\u5e76\u9009\u62e9\u5e93\u548cschema\u3002\u4fdd\u5b58\u6216\u6d4b\u8bd5\u4e0d\u4f1a\u81ea\u52a8\u542f\u7528\u4e1a\u52a1\u5b58\u50a8\u3002')}</p>
 {(error||failure)&&<ErrorBox message={error||failure}/>}
 {data?.can_manage&&<button disabled={!!edit} onClick={()=>setEdit({engine:'postgres'})}>{ui('\u65b0\u589e\u4e1a\u52a1\u5b58\u50a8\u914d\u7f6e')}</button>}
 <table className="object-table"><thead><tr><th>{ui('\u540d\u79f0')}</th><th>{ui('\u7c7b\u578b')}</th><th>{ui('\u72b6\u6001')}</th><th>{ui('\u64cd\u4f5c')}</th></tr></thead><tbody>{data?.targets.map((t:any)=><tr key={t.id||'primary'}><td>{ui(t.name)}</td><td>{t.engine==='mysql'?'MySQL':'PostgreSQL'}</td><td>{ui(t.state==='active'?'\u5f53\u524d\u4f7f\u7528':'\u9884\u7559\u914d\u7f6e\uff08\u672a\u63a5\u5165\uff09')}</td><td>{t.id&&data.can_manage&&<><button disabled={!!edit} onClick={()=>void open(t.id)}>{ui('\u7f16\u8f91')}</button><button disabled={t.workspace_count>0} title={t.workspace_count?ui('\u5df2\u88ab\u5de5\u4f5c\u7a7a\u95f4\u9009\u7528'):''} onClick={()=>setRemove(t)}>{ui('\u5220\u9664')}</button></>}</td></tr>)}</tbody></table>
 {edit&&<DatabaseConnectionForm key={edit.id||'new'} initial={edit} onCancel={()=>setEdit(null)} onTest={body=>api('/storage-targets/test','POST',{...body,...(edit.id?{target_id:edit.id,version:edit.version}:{})})} onSave={async body=>{
  await api('/storage-targets'+(edit.id?'/'+edit.id:''),edit.id?'PUT':'POST',{...body,...(edit.id?{version:edit.version}:{})});setEdit(null);reload();notify(ui('\u914d\u7f6e\u5df2\u4fdd\u5b58\uff0c\u672a\u542f\u7528\u4e1a\u52a1\u5b58\u50a8'));
 }}/>
 }
 {remove&&<Confirm title={ui('\u5220\u9664\u914d\u7f6e')} detail={remove.name} onClose={()=>setRemove(null)} onConfirm={async()=>{await api('/storage-targets/'+remove.id,'DELETE',{version:remove.version});setRemove(null);reload()}}/>}
 </section>
}
