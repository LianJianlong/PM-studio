import {api,useApp,today} from './lib';
import NativeGridRow,{type NativeColumn} from './NativeGridRow';
import {translateUiValue as ui} from './i18n';
export default function AgendaRowEditor({item,columns,label,users,candidates,onSaved,onCancel}:any){
 const {project,boot}=useApp(),raw=item.raw||{};
 const mapping:Record<string,string>={title:'title',content:'content',owner:'owner_id',reviewer:'reviewer_id',approver:'approver_id',date:'due_date',priority:'priority',recurrence:'recurrence',until:'recurrence_until'};
 const editable=item.source==='owner'?['title','content','reviewer','approver']:['title','owner','date','priority','recurrence','until'];
 const initial:any={...raw,title:raw.title||'',due_date:String(raw.due_date||today()).slice(0,10),owner_id:raw.owner_id||boot.user.id,priority:raw.priority||'normal',recurrence:raw.recurrence||'none',recurrence_until:raw.recurrence_until?String(raw.recurrence_until).slice(0,10):''};
 const fields:NativeColumn[]=columns.map((key:string)=>{const fieldKey=mapping[key]||key,readonly=!editable.includes(key);if(readonly)initial[fieldKey]=item[key]||'';let options;
 if(['owner','reviewer','approver'].includes(key)){const list=key==='reviewer'?candidates.reviewers:key==='approver'?candidates.approvers:users;options=(list||[]).map((u:any)=>({value:u.id,label:u.name}));}
 if(key==='priority')options=Object.entries({low:'低',normal:'普通',high:'高',urgent:'紧急'}).map(([value,label])=>({value,label:ui(label)}));
 if(key==='recurrence')options=Object.entries({none:'不重复',daily:'每天',weekly:'每周',monthly:'每月'}).map(([value,label])=>({value,label:ui(label)}));
 return {key:fieldKey,label:typeof label==='function'?label(key):key,readonly,options,type:['date','until'].includes(key)?'date':'text',required:['title','date'].includes(key)&&!readonly};});
 return <NativeGridRow columns={fields} initial={initial} onSaved={onSaved} onCancel={onCancel} onWrite={async(value,id,version)=>{
  if(item.source==='owner')return api(`/owner-items/${id}`,'PATCH',{title:value.title,content:value.content,reviewer_id:value.reviewer_id,approver_id:value.approver_id,version});
  const body={title:value.title,due_date:value.due_date,owner_id:value.owner_id,priority:value.priority,recurrence:value.recurrence,...(value.recurrence_until?{recurrence_until:value.recurrence_until}:id?{recurrence_until:null}:{}),...(id?{version}:{})};
  return api(id?`/todos/${id}`:`/projects/${project.id}/todos`,id?'PATCH':'POST',body);
 }}/>
}
