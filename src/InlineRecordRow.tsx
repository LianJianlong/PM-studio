import {LOE} from '../shared/loe';
import {focusSheetInput} from './SheetScrollSpace';
import {translateUiValue as __ui} from './i18n';
import {useEffect,useId,useRef,useState} from 'react';
import {api} from './lib';
import SheetMultiSelect from './SheetMultiSelect';
import {SheetSaveStatus} from './SheetSaveStatus';
import {ValueEditor} from './FieldControls';
import {inputValue,isSystemField,isReference,numericTypes} from '../shared/fields';
export default function InlineRecordRow({table,columns,onSaved,onCancel,record,extraCells,focusField,defaults,defaultReferences,allowCancel,leadingCells,insertBefore,insertAfter,prepareData,renderCell,rowNumber,rowClass="",rowStyle,cellInset,fieldClass}:any){
 const formId=useId(),row=useRef<HTMLTableRowElement>(null),formRef=useRef<HTMLFormElement>(null);
 const [activityType,setActivityType]=useState(record?.data?.activity_type||defaults?.activity_type||'');
 const [generated,setGenerated]=useState<Record<string,unknown>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const state=useRef({id:record?.id,version:record?.version||1,data:record?.data||{},last:'',running:false,pending:false,finish:false,finishing:false,wrote:false});
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null),saveRef=useRef<(finish?:boolean)=>void>(()=>{});
 useEffect(()=>{const attach=()=>row.current?.querySelectorAll('input,select,textarea').forEach(el=>el.setAttribute('form',formId));attach();const observer=new MutationObserver(attach);if(row.current)observer.observe(row.current,{childList:true,subtree:true});const target=focusField?row.current?.querySelector<HTMLInputElement>(`[data-sheet-field="${CSS.escape(focusField)}"] .sheet-multi-select>button,[name="${CSS.escape(focusField)}"]`):null;
 const focus=target?.type==='hidden'?target.closest('.reference-picker,.photo-editor')?.querySelector<HTMLButtonElement>('.reference-cell-trigger,.photo-trigger'):target;
 if(row.current)focusSheetInput(row.current,(focus||row.current.querySelector<HTMLElement>('input:not([type=hidden]),textarea,select')) as HTMLElement|null,!record);
 return()=>{observer.disconnect();if(timer.current)clearTimeout(timer.current)}},[formId]);
 async function complete(){
  const st=state.current;
  if(st.finishing)return;
  st.finishing=true;setBusy(true);setError('');
  try{await onSaved();}
  catch(e){setError((e as Error).message);}
  finally{st.finishing=false;setBusy(false);}
 }
 async function save(finish=false){
  const st=state.current;if(st.finishing)return;st.finish ||= finish;
  if(st.running){st.pending=true;return;}
  if(!formRef.current)return;
  const form=new FormData(formRef.current);
  try {

                const data = Object.fromEntries(table.columns
                    .filter((f: any) => !f.derived_reference && !f.auto_increment && !isSystemField(f) &&
                    f.type !== "formula" &&
                    !(isReference(f) && record?.references?.[f.id]?.restricted) &&
                    (record || !f.lifecycle || f.lifecycle === "active"))
                    .map((f: any) => {
                    if (record &&
                        ((f.lifecycle && f.lifecycle !== "active") ||
                            !columns.some((c: any) => c.id === f.id) ||
                            record.references?.[f.id]?.restricted))
                        return [f.id, record.data[f.id] ?? null];
                    try {
                        return [
                            f.id,
                            f.type === "multi_select"
                                ? form.getAll(f.id).map(String)
                                : inputValue(f, String(form.get(f.id) ?? "")),
                        ];
                    }
                    catch (err) {
                        throw Error(`${f.name}：${(err as Error).message}`);
                    }
                }));

   if(!st.id&&!Object.values(data).some(v=>v!==null&&v!==''&&v!==undefined&&(!Array.isArray(v)||v.length))){if(finish)onCancel();return;}
   prepareData?.(data,form);
   if(data.activity_type===LOE&&table.columns.some((f:any)=>f.id==='loe_scope')){data.duration=0;data.remaining_duration=null;if(data.percent_complete_type==='工期')data.percent_complete_type='实物';for(const f of table.columns)if(f.plan_date==='start')data[f.id]=null;}
   const required=table.columns.filter((f:any)=>f.required&&!record?.exempt_fields?.includes(f.id)&&!f.auto_increment&&!f.auto_code&&!isSystemField(f)&&f.type!=='formula').find((f:any)=>data[f.id]===null||data[f.id]===undefined||data[f.id]===''||Array.isArray(data[f.id])&&!data[f.id].length);
   if(required){st.finish=false;if(finish)setError(__ui('请填写必填字段')+'：'+required.name);return;}
   const next=JSON.stringify(data);
   if(!st.id&&!Object.values(data).some(v=>v!==null&&v!==''&&v!==undefined&&(!Array.isArray(v)||v.length))){if(finish)onCancel();return;}
   if(next===st.last){if(st.finish){st.finish=false;await complete();}return;}
   if(!st.last&&record&&Object.keys(data).every(k=>JSON.stringify(data[k])===JSON.stringify(record.data[k]??null))){st.last=next;if(finish)onCancel();return;}
   st.running=true;setBusy(true);setError('');
   if(st.id){const result=await api(`/records/${st.id}`,'PUT',{data,version:st.version,reference_expected:Object.fromEntries(table.columns.filter((f:any)=>f.type==='backlink').map((f:any)=>[f.id,st.data[f.id]??[]]))});if(result.generated)setGenerated(v=>({...v,...result.generated}));st.version++;}
   else {const result=await api(`/tables/${table.id}/records`,'POST',{data,insert_before:insertAfter?undefined:insertBefore||undefined,insert_after:insertAfter||undefined});st.id=result.id;st.version=1;setGenerated(result.generated||{});for(const [key,value] of Object.entries(result.generated||{})){if(!table.columns.some((f:any)=>f.id===key&&f.auto_code))continue;const input=row.current?.querySelector<HTMLInputElement>(`[name="${CSS.escape(key)}"]`);if(input&&!input.disabled)input.value=String(value??'');data[key]=value;}}
   st.wrote=true;st.data=data;st.last=JSON.stringify(data);setSaved(true);
   if(st.finish&&!st.pending){st.finish=false;await complete();}
  }catch(err){setSaved(false);setError((err as Error).message);state.current.finish=false;}
  finally{st.running=false;setBusy(false);if(st.pending){st.pending=false;saveRef.current(st.finish);}}
 }
 saveRef.current=save;
 function schedule(){setSaved(false);if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>saveRef.current(false),700)}
 return <tr ref={row} data-sheet-record={record?.id} className={"inline-new-record "+rowClass} style={rowStyle} onBeforeInput={e=>{if(state.current.finishing)e.preventDefault()}} aria-label={__ui(record?'原位编辑行':'空白新增行')} onInput={e=>{if(!(e.target as Element).closest(".reference-popover"))schedule()}} onChange={e=>{const el=e.target as unknown as HTMLInputElement;if(el.name==='activity_type')setActivityType(el.value);if(!(e.target as Element).closest(".reference-popover"))schedule()}} onBlur={()=>{setTimeout(()=>{const focused=document.activeElement;if(row.current?.querySelector('.photo-popover:popover-open')||focused?.closest('.reference-popover')||row.current?.contains(focused))return;saveRef.current(true);},0)}} onKeyDown={e=>{if(!e.nativeEvent.isComposing&&e.key==='Enter'&&!(e.target instanceof HTMLTextAreaElement)&&!(e.target as HTMLElement).closest('.reference-picker,.sheet-multi-select,.photo-editor')){e.preventDefault();(e.target as HTMLElement).dispatchEvent(new CustomEvent('studio-sheet-move',{bubbles:true,detail:{direction:e.shiftKey?'up':'down',field:(e.target as HTMLElement).closest<HTMLElement>('td[data-sheet-field]')?.dataset.sheetField}}));saveRef.current(true)}}}>
 <td className="check-cell sheet-row-header"><form ref={formRef} id={formId} onSubmit={e=>{e.preventDefault();saveRef.current(true)}}><span className="sheet-row-number">{rowNumber??"+"}</span></form></td>
 {leadingCells}
 {columns.map((f:any)=><td key={f.id} data-sheet-field={f.id} className={[numericTypes.includes(f.type)?"numeric":"",fieldClass?.(f)||""].filter(Boolean).join(" ")}>{renderCell?.(f)??(activityType===LOE&&(['duration','remaining_duration'].includes(f.id)||f.plan_date==='start')?<span title={__ui('LOE由关联作业自动计算')}>{Object.hasOwn(generated,f.id)?generated[f.id]??'—':record?.data.activity_type===LOE?record?.data[f.id]??'—':__ui('自动计算')}</span>:f.derived_reference?<span>{record?.data[f.id]||"—"}</span>:<div className="inline-cell-label" style={cellInset?.(f)?{paddingInlineStart:cellInset(f)}:undefined}>{f.type==="multi_select"?<SheetMultiSelect field={f} value={record?.data[f.id]??defaults?.[f.id]}/>:<>{f.plan_date==="start"&&record?.data[f.id]&&!record?.plan_date_inputs?.[f.id]&&<span className="plan-date-preview">{record.data[f.id]}</span>}<ValueEditor field={activityType===LOE&&f.id==='percent_complete_type'?{...f,options:['实物','步骤']}:record?.exempt_fields?.includes(f.id)?{...f,required:false}:f} value={f.plan_date==="finish"&&Object.hasOwn(generated,f.id)?generated[f.id]:record?.plan_date_inputs&&Object.hasOwn(record.plan_date_inputs,f.id)?record.plan_date_inputs[f.id]:record?.data[f.id]??generated[f.id]??defaults?.[f.id]} reference={record?.references?.[f.id]??defaultReferences?.[f.id]} tableId={table.id}/></>}</div>)}</td>)}
 {extraCells}<td className="sheet-save-cell"><SheetSaveStatus busy={busy} saved={saved} error={error} onClose={allowCancel?()=>{
  if(timer.current)clearTimeout(timer.current);
  if(state.current.wrote)void complete();else onCancel();
 }:undefined}/></td>
 </tr>
}
