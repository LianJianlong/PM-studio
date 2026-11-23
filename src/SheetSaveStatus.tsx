import {createPortal} from 'react-dom';
import {translateUiValue as ui} from './i18n';

export function SheetSaveStatus({busy,saved,error,onClose}:{busy:boolean;saved:boolean;error:string;onClose?:()=>void}){
 return <>
  <small role="status">{ui(busy?'保存中…':error?'保存失败，请修正后重试':saved?'已保存':'自动保存')}</small>
  {onClose&&<button type="button" disabled={busy} onMouseDown={e=>e.preventDefault()} onClick={onClose}>{ui(saved?'关闭':'取消')}</button>}
  {error&&createPortal(<div className="sheet-save-error" role="alert">{ui(error)}</div>,document.body)}
 </>;
}
