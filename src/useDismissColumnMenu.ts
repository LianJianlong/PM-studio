import {useEffect,useRef} from 'react';

export function useDismissColumnMenu(open:boolean,close:()=>void){
  const header=useRef<HTMLTableCellElement>(null);
  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{
      if(!event.composedPath().includes(header.current as EventTarget))close();
    };
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('keydown',onKeyDown);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown,true);
      document.removeEventListener('keydown',onKeyDown);
    };
  },[open,close]);
  return header;
}
