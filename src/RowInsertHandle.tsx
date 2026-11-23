import {translateUiValue as t} from './i18n';

export default function RowInsertHandle({onInsert,position="before",label}:{onInsert:()=>void;position?:"before"|"after";label?:string}){
  return <button type="button" className={"sheet-row-insert"+(position==="after"?" sheet-row-insert-after":"")} aria-label={label||t('在此行上方插入一行')} title={label||t('在此行上方插入一行')}
    onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onInsert()}}>+</button>;
}
