import {focusSheetInput} from './SheetScrollSpace';
import {useId,useRef,useState,useEffect,type ReactNode} from 'react';
import {SheetSaveStatus} from './SheetSaveStatus';
import {translateUiValue as ui} from './i18n';
export type NativeColumn={key:string;label:string;type?:string;options?:{value:string;label:string}[];readonly?:boolean;required?:boolean};
export default function NativeGridRow({columns,initial,onWrite,onSaved,onCancel,leadingCell,focusField}:{columns:NativeColumn[];initial:any;onWrite:(value:any,id?:string,version?:number)=>Promise<any>;onSaved:()=>void|Promise<void>;onCancel:()=>void;leadingCell?:ReactNode;focusField?:string}){
 const formId=useId(),row=useRef<HTMLTableRowElement>(null),form=useRef<HTMLFormElement>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const st=useRef({id:initial.id,version:initial.version||1,last:'',busy:false,pending:false,finish:false,finishing:false,wrote:false});const [busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');const saveRef=useRef<(finish?:boolean)=>void>(()=>{});
 useEffect(()=>{
  if(row.current)focusSheetInput(row.current,row.current.querySelector<HTMLElement>(focusField?`[name="${CSS.escape(focusField)}"]`:'input:not([disabled]),select:not([disabled]),textarea'),!initial.id);
  return()=>{if(timer.current)clearTimeout(timer.current)};
 },[]);

 async function complete(){
  const s=st.current;if(s.finishing)return;
  s.finishing=true;setBusy(true);setError('');
  try{await onSaved()}catch(e){setError((e as Error).message)}finally{s.finishing=false;setBusy(false)}
 }
 async function save(finish=false){const s=st.current;if(s.finishing)return;s.finish ||= finish;if(s.busy){s.pending=true;return;}if(!form.current)return;const d=new FormData(form.current),value={...initial};for(const col of columns)if(!col.readonly)value[col.key]=String(d.get(col.key)??'');
  const missing=columns.find(c=>c.required&&!String(value[c.key]??'').trim());if(missing){if(finish&&!s.id&&columns.filter(c=>!c.readonly).every(c=>String(value[c.key]??'')===String(initial[c.key]??''))){s.finish=false;onCancel();return;}s.finish=false;if(finish&&Object.values(value).some(v=>v===''))setError(ui('请填写必填字段')+'：'+missing.label);return;}
  const next=JSON.stringify(value);if(next===s.last){if(s.finish){s.finish=false;await complete();}return;}
  if(!s.last&&s.id&&columns.filter(c=>!c.readonly).every(c=>String(value[c.key]??'')===String(initial[c.key]??''))){s.last=next;if(finish)onCancel();return;}
  s.busy=true;setBusy(true);setError('');try{const result=await onWrite(value,s.id,s.version);s.id=result?.id||s.id;s.version=s.id?s.version+1:1;if(!initial.id&&s.last==='')s.version=1;for(const [key,generated] of Object.entries(result?.generated||{})){const input=row.current?.querySelector<HTMLInputElement>(`[name="${CSS.escape(key)}"]`);if(input){input.value=String(generated??'');value[key]=generated;}}s.wrote=true;s.last=JSON.stringify(value);setSaved(true);if(s.finish&&!s.pending){s.finish=false;await complete();}}catch(e){setError((e as Error).message);s.finish=false;setSaved(false)}finally{s.busy=false;setBusy(false);if(s.pending){s.pending=false;saveRef.current(s.finish)}}
 }
 saveRef.current=save;function changed(){setSaved(false);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>saveRef.current(),700)}
 return <tr ref={row} data-sheet-record={initial.id} className="inline-new-record native-grid-row" aria-label={ui('原位录入行')} onBeforeInput={e=>{if(st.current.finishing)e.preventDefault()}} onInput={changed} onChange={changed} onBlur={()=>setTimeout(()=>{if(!row.current?.contains(document.activeElement))saveRef.current(true)},0)} onKeyDown={e=>{if(!e.nativeEvent.isComposing&&e.key==='Enter'&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();(e.target as HTMLElement).dispatchEvent(new CustomEvent('studio-sheet-move',{bubbles:true,detail:{direction:e.shiftKey?'up':'down'}}));saveRef.current(true)}}}>
 {leadingCell}
 {columns.map(c=><td key={c.key} data-sheet-field={c.key}><label className="inline-cell-label"><span className="sr-only">{c.label}</span>{c.readonly?<span>{initial[c.key]||'—'}</span>:c.options?<select aria-label={c.label} name={c.key} form={formId} defaultValue={initial[c.key]??''}>{c.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:<input aria-label={c.label} name={c.key} form={formId} type={c.type||'text'} required={c.required} defaultValue={initial[c.key]??''}/>}</label></td>)}
 <td className="sheet-save-cell"><form ref={form} id={formId} onSubmit={e=>{e.preventDefault();saveRef.current(true)}}><SheetSaveStatus busy={busy} saved={saved} error={error} onClose={()=>{if(timer.current)clearTimeout(timer.current);if(st.current.wrote)void complete();else onCancel()}}/></form></td></tr>
}
