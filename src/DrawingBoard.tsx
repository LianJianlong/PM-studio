import {useEffect,useRef,useState} from 'react';
import {api,useApi,useApp,ErrorBox,useUnsavedChanges} from './lib';
import {translateUiValue as ui,interfaceLocale} from './i18n';
const blank='<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
export default function DrawingBoard({onBusyChange}:{onBusyChange:(busy:boolean)=>void}){
 const {project,tick,reload,notify}=useApp(),{data:list,error:listError}=useApi<any[]>(`/projects/${project.id}/drawing-boards`,tick),{data:caps,error:permissionError}=useApi<{create:boolean;update:boolean}>(`/projects/${project.id}/toolbox-permissions`,tick);
 const frame=useRef<HTMLIFrameElement>(null),current=useRef<any>({name:ui('新画板'),xml:blank}),busyRef=useRef(false),mounted=useRef(true),revision=useRef(0);
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[name,setName]=useState(ui('新画板')),[error,setError]=useState(''),[ready,setReady]=useState(false),[full,setFull]=useState(false);
 const nameRef=useRef(name);nameRef.current=name;const capsRef=useRef(caps);capsRef.current=caps;useUnsavedChanges(dirty||busy);
 const writable=!!(current.current.id?caps?.update:caps?.create);
 const send=(message:any)=>frame.current?.contentWindow?.postMessage(JSON.stringify(message),location.origin);
 function start(){if(busyRef.current)return false;busyRef.current=true;setBusy(true);onBusyChange(true);return true}
 function finish(){busyRef.current=false;if(mounted.current){setBusy(false);onBusyChange(false)}}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusyChange(false)}},[onBusyChange]);
 useEffect(()=>{
  const listener=async(e:MessageEvent)=>{
   if(e.origin!==location.origin||e.source!==frame.current?.contentWindow)return;let m:any;try{m=typeof e.data==='string'?JSON.parse(e.data):e.data}catch{return}if(!m||typeof m!=='object')return;
   if(m.event==='autosave'){revision.current++;setDirty(true)}
   if(m.event==='init'){setReady(true);send({action:'load',autosave:1,xml:current.current.xml,title:current.current.name})}
   if(m.event==='save'){
    const c={...current.current},snapshotName=nameRef.current,atRevision=revision.current;
    if(!(c.id?capsRef.current?.update:capsRef.current?.create)){setError(ui('没有画板保存权限'));send({action:'status',message:ui('没有画板保存权限'),modified:true});return}
    if(!snapshotName.trim()){setError(ui('请填写画板名称'));return}
    if(!start()){send({action:'status',message:ui('正在保存，请稍候'),modified:true});return}
    try{const result=await api(`/projects/${project.id}/drawing-boards${c.id?'/'+c.id:''}`,c.id?'PUT':'POST',{name:snapshotName,xml:m.xml,version:c.version});if(!mounted.current)return;current.current={...c,...result,xml:m.xml,name:snapshotName};setError('');const changed=revision.current!==atRevision;setDirty(changed);reload();notify(ui('画板已保存'));send({action:'status',message:ui(changed?'已保存，仍有新修改':'已保存'),modified:changed})}
    catch(err:any){if(mounted.current){setError(err.message);send({action:'status',message:err.message,modified:true})}}finally{finish()}
   }
  };window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
 },[project.id]);
 useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape')setFull(false)};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc)},[]);
 async function open(id:string){if(!id||busyRef.current||!ready)return;if(dirty&&!confirm(ui('打开其他画板前，请先在编辑器中保存当前修改。继续？')))return;if(!start())return;try{const row=await api(`/projects/${project.id}/drawing-boards/${id}`);if(mounted.current){current.current=row;setName(row.name);setDirty(false);setError('');send({action:'load',autosave:1,xml:row.xml,title:row.name})}}catch(err:any){if(mounted.current)setError(err.message)}finally{finish()}}
 return <section data-drawing-dirty={dirty} data-tool-busy={busy} className={'drawing-board'+(full?' drawing-board-full':'')}><div className="data-toolbar"><strong>draw.io</strong><input aria-label={ui('画板名称')} value={name} maxLength={120} disabled={!writable||busy} onChange={e=>{setName(e.target.value);revision.current++;setDirty(true)}}/><select aria-label={ui('打开项目画板')} value={current.current.id||''} disabled={busy||!ready} onChange={e=>void open(e.target.value)}><option value="">{ui('打开项目画板')}</option>{list?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><button disabled={!ready||busy||!caps?.create} onClick={()=>{if(busyRef.current||dirty&&!confirm(ui('新建前请先保存当前画板。继续？')))return;current.current={name:ui('新画板'),xml:blank};setName(ui('新画板'));setDirty(false);setError('');send({action:'load',autosave:1,xml:blank})}}>{ui('新建画板')}</button><button onClick={()=>setFull(!full)}>{ui(full?'退出全屏':'全屏')}</button><span className="help" role="status">{ui(busy?'正在保存，请稍候':'本机离线编辑 · 编辑器保存按钮保存到当前项目')}</span></div>{(error||listError||permissionError)&&<ErrorBox message={ui(error||listError||permissionError)}/>}<iframe ref={frame} title={ui('draw.io画板')} src={'/drawio/?embed=1&proto=json&spin=1&saveAndExit=0&noSaveBtn=0&noExitBtn=1&stealth=1&local=1&lang='+(interfaceLocale().startsWith('zh')?'zh':'en')} allow="clipboard-read; clipboard-write"/></section>
}
