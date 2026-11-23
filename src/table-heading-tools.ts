import {translateUiValue as ui} from './i18n';
import './table-heading-tools.css';
const normalSlots=new WeakMap<HTMLTableElement,HTMLElement>();
const slotOwners=new WeakMap<HTMLElement,HTMLTableElement>();
export function tableFrame(table:HTMLTableElement){return table.closest<HTMLElement>('.grid-scroll,.table-scroll,.table-wrap')||table.parentElement!}
export function tableHeadingTools(table:HTMLTableElement){
 const frame=tableFrame(table);
 if(frame.classList.contains('table-is-fullscreen')){
  let bar=frame.querySelector<HTMLElement>(':scope > .table-fullscreen-heading');
  if(!bar){bar=document.createElement('div');bar.className='table-fullscreen-heading';const title=document.createElement('strong');title.textContent=table.closest('section')?.querySelector('h1,h2,h3')?.textContent||ui('数据表');const tools=document.createElement('span');tools.className='table-heading-tools';bar.append(title,tools);frame.prepend(bar)}
  return bar.querySelector<HTMLElement>('.table-heading-tools')!;
 }
 frame.querySelector(':scope > .table-fullscreen-heading')?.remove();
 const known=normalSlots.get(table);if(known?.isConnected&&slotOwners.get(known)===table)return known;
 let heading:Element|null=null,scope:Element|null=frame;
 while(scope&&!heading&&!scope.matches('main,body')){
  let previous=scope.previousElementSibling;
  while(previous){if(previous.matches('.sheet-heading,.section-heading,.page-heading,h1,h2,h3,h4')){heading=previous;break}previous=previous.previousElementSibling}
  scope=scope.parentElement;
 }
 if(!heading){const rail=document.createElement('div');rail.className='table-grid-heading';frame.before(rail);heading=rail}
 heading.classList.add('table-title-with-tools');
 const reusable=Array.from(heading.children).find(child=>child instanceof HTMLElement&&child.classList.contains('table-heading-tools')&&!slotOwners.get(child)?.isConnected) as HTMLElement|undefined;
 const slot=reusable||document.createElement('span');slot.className='table-heading-tools';if(!reusable)heading.append(slot);slotOwners.set(slot,table);normalSlots.set(table,slot);return slot;
}
