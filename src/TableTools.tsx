import {useEffect,useRef,type ReactNode} from 'react';
import {SlidersHorizontal,ChevronDown} from 'lucide-react';
import {translateUiValue as ui} from './i18n';

// Native details keeps every action keyboard accessible without adding a focus trap.
export default function TableTools({children}:{children:ReactNode}){
 const root=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))root.current?.removeAttribute('open')};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&root.current?.open){root.current.open=false;root.current.querySelector('summary')?.focus()}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[]);
 return <details className="sheet-tools" ref={root}><summary><SlidersHorizontal size={14}/>{ui('表格工具')}<ChevronDown size={12}/></summary><div className="sheet-tools-panel" onClick={e=>{if((e.target as Element).closest('button:not(:disabled)'))root.current?.removeAttribute('open')}}>{children}</div></details>
}
