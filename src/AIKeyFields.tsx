import {useState} from 'react';
import {Field} from './lib';
import {translateUiValue as ui} from './i18n';
export default function AIKeyFields({hasKey,local}:{hasKey:boolean;local:boolean}){
 const [value,setValue]=useState(''),[clear,setClear]=useState(false);
 return <>
  <Field label="API Key" hint={ui(hasKey?'输入新密钥会替换原密钥，无需勾选清除；留空则保留原密钥。':local?'Ollama本地服务通常无需填写':'填写API Key并勾选启用后保存；保存成功后列表会显示已保存密钥。')}>
   <input name="api_key" type="password" autoComplete="new-password" value={value} placeholder={ui(hasKey?'已保存；留空保留':local?'Ollama本地服务通常无需填写':'请输入API Key')} onChange={e=>{setValue(e.target.value);if(e.target.value.trim())setClear(false);}}/>
  </Field>
  {hasKey&&<label className="checkbox-label"><input name="clear_key" type="checkbox" checked={clear} disabled={!!value.trim()} onChange={e=>setClear(e.target.checked)}/>{ui('清除已保存密钥')}{!local&&<small>{ui('清除密钥将同时停用此服务')}</small>}</label>}
 </>;
}
