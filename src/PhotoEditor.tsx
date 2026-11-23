import {useId,useLayoutEffect,useEffect,useRef,useState} from 'react';
import {ImagePlus} from 'lucide-react';
import {safePersonPhoto,thumbnail} from './photo-upload';
import {translateUiValue as ui} from './i18n';
import './photo-editor.css';

export function PhotoValue({value,name}:{value:unknown;name:string}){
 const src=safePersonPhoto(value);
 return src?<img className="photo-cell-thumbnail" src={src} alt={name} loading="lazy" draggable={false}/>:<span className="photo-cell-empty"><ImagePlus size={13}/>{ui('上传照片')}</span>;
}
export default function PhotoEditor({field,value,disabled}:{field:any;value:unknown;disabled:boolean}){
 const [photo,setPhoto]=useState(typeof value==='string'?value:''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const trigger=useRef<HTMLButtonElement>(null);
 const id=useId(),input=useRef<HTMLInputElement>(null),panel=useRef<HTMLDivElement>(null),last=useRef(photo);
 useLayoutEffect(()=>{
  if(last.current===photo)return;last.current=photo;
  input.current?.dispatchEvent(new Event('input',{bubbles:true}));
 },[photo]);
 function position(){
  if(!trigger.current||!panel.current)return;
  const r=trigger.current.getBoundingClientRect();
  panel.current.style.left=Math.max(8,Math.min(r.left,innerWidth-300))+'px';panel.current.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-310))+'px';
 }
 useEffect(()=>{
  let mounted=true;queueMicrotask(()=>{if(mounted&&document.activeElement===trigger.current&&!disabled){position();panel.current?.showPopover();}});
  return()=>{mounted=false};
 },[]);
 return <div className="photo-editor">
  <input ref={input} type="hidden" name={field.id} value={photo}/>
  <button ref={trigger} type="button" disabled={disabled} className="photo-trigger" aria-label={field.name+' '+ui('上传照片')} popoverTarget={id} onClick={()=>{position()}}><PhotoValue value={photo} name={field.name}/></button>
  <div ref={panel} id={id} popover="auto" className="photo-popover" aria-label={field.name}>
   <strong>{field.name}</strong>
   {safePersonPhoto(photo)&&<img className="photo-upload-preview" src={safePersonPhoto(photo)} alt={field.name}/>}
   <input type="file" aria-label={ui('选择照片文件')} disabled={disabled||busy} accept="image/png,image/jpeg,image/webp" onChange={async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setError('');
    try{setPhoto(await thumbnail(file))}catch(e){setError((e as Error).message)}finally{setBusy(false)}
   }}/>
   <small>{ui(busy?'照片处理中，请稍候':'小于5MB的照片会自动压缩保存。')}</small>
   <div className="photo-actions"><button type="button" disabled={!photo||busy||disabled} onClick={()=>setPhoto('')}>{ui('移除照片')}</button><button type="button" disabled={busy} popoverTarget={id} popoverTargetAction="hide">{ui('完成')}</button></div>
   {error&&<p role="alert">{error}</p>}
  </div>
 </div>;
}
