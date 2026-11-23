import {createPortal} from 'react-dom';
import {useEffect,useId,useRef,useState} from 'react';
import {useApi,ErrorBox,Status} from './lib';
import {translateUiValue as ui} from './i18n';
import type {DataField} from '../shared/fields';
type Item={id:string;label:string;display_label?:string;status?:string};
export default function ReferencePicker({field,tableId,value,reference,disabled}:{field:DataField;tableId:string;value:unknown;reference?:{items:Item[];restricted:boolean};disabled:boolean}){
 const listId=useId();const [items,setItems]=useState<Item[]>(reference?.items||(Array.isArray(value)?value.map(id=>({id,label:'关联记录'})):[]));
 const [open,setOpen]=useState(false),[stage,setStage]=useState<'column'|'row'>('row'),[column,setColumn]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[active,setActive]=useState(0),[position,setPosition]=useState({left:0,top:0,width:620});
 const trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),hidden=useRef<HTMLInputElement>(null),searchInput=useRef<HTMLInputElement>(null),skipFocus=useRef(false),last=useRef(JSON.stringify(items.map(i=>i.id).sort()));
 const locked=disabled||!!reference?.restricted;
 const {data,error,loading}=useApi<any>(open?`/tables/${tableId}/reference-options/${field.id}?page=${page}&search=${encodeURIComponent(stage==='row'?query:'')}${column?'&display_column='+encodeURIComponent(column):''}`:null);
 useEffect(()=>{const timer=setTimeout(()=>{setQuery(search);setPage(1)},180);return()=>clearTimeout(timer)},[search]);
 useEffect(()=>{const next=JSON.stringify(items.map(i=>i.id).sort());if(last.current!==next){last.current=next;hidden.current?.dispatchEvent(new Event('input',{bubbles:true}));}},[items]);
 useEffect(()=>{if(!open)return;const place=()=>{const r=trigger.current!.getBoundingClientRect(),width=Math.min(620,innerWidth-24),height=Math.min(380,innerHeight-24);setPosition({left:Math.max(12,Math.min(r.left,innerWidth-width-12)),top:Math.max(12,Math.min(r.bottom+4,innerHeight-height-12)),width});};place();searchInput.current?.focus();const outside=(e:PointerEvent)=>{if(!popup.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)}},[open]);
 useEffect(()=>{popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'})},[active,stage,page]);
 function show(){if(locked)return;setStage('row');setSearch('');setQuery('');setPage(1);setActive(0);setOpen(true)}
 function close(){setOpen(false);skipFocus.current=true;trigger.current?.focus({preventScroll:true})}
 function go(next:'column'|'row',id?:string){if(id)setColumn(id);setStage(next);setSearch('');setQuery('');setActive(0);setPage(1);searchInput.current?.focus()}
 function choose(item:Item){if(field.id==='wbs')setItems([item]);else if(!items.some(i=>i.id===item.id)&&items.length<100)setItems(v=>[...v,item]);close();}
 const options=stage==='column'?(data?.columns||[]).filter((i:any)=>(i.name||'').toLowerCase().includes(search.toLowerCase())):(data?.items||[]);
 const waiting=loading||stage==='row'&&search!==query;
 function confirm(){const item=options[active];if(!item||waiting)return;if(stage==='column')go('row',item.id);else choose(item)}
 return <div className="reference-picker reference-compact">
  <input ref={hidden} type="hidden" name={field.id} value={JSON.stringify(items.map(i=>i.id).sort())} disabled={locked}/>
  <button ref={trigger} className="reference-cell-trigger reference-summary" type="button" disabled={locked} title={items.map(i=>i.label).join('；')} aria-label={ui(field.name)+' '+ui('选择关联')} aria-expanded={open} onFocus={()=>{if(skipFocus.current)skipFocus.current=false;else show()}} onClick={show}>{items.length?items.map(i=>i.label).join('；'):ui('选择关联')}</button>
  {reference?.restricted&&<small>{ui('关联不可见，保留原值')}</small>}
  {open&&!locked&&createPortal(<div ref={popup} role="dialog" aria-label={ui(field.name)+' '+ui('关联选择')} className="reference-popover reference-quick-picker" style={{position:'fixed',...position,zIndex:12000,maxHeight:'calc(100dvh - 24px)'}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,Math.min(options.length-1,i+(e.key==='ArrowDown'?1:-1))))}else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();confirm()}}}>
   <div className="reference-picker-heading"><strong>{data?.table?.name||ui('关联记录')}</strong><button type="button" onClick={()=>go(stage==='row'?'column':'row')}>{stage==='row'?`${ui('显示列')}：${data?.columns?.find((c:any)=>c.id===(column||data.display_column))?.name||'—'}`:ui('返回记录')}</button><button type="button" onClick={close} aria-label={ui('关闭关联选择')}>×</button></div>
   <input ref={searchInput} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={options[active]?`${listId}-${active}`:undefined} aria-label={ui('搜索关联选项')} value={search} onChange={e=>{setSearch(e.target.value);setActive(0)}} placeholder={ui(stage==='row'?'输入名称或编码，Enter 选择':'搜索显示列')}/>
   {!!items.length&&<div className="reference-selected-strip" aria-label={ui('已选关联')}>{items.map(item=><span key={item.id}>{item.label}<button type="button" aria-label={ui('移除关联')+' '+item.label} onClick={()=>setItems(v=>v.filter(i=>i.id!==item.id))}>×</button></span>)}</div>}
   {error&&<ErrorBox message={error}/>}<div className="reference-options-list" role="listbox" id={listId} aria-label={ui(stage==='row'?'行':'列')} aria-busy={waiting}>
    {waiting?<p>{ui('加载中…')}</p>:options.map((item:any,i:number)=><button type="button" role="option" id={`${listId}-${i}`} key={item.id} data-active={i===active} className={i===active?'active':''} aria-selected={stage==='row'?items.some(v=>v.id===item.id):column===item.id} onMouseEnter={()=>setActive(i)} onClick={()=>stage==='column'?go('row',item.id):choose(item)}><span>{stage==='column'?item.name:item.display_label||item.label}{stage==='row'&&item.display_label&&item.display_label!==item.label&&<small>{item.label}</small>}</span>{item.status&&<Status value={item.status}/>}</button>)}{!waiting&&!options.length&&<p>{ui('没有符合条件的可见记录')}</p>}
   </div><div className="reference-page"><small>{ui('Enter 确认 · Esc 关闭')}</small>{stage==='row'&&<><button type="button" disabled={page===1||waiting} onClick={()=>{setPage(v=>v-1);setActive(0)}}>{ui('上一页')}</button><span>{page}{data?` / ${Math.max(1,Math.ceil(data.total/30))}`:''}</span><button type="button" disabled={!data||page*30>=data.total||waiting} onClick={()=>{setPage(v=>v+1);setActive(0)}}>{ui('下一页')}</button></>}</div>
  </div>,document.body)}
 </div>
}
