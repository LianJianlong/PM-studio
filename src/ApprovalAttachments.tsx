import {useRef,useState} from 'react';
import {api,Field} from './lib';
import {translateUiValue as ui} from './i18n';
import {MAX_FILE_BYTES} from '../shared/file-storage';
export function useApprovalAttachments(projectId:string){
 const [files,setFiles]=useState<File[]>([]),[error,setError]=useState('');
 const uploaded=useRef(new Map<File,string>());
 return {field:<Field label={ui('申请附件')} hint={ui('可选，单个文件须小于5MB；提交时上传至当前项目文件，取消申请不会上传。')}>
   <input aria-label={ui('申请附件')} type="file" multiple onChange={e=>{const selected=Array.from(e.target.files||[]);e.target.value='';if(selected.some(f=>f.size>=MAX_FILE_BYTES)){setError('单个文件必须小于5MB');return;}if(files.length+selected.length>10){setError('每次申请最多10个附件');return;}setError('');setFiles(old=>[...old,...selected]);}}/>
   {files.map((f,i)=><div key={i}>{f.name} · {(f.size/1024).toFixed(1)} KB <button type="button" onClick={()=>setFiles(old=>old.filter((_,j)=>j!==i))}>{ui('移除')}</button></div>)}
   {error&&<small role="alert">{ui(error)}</small>}
 </Field>,upload:async()=>{
   if(error)throw Error(error);
   const ids:string[]=[];
   for(const f of files){let id=uploaded.current.get(f);if(!id){const content_base64=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(Error('无法读取所选文件'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(f);});const row=await api(`/projects/${projectId}/files`,'POST',{name:f.name,mime_type:f.type||'application/octet-stream',content_base64});id=row.id;uploaded.current.set(f,id!);}ids.push(id!);}
   return ids;
 }};
}
