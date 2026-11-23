import {useMemo,useRef,useState} from 'react';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import MarkdownCodeEditor,{type MarkdownEditorAction,type MarkdownEditorHandle} from './MarkdownCodeEditor';
import {api,ErrorBox,Loading,useApi,useApp,useUnsavedChanges} from './lib';
import {translateUiValue as ui} from './i18n';
import './plan-summary.css';

type Document={markdown:string;version:number;can_edit:boolean};
const formats: [MarkdownEditorAction,string][]=[['heading','标题'],['bold','加粗'],['bullet','无序列表'],['link','插入链接'],['table','插入表格']];
const noStatus=()=>{};

export default function PlanSummary(){
 const {project,tick,notify}=useApp();
 const path=`/projects/${project.id}/plan-summary`;
 const {data,error}=useApi<Document>(path,tick);
 if(error)return <ErrorBox message={ui(error)}/>;
 if(!data)return <Loading/>;
 return <SummaryEditor document={data} path={path} onSaved={()=>notify(ui('项目概况已保存'))}/>;
}

function SummaryEditor({document,path,onSaved}:{document:Document;path:string;onSaved:()=>void}){
 const [local,setLocal]=useState<Document|null>(null),[draft,setDraft]=useState<string|null>(null);
 const [preview,setPreview]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const savingRef=useRef(false),editor=useRef<MarkdownEditorHandle>(null);
 const base=local&&(draft!==null||local.version>=document.version)?local:document;
 const markdown=draft??base.markdown,dirty=draft!==null&&draft!==base.markdown,writable=document.can_edit;
 const showingPreview=preview||!writable;
 useUnsavedChanges(dirty||saving);
 const rendered=useMemo(()=>showingPreview?DOMPurify.sanitize(marked.parse(markdown,{async:false}) as string,{FORBID_TAGS:['img','iframe','video','audio','style','form'],FORBID_ATTR:['style']}):'', [showingPreview,markdown]);
 async function save(){
  if(!writable||!dirty||savingRef.current)return;
  savingRef.current=true;setSaving(true);setError('');
  try{
   setLocal(await api<Document>(path,'PUT',{markdown,version:base.version}));setDraft(null);onSaved();
  }catch(e){setError((e as Error).message)}
  finally{savingRef.current=false;setSaving(false)}
 }
 return <section className="panel plan-summary">
  <div className="section-heading">
   <h3>{ui('项目概况')}</h3>
   {writable&&<div className="row-actions">
    <button type="button" aria-pressed={showingPreview} onClick={()=>setPreview(p=>!p)}>{ui(showingPreview?'返回编辑':'预览')}</button>
    <button type="button" className="primary" disabled={!dirty||saving} onClick={()=>void save()} title="Ctrl/Cmd+S">{ui(saving?'保存中…':'保存')}</button>
   </div>}
  </div>
  {error&&<ErrorBox message={ui(error)}/>}
  {writable&&!showingPreview&&<div className="md-format-toolbar" role="toolbar" aria-label={ui('Markdown格式工具')}>
   {formats.map(([action,label])=><button type="button" key={action} disabled={saving} onClick={()=>editor.current?.apply(action)}>{ui(label)}</button>)}
  </div>}
  <div className="plan-summary-editor" hidden={showingPreview}>
   {writable&&<MarkdownCodeEditor ref={editor} value={markdown} readOnly={saving} onChange={value=>{if(!savingRef.current){if(draft===null)setLocal(base);setDraft(value===base.markdown?null:value)}}} onStatus={noStatus} onSave={()=>void save()}/>}
  </div>
  {showingPreview&&(markdown?<article className="md-preview plan-summary-preview" aria-label={ui('Markdown预览')} onClick={e=>{const a=(e.target as Element).closest('a');if(a){e.preventDefault();if(/^https?:\/\//i.test(a.href))window.open(a.href,'_blank','noopener,noreferrer')}}} dangerouslySetInnerHTML={{__html:rendered}}/>:<p className="muted">{ui('尚未填写项目概况')}</p>)}
  {writable&&<p className="help" role="status">{ui(dirty?'未保存':'Markdown · Ctrl/Cmd+S 保存')}</p>}
 </section>;
}
