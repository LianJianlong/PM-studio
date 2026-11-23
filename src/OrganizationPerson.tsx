import {useState} from 'react';
import {api,Modal,Form,Field,ErrorBox} from './lib';
import {translateUiValue as ui} from './i18n';

import {safePersonPhoto,thumbnail} from './photo-upload';
export {safePersonPhoto} from './photo-upload';
const labels:Record<string,string>={employee_no:'人员编码',name:'姓名',position:'职位',phone:'电话',email:'邮箱',department:'所属部门'};
export default function OrganizationPerson({person,onClose,onSaved}:{person:any;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [photo,setPhoto]=useState(person.values.photo||''),[error,setError]=useState(''),[processing,setProcessing]=useState(false);
 return <Modal title={ui('编辑花名册人员资料')} onClose={onClose}>
  <p className="help">{ui('保存后同步更新人员花名册，所有关联岗位读取最新资料。')}</p>
  {error&&<ErrorBox message={error}/>}
  <Form onClose={onClose} onSubmit={async form=>{
   if(processing)throw Error(ui('照片处理中，请稍候'));
   const data:Record<string,unknown>={};
   for(const key of Object.keys(labels))if(person.fields[key])data[person.fields[key]]=String(form.get(key)||'')||null;
   if(person.fields.photo)data[person.fields.photo]=photo||null;
   await api('/records/'+person.id,'PUT',{version:person.version,data});
   await onSaved();onClose();
  }}>
   {Object.entries(labels).filter(([key])=>person.fields[key]).map(([key,label])=><Field key={key} label={ui(label)}><input name={key} aria-label={ui(label)} type={key==='email'?'email':'text'} maxLength={key==='phone'?100:1000} defaultValue={person.values[key]||''}/></Field>)}
   {person.fields.photo&&<Field label={ui('照片')}>
    {safePersonPhoto(photo)&&<img className="organization-person-photo" alt={ui('人员照片')} src={safePersonPhoto(photo)}/>}
    <input type="file" aria-label={ui('上传人员照片')} accept="image/png,image/jpeg,image/webp" disabled={processing} onChange={async e=>{
     const file=e.target.files?.[0];e.target.value='';if(!file)return;setProcessing(true);setError('');
     try{setPhoto(await thumbnail(file))}catch(e){setError((e as Error).message)}finally{setProcessing(false)}
    }}/>
    <button type="button" disabled={processing||!photo} onClick={()=>setPhoto('')}>{ui('移除照片')}</button>
    <small>{ui(processing?'照片处理中，请稍候':'照片自动压缩为小头像，保存到花名册。')}</small>
   </Field>}
  </Form>
 </Modal>;
}
