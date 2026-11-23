import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {translateUiValue as ui} from './i18n';

export function usePaneWidth(name:string, initial:number, minimum=140, maximum=480) {
  const key=`project-studio:pane-width:v1:${name}`;
  const [width,setWidth]=useState(()=>{try{const n=Number(localStorage.getItem(key));return n>=minimum&&n<=maximum?n:initial}catch{return initial}});
  useEffect(()=>{try{localStorage.setItem(key,String(width))}catch{}},[key,width]);
  return [width,setWidth] as const;
}
export default function PaneResize({name,width,onChange,minimum=160,maximum=440,direction=1}:{name:string;width:number;onChange:(n:number)=>void;minimum?:number;maximum?:number;direction?:1|-1}) {
  const stop=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>stop.current?.(),[]);
  const clamp=(n:number)=>Math.round(Math.max(minimum,Math.min(maximum,n)));
  return <div className="pane-resize-handle" role="separator" tabIndex={0} aria-label={ui(name)} aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width}
    onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onChange(clamp(width+(e.key==='ArrowRight'?1:-1)*direction*(e.shiftKey?30:10)))}}}
    onPointerDown={e=>{
      if(e.button!==0)return;
      e.preventDefault();stop.current?.();
      const x=e.clientX, original=width, target=e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const previous=document.body.style.userSelect, cursor=document.body.style.cursor;
      document.body.style.userSelect='none';document.body.style.cursor='col-resize';
      const move=(ev:PointerEvent)=>onChange(clamp(original+direction*(ev.clientX-x)));
      const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',cancel);target.removeEventListener('lostpointercapture',end);window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);document.body.style.userSelect=previous;document.body.style.cursor=cursor;stop.current=null};
      const cancel=()=>{onChange(original);end()};
      const key=(ev:KeyboardEvent)=>{if(ev.key==='Escape')cancel()};
      stop.current=end;target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',cancel);target.addEventListener('lostpointercapture',end);window.addEventListener('keydown',key);window.addEventListener('blur',cancel);
    }}/>
}
export const paneStyle=(name:string,width:number)=>({[name]:`${width}px`} as CSSProperties);
