import {translateUiValue as t} from './i18n';

export default function GridColumnMenu({onSort,onGroup,onInsert,onEdit,onDelete}:{
  onSort:(direction:1|-1)=>void;onGroup?:()=>void;
  onInsert?:(side:'left'|'right')=>void;onEdit?:()=>void;onDelete?:()=>void;
}){
  return <div className="column-menu" role="menu">
    <button type="button" onClick={()=>onSort(1)}>{t('升序排序')}</button>
    <button type="button" onClick={()=>onSort(-1)}>{t('降序排序')}</button>
    {onGroup&&<button type="button" onClick={onGroup}>{t('加入归类')}</button>}
    <small>{t('拖动表头可调整列顺序')}</small>
    {onInsert&&<><button type="button" onClick={()=>onInsert('left')}>{t('左侧插入列')}</button><button type="button" onClick={()=>onInsert('right')}>{t('右侧插入列')}</button></>}
    {onEdit&&<button type="button" onClick={onEdit}>{t('修改列')}</button>}
    {onDelete&&<button type="button" className="danger" onClick={onDelete}>{t('删除列')}</button>}
  </div>;
}
