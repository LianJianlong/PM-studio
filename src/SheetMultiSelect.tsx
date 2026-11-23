import {useId,useRef,useState} from 'react';
import {translateUiValue as ui} from './i18n';

export default function SheetMultiSelect({field,value}:{field:any;value:unknown}){
 const [values,setValues]=useState<string[]>(Array.isArray(value)?value:[]);
 const popover=useRef<HTMLDivElement>(null),id=useId();
 return <div className="sheet-multi-select">
  <button type="button" aria-label={field.name} popoverTarget={id} disabled={!!field.lifecycle&&field.lifecycle!=='active'} onClick={e=>{
   const rect=e.currentTarget.getBoundingClientRect();
   if(popover.current){popover.current.style.left=Math.max(6,Math.min(rect.left,innerWidth-246))+'px';popover.current.style.top=Math.min(rect.bottom+3,Math.max(6,innerHeight-230))+'px';}
  }}>{values.join('、')||'—'}</button>
  <div ref={popover} id={id} popover="auto" className="sheet-multi-options" aria-label={field.name}>
   {field.options?.map((option:string)=><label key={option}><input type="checkbox" name={field.id} value={option} checked={values.includes(option)} onChange={e=>setValues(v=>e.target.checked?[...v,option]:v.filter(x=>x!==option))}/>{ui(option)}</label>)}
  </div>
 </div>;
}
