import {useLayoutEffect,useRef} from 'react';
/** Delegated worksheet navigation. No data writes and no change to edit authorization. */
export default function SheetNavigation(){
 const marker=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const frame=marker.current?.parentElement;if(!frame)return;
  let pending:{source:string;record:string;field:string;left:number;top:number}|null=null;
  const cells=(row:Element)=>Array.from(row.querySelectorAll<HTMLTableCellElement>('td[data-sheet-field]'));
  const rows=()=>Array.from(frame.querySelectorAll<HTMLTableRowElement>('tbody tr[data-sheet-record]'));
  const reveal=(cell:HTMLElement)=>{cell.focus({preventScroll:true});const c=cell.getBoundingClientRect(),f=frame.getBoundingClientRect();if(c.left<f.left+45)frame.scrollLeft-=f.left+45-c.left;else if(c.right>f.right-12)frame.scrollLeft+=c.right-f.right+12;if(c.top<f.top+38)frame.scrollTop-=f.top+38-c.top;else if(c.bottom>f.bottom-12)frame.scrollTop+=c.bottom-f.bottom+12;};
  const target=(cell:HTMLElement,direction:string)=>{const row=cell.closest('tr')!,rs=rows(),ri=rs.indexOf(row as HTMLTableRowElement),cs=cells(row),ci=cs.indexOf(cell as HTMLTableCellElement);if(ri<0||ci<0)return null;if(direction==='down'||direction==='up')return rs[ri+(direction==='down'?1:-1)]?.querySelector<HTMLTableCellElement>(`td[data-sheet-field="${CSS.escape(cell.dataset.sheetField!)}"]`)||null;if(direction==='left'||direction==='right'){const next=ci+(direction==='right'?1:-1);return cs[next]||(direction==='right'?(rs[ri+1]?cells(rs[ri+1])[0]:null):(rs[ri-1]?cells(rs[ri-1]).at(-1):null))||null}return null};
  const restore=()=>{if(!pending)return;const source=frame.querySelector(`tr[data-sheet-record="${CSS.escape(pending.source)}"]`);if(source?.classList.contains('inline-new-record'))return;const row=frame.querySelector(`tr[data-sheet-record="${CSS.escape(pending.record)}"]`);if(!row||row.classList.contains('inline-new-record'))return;const cell=row.querySelector<HTMLElement>(`td[data-sheet-field="${CSS.escape(pending.field)}"]`);if(!cell)return;frame.scrollLeft=pending.left;frame.scrollTop=pending.top;pending=null;reveal(cell)};
  const moved=(e:Event)=>{const detail=(e as CustomEvent).detail,cell=(e.target as Element).closest<HTMLElement>('td[data-sheet-field]');if(!cell)return;const next=target(cell,detail?.direction||'down')||cell;const source=cell.closest<HTMLElement>('tr')?.dataset.sheetRecord;if(!source)return;pending={source,record:next.closest<HTMLElement>('tr')!.dataset.sheetRecord!,field:next.dataset.sheetField!,left:frame.scrollLeft,top:frame.scrollTop};};
  const key=(e:KeyboardEvent)=>{if(e.isComposing||e.altKey||e.ctrlKey||e.metaKey)return;const cell=(e.target as Element).closest<HTMLElement>('td[data-sheet-field]');if(!cell||e.target!==cell)return;const direction=({ArrowDown:'down',ArrowUp:'up',ArrowLeft:'left',ArrowRight:'right',Tab:e.shiftKey?'left':'right'} as Record<string,string>)[e.key];if(direction){const next=target(cell,direction);if(next){e.preventDefault();reveal(next)}return}if(e.key==='Enter'||e.key==='F2'){e.preventDefault();cell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));}};
  const cancel=()=>{pending=null};const observer=new MutationObserver(restore);observer.observe(frame,{childList:true,subtree:true});frame.addEventListener('keydown',key);frame.addEventListener('studio-sheet-move',moved);frame.addEventListener('pointerdown',cancel);
  return()=>{observer.disconnect();frame.removeEventListener('keydown',key);frame.removeEventListener('studio-sheet-move',moved);frame.removeEventListener('pointerdown',cancel)};
 },[]);
 return <span ref={marker} hidden/>;
}
