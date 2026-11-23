import {useLayoutEffect,useRef} from 'react';
import './sheet-scroll-space.css';

export default function SheetScrollSpace(){
 const spacer=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const node=spacer.current,frame=node?.parentElement,table=frame?.querySelector<HTMLTableElement>('table[data-stable-grid]');
  if(!node||!frame||!table)return;
  const update=()=>{
   node.style.width=Math.max(frame.clientWidth,table.offsetWidth+frame.clientWidth-80)+'px';
   node.style.height=Math.max(0,frame.clientHeight-80)+'px';
  };
  const observer=new ResizeObserver(update);observer.observe(frame);observer.observe(table);update();
  return()=>observer.disconnect();
 },[]);
 return <div ref={spacer} className="sheet-scroll-space" aria-hidden="true"/>;
}

export function focusSheetInput(row:HTMLTableRowElement,field:HTMLElement|null,creating:boolean){
 if(!field)return;
 const frame=row.closest<HTMLElement>('.grid-scroll');
 field.focus({preventScroll:true});
 if(!creating||!frame)return;
 const r=row.getBoundingClientRect(),v=frame.getBoundingClientRect();
 frame.scrollTop+=r.top+r.height/2-v.top-frame.clientHeight/2;
 const cell=field.closest('td')?.getBoundingClientRect();
 if(cell&&(cell.right>v.left+frame.clientWidth||cell.left<v.left+55))
  frame.scrollLeft+=cell.left+cell.width/2-v.left-frame.clientWidth/2;
}
