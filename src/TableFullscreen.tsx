import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Maximize2,Minimize2} from 'lucide-react';
import {translateUiValue as ui} from './i18n';
import {tableFrame,tableHeadingTools} from './table-heading-tools';
type Target={table:HTMLTableElement;frame:HTMLElement;host:HTMLElement};
export default function TableFullscreen(){
 const [tables,setTables]=useState<Target[]>([]),[active,setActive]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let queued=0;
  const scan=()=>{const next=Array.from(document.querySelectorAll<HTMLTableElement>('main table')).filter(table=>!table.closest('.ai-answer,.word-tool')).map(table=>({table,frame:tableFrame(table),host:tableHeadingTools(table)}));setTables(old=>old.length===next.length&&next.every((v,i)=>v.table===old[i].table&&v.host===old[i].host)?old:next)};
  const queue=()=>{cancelAnimationFrame(queued);queued=requestAnimationFrame(scan)};scan();
  const observer=new MutationObserver(queue);observer.observe(document.getElementById('root')!,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});return()=>{observer.disconnect();cancelAnimationFrame(queued)};
 },[]);
 useEffect(()=>{if(!active)return;active.classList.add('table-is-fullscreen');document.body.classList.add('table-fullscreen-open');const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.modal'))setActive(null)};document.addEventListener('keydown',escape);return()=>{active.classList.remove('table-is-fullscreen');document.body.classList.remove('table-fullscreen-open');document.removeEventListener('keydown',escape)}},[active]);
 useEffect(()=>{if(active&&!tables.some(t=>t.frame===active))setActive(null)},[tables,active]);
 return <>{tables.map(({frame,host},index)=>createPortal(<div className="table-fullscreen-control"><button type="button" title={ui(active===frame?'退出全屏（Esc）':'全屏显示数据表')} aria-label={ui(active===frame?'退出表格全屏':'全屏显示数据表')} onClick={()=>setActive(active===frame?null:frame)}>{active===frame?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div>,host,'full-'+index))}</>;
}
