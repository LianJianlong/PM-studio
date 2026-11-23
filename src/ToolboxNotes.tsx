import {markdownTable,markdownImage,safeMarkdownImage} from '../shared/markdown-rich';
import {prepareNoteImage} from './note-images';
import {useEffect,useMemo,useRef,useState} from 'react';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {api,useApi,useApp,ErrorBox,useUnsavedChanges} from './lib';
import {translateUiValue as ui} from './i18n';
import MarkdownCodeEditor,{type MarkdownEditorAction,type MarkdownEditorHandle} from './MarkdownCodeEditor';
type Note={id?:string;name:string;content:string;version?:number};
type Mode='edit'|'preview'|'split';
const formats:[MarkdownEditorAction,string,string][]=[
 ['heading','H2','插入标题'],['bold','B','加粗'],['italic','I','斜体'],['link','链接','插入链接'],
 ['bullet','• 列表','无序列表'],['number','1. 列表','有序列表'],['quote','引用','引用'],['code','代码','插入代码'],['table','表格','插入表格']
];
export default function ToolboxNotes({onBusyChange}:{onBusyChange:(busy:boolean)=>void}){
 const {project,tick,reload,notify}=useApp(),base=`/projects/${project.id}/toolbox-notes`;
 const {data:list,error:listError}=useApi<any[]>(base,tick),{data:caps,error:permissionError}=useApi<{create:boolean;update:boolean;delete:boolean}>(`/projects/${project.id}/toolbox-permissions`,tick);
 const [note,setNote]=useState<Note>({name:'',content:''}),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState<Mode>('edit'),[outlineOpen,setOutlineOpen]=useState(false);
 const [visual,setVisual]=useState(true),[insertPanel,setInsertPanel]=useState<'table'|'image'|null>(null),[tableRows,setTableRows]=useState(3),[tableColumns,setTableColumns]=useState(3),[imageUrl,setImageUrl]=useState(''),[imageAlt,setImageAlt]=useState(''),[imageBusy,setImageBusy]=useState(false);const imageInput=useRef<HTMLInputElement>(null),currentNote=useRef(note);currentNote.current=note;
 const [cursor,setCursor]=useState({line:1,column:1});
 const input=useRef<HTMLInputElement>(null),editor=useRef<MarkdownEditorHandle>(null),busyRef=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusyChange(false)}},[onBusyChange]);
 useUnsavedChanges(dirty||busy||imageBusy);
 const html=useMemo(()=>{if(mode==='edit')return '';const clean=DOMPurify.sanitize(marked.parse(note.content,{async:false}) as string,{FORBID_TAGS:['iframe','video','audio','style','form'],FORBID_ATTR:['style']});const tree=new DOMParser().parseFromString(clean,'text/html');tree.querySelectorAll('img').forEach(img=>{const src=safeMarkdownImage(img.getAttribute('src')||'');if(!src)img.remove();else{img.src=src;img.loading='lazy';img.referrerPolicy='no-referrer'}});return tree.body.innerHTML},[note.content,mode]);

 const outline=useMemo(()=>note.content.split('\n').flatMap((text,index)=>{const m=/^(#{1,6})\s+(.+)$/.exec(text);return m?[{line:index+1,level:m[1].length,title:m[2].replace(/\s+#+\s*$/,'')}]:[]}),[note.content]);
 const lineCount=note.content.split('\n').length,wordCount=useMemo(()=>[...new Intl.Segmenter('zh-CN',{granularity:'word'}).segment(note.content)].filter(x=>x.isWordLike).length,[note.content]);
 const writable=!!(note.id?caps?.update:caps?.create),leave=()=>!dirty||confirm(ui('有未保存的笔记，确定离开？'));
 function start(){if(busyRef.current||imageBusy)return false;busyRef.current=true;setBusy(true);onBusyChange(true);return true}
 function finish(){busyRef.current=false;if(mounted.current){setBusy(false);onBusyChange(false)}}
 function reset(){setNote({name:'',content:''});setDirty(false);setError('');setMode('edit');setVisual(true);setInsertPanel(null)}
 function change(key:'name'|'content',value:string){if(!writable||busyRef.current||value.length>200000)return;setNote(n=>({...n,[key]:value}));setDirty(true)}
 async function open(id:string){if(!id||busyRef.current||!leave()||!start())return;try{const row=await api<Note>(base+'/'+id);if(mounted.current){setNote(row);setDirty(false);setError('');setMode('edit')}}catch(e:any){if(mounted.current)setError(e.message)}finally{finish()}}
 async function save(){if(!writable||!dirty||!note.name.trim()||!start())return;const snapshot={...note};try{const result=await api<Pick<Note,'id'|'version'>>(base+(snapshot.id?'/'+snapshot.id:''),snapshot.id?'PUT':'POST',snapshot);if(mounted.current){setNote({...snapshot,...result});setDirty(false);setError('');reload();notify(ui('笔记已保存'))}}catch(e:any){if(mounted.current)setError(e.message)}finally{finish()}}
 async function remove(){if(!note.id||!caps?.delete||busyRef.current||!confirm(ui('删除此笔记？'))||!start())return;try{await api(base+'/'+note.id,'DELETE',{version:note.version});if(mounted.current){reset();reload()}}catch(e:any){if(mounted.current)setError(e.message)}finally{finish()}}
 async function importFile(file?:File){if(!file||!writable||busyRef.current)return;if(file.size>200000){setError(ui('笔记最大200KB'));return}if(!leave()||!start())return;try{const text=await file.text();if(mounted.current){setNote(n=>({...n,name:file.name.replace(/\.[^.]+$/,'').slice(0,120),content:text}));setDirty(true);setError('');setMode('edit')}}catch{if(mounted.current)setError(ui('读取文件失败，请重试'))}finally{finish()}}
 function insertMarkdown(text:string){if(!writable||busyRef.current)return;if(note.content.length+text.length+4>200000){setError(ui('\u7b14\u8bb0\u5185\u5bb9\u8d85\u8fc7200000\u5b57\u7b26'));return}editor.current?.insert('\n\n'+text+'\n\n');setInsertPanel(null);setMode('edit');setVisual(true);setError('')}
 async function uploadImage(file?:File){if(!file||!writable||busyRef.current||imageBusy)return;const before=currentNote.current;setImageBusy(true);onBusyChange(true);try{const src=await prepareNoteImage(file,198000-before.content.length);if(!mounted.current)return;if(currentNote.current.content!==before.content||currentNote.current.id!==before.id)throw Error('\u7f16\u8f91\u5185\u5bb9\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u63d2\u5165\u56fe\u7247');insertMarkdown(markdownImage(imageAlt||file.name,src))}catch(error){if(mounted.current)setError((error as Error).message)}finally{if(mounted.current){setImageBusy(false);onBusyChange(false)}}}
 function exportFile(){const url=URL.createObjectURL(new Blob([note.content],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=(note.name||'note')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 function openOutlineLine(line:number){setMode('edit');if(window.innerWidth<=560)setOutlineOpen(false);setTimeout(()=>editor.current?.revealLine(line),0)}
 return <div className="md-notes" data-note-dirty={dirty} data-tool-busy={busy} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='v'){e.preventDefault();setMode(m=>m==='preview'?'edit':'preview')}}}>
  <div className="data-toolbar md-file-toolbar">
   <select aria-label={ui('打开笔记')} value={note.id||''} disabled={busy||imageBusy} onChange={e=>void open(e.target.value)}><option value="">{ui('打开笔记')}</option>{list?.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select>
   <input aria-label={ui('笔记名称')} placeholder={ui('笔记名称')} value={note.name} maxLength={120} disabled={!writable||busy||imageBusy} onChange={e=>change('name',e.target.value)}/>
   <button disabled={busy||imageBusy||!caps?.create} onClick={()=>{if(!busyRef.current&&leave())reset()}}>{ui('新建')}</button>
   <button className="primary" disabled={!writable||busy||imageBusy||!note.name.trim()||!dirty} onClick={()=>void save()} title="Ctrl/Cmd+S">{ui(busy?'处理中':'保存')}</button>
   <button disabled={!writable||busy||imageBusy} onClick={()=>input.current?.click()}>{ui('导入MD')}</button>
   <button disabled={busy||imageBusy} onClick={exportFile}>{ui('导出MD')}</button>
   <button disabled={!caps?.delete||busy||imageBusy||!note.id} onClick={()=>void remove()}>{ui('删除')}</button>
   <span className="help" role="status">{ui(busy?'处理中':dirty?'未保存':note.id?'已保存':'新笔记')}</span>
   <input ref={input} type="file" accept=".md,.markdown,.txt" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';void importFile(file)}}/>
  </div>
  {(error||listError||permissionError)&&<ErrorBox message={ui(error||listError||permissionError)}/>}
  <div className="md-workbench">
   <div className="md-editor-topline">
    <span className="md-editor-tab">{note.name||ui('未命名笔记')}.md{dirty?' •':''}</span>
    <div className="md-view-modes" role="group" aria-label={ui('显示模式')}>
     {([['edit','编辑'],['preview','预览'],['split','并排']] as [Mode,string][]).map(([value,label])=><button key={value} className={mode===value?'active':''} aria-pressed={mode===value} onClick={()=>setMode(value)}>{ui(label)}</button>)}
    </div>
    <button className={outlineOpen?'active':''} aria-pressed={outlineOpen} onClick={()=>setOutlineOpen(v=>!v)}>{ui('大纲')}</button>
    <button onClick={()=>{setMode('edit');setTimeout(()=>editor.current?.find(),0)}} title="Ctrl/Cmd+F">{ui('查找')}</button>
   </div>
   {mode!=='preview'&&<div className="md-format-toolbar" role="toolbar" aria-label={ui('Markdown格式工具')}>
    {formats.map(([action,label,title])=><button key={action} disabled={!writable||busy||imageBusy} title={ui(title)} onClick={()=>action==='table'?setInsertPanel(insertPanel==='table'?null:'table'):editor.current?.apply(action)}>{ui(label)}</button>)}
    <button disabled={!writable||busy||imageBusy} title={ui('\u63d2\u5165\u56fe\u7247')} onClick={()=>setInsertPanel(insertPanel==='image'?null:'image')}>{ui('\u56fe\u7247')}</button><button disabled={busy||imageBusy} className={visual?'active':''} onClick={()=>setVisual(v=>!v)}>{ui(visual?'\u5207\u6362\u6e90\u7801':'\u56fe\u6587\u7f16\u8f91')}</button>
   </div>}
   {insertPanel&&mode!=='preview'&&<div className="md-insert-panel">{insertPanel==='table'?<><label>{ui('\u6570\u636e\u884c\u6570')}<input aria-label={ui('\u6570\u636e\u884c\u6570')} type="number" min={1} max={50} value={tableRows} onChange={e=>setTableRows(Number(e.target.value))}/></label><label>{ui('\u5217\u6570')}<input aria-label={ui('\u5217\u6570')} type="number" min={1} max={20} value={tableColumns} onChange={e=>setTableColumns(Number(e.target.value))}/></label><button className="primary" disabled={!writable||busy||!Number.isInteger(tableRows)||!Number.isInteger(tableColumns)||tableRows<1||tableRows>50||tableColumns<1||tableColumns>20} onClick={()=>insertMarkdown(markdownTable(tableRows,tableColumns))}>{ui('\u63d2\u5165\u8868\u683c')}</button></>:<><input aria-label={ui('\u56fe\u7247\u8bf4\u660e')} placeholder={ui('\u56fe\u7247\u8bf4\u660e')} value={imageAlt} maxLength={120} disabled={imageBusy} onChange={e=>setImageAlt(e.target.value)}/><input aria-label={ui('\u56fe\u7247\u5730\u5740')} placeholder="https://..." value={imageUrl} maxLength={2000} disabled={imageBusy} onChange={e=>setImageUrl(e.target.value)}/><button disabled={!writable||busy||imageBusy||!safeMarkdownImage(imageUrl)} onClick={()=>insertMarkdown(markdownImage(imageAlt,imageUrl))}>{ui('\u63d2\u5165\u94fe\u63a5\u56fe\u7247')}</button><button className="primary" disabled={!writable||busy||imageBusy} onClick={()=>imageInput.current?.click()}>{ui(imageBusy?'\u5904\u7406\u4e2d':'\u4e0a\u4f20\u56fe\u7247')}</button><small>{ui('\u56fe\u7247\u5c0f\u4e8e5MB\uff0c\u538b\u7f29\u540e\u968f\u7b14\u8bb0\u4fdd\u5b58\uff1b\u66f4\u591a\u56fe\u7247\u53ef\u4f7f\u7528\u94fe\u63a5\u3002')}</small></>}<button disabled={imageBusy} onClick={()=>setInsertPanel(null)}>{ui('\u53d6\u6d88')}</button><input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e=>{const file=e.target.files?.[0];e.target.value='';void uploadImage(file)}}/></div>}
   <div className={'md-main md-mode-'+mode+(outlineOpen?' has-outline':'')}>
    {outlineOpen&&<aside className="md-outline"><strong>{ui('文档大纲')}</strong>{outline.length?outline.map(h=><button key={h.line} style={{paddingLeft:8+h.level*10}} onClick={()=>openOutlineLine(h.line)}>{h.title}</button>):<small>{ui('使用 # 标题生成大纲')}</small>}</aside>}
    <div className="md-editor-pane" aria-label={ui('Markdown编辑')}><MarkdownCodeEditor ref={editor} value={note.content} visual={visual} readOnly={!writable||busy} onChange={value=>change('content',value)} onStatus={s=>setCursor({line:s.line,column:s.column})} onSave={()=>void save()}/></div>
    {mode!=='edit'&&<article className="md-preview md-preview-pane" aria-label={ui('Markdown预览')} onClick={e=>{const a=(e.target as HTMLElement).closest('a');if(a){e.preventDefault();if(/^https?:\/\//i.test(a.href))window.open(a.href,'_blank','noopener,noreferrer')}}} dangerouslySetInnerHTML={{__html:html}}/>}
   </div>
   <div className="md-statusbar"><span>Markdown</span><span>{ui('行')} {cursor.line}, {ui('列')} {cursor.column}</span><span>{lineCount} {ui('行')} · {wordCount} {ui('词')} · {note.content.length}/200000 {ui('字符')}</span><span>{ui('Ctrl/Cmd+S 保存 · Ctrl/Cmd+F 查找')}</span></div>
  </div>
 </div>
}
