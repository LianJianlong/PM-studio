import {useEffect,useId,useRef,useState} from 'react';
import {ErrorBox,Field,useUnsavedChanges} from './lib';
import {translateUiValue as ui} from './i18n';
type Values={name:string;engine:'postgres'|'mysql';host:string;port:number;database:string;schema:string;user:string;password:string;tls:boolean};
type Probe={connected:boolean;read_only:boolean;database:string;schema:string;schema_exists:boolean;databases:string[];schemas:string[];duration_ms:number};
export default function DatabaseConnectionForm({initial={},onSave,onTest,onCancel}:{initial?:any;onSave:(body:any)=>Promise<void>;onTest:(body:any)=>Promise<Probe>;onCancel:()=>void}){
 const [values,setValues]=useState<Values>(()=>({name:initial.name||'',engine:initial.engine||'postgres',host:initial.host||'',port:initial.port||5432,database:initial.database||'',schema:initial.schema??'public',user:initial.user||'',password:'',tls:initial.tls!==false}));
 const [busy,setBusy]=useState<'save'|'test'|null>(null),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Probe|null>(null),[databases,setDatabases]=useState<string[]>([]),[schemas,setSchemas]=useState<string[]>([]);
 const form=useRef<HTMLFormElement>(null),mounted=useRef(true),active=useRef(false),listId=useId();useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);useUnsavedChanges(dirty||!!busy);
 function change<K extends keyof Values>(key:K,value:Values[K]){setValues(old=>{const next={...old,[key]:value};if(key==='engine'){next.port=value==='mysql'?3306:5432;next.schema=value==='mysql'?'':'public'}return next});setDirty(true);setResult(null);setError('');if(['engine','host','port','user','password','tls'].includes(key)){setDatabases([]);setSchemas([])}else if(key==='database')setSchemas([])}
 function payload(){const body:any={...values,schema:values.engine==='mysql'?values.database:values.schema};if(initial.id&&!values.password)delete body.password;return body}
 async function run(mode:'save'|'test'){
  if(active.current||!form.current?.reportValidity())return;active.current=true;setBusy(mode);setError('');setResult(null);
  try{if(mode==='save'){await onSave(payload());if(mounted.current)setDirty(false)}else{const r=await onTest(payload());if(mounted.current){setResult(r);setDatabases(r.databases);setSchemas(r.schemas)}}}
  catch(e){if(mounted.current)setError((e as Error).message)}finally{active.current=false;if(mounted.current)setBusy(null)}
 }
 return <section className="database-connection-editor" aria-label={ui('\u6570\u636e\u5e93\u8fde\u63a5\u914d\u7f6e')}><h3>{ui(initial.id?'\u7f16\u8f91\u6570\u636e\u5e93\u8fde\u63a5':'\u65b0\u589e\u6570\u636e\u5e93\u8fde\u63a5')}</h3>
 <form ref={form} onSubmit={e=>{e.preventDefault();void run('save')}}><fieldset disabled={!!busy}>
 <div className="database-connection-fields">
 <Field label={ui('\u8fde\u63a5\u540d\u79f0')}><input name="name" value={values.name} required maxLength={120} onChange={e=>change('name',e.target.value)}/></Field>
 <Field label={ui('\u6570\u636e\u5e93\u7c7b\u578b')}><select name="engine" value={values.engine} onChange={e=>change('engine',e.target.value as Values['engine'])}><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option></select></Field>
 <Field label={ui('\u5730\u5740 / \u4e3b\u673a')}><input name="host" value={values.host} required placeholder="localhost / db.example.com" maxLength={250} onChange={e=>change('host',e.target.value)}/></Field>
 <Field label={ui('\u7aef\u53e3')}><input name="port" type="number" value={values.port||''} required min={1} max={65535} step={1} onChange={e=>change('port',Number(e.target.value))}/></Field>
 <Field label={ui('\u6570\u636e\u5e93 / \u5e93\u540d')}><input name="database" list={listId+'-databases'} value={values.database} required maxLength={128} autoComplete="off" placeholder={values.engine==='postgres'?'postgres':'database_name'} onChange={e=>change('database',e.target.value)}/><datalist id={listId+'-databases'}>{databases.map(name=><option key={name} value={name}/>)}</datalist></Field>
 <Field label="Schema" hint={ui(values.engine==='mysql'?'MySQL\u7684schema\u4e0e\u5e93\u540d\u76f8\u540c':'\u53ef\u76f4\u63a5\u8f93\u5165\uff0c\u6216\u6d4b\u8bd5\u540e\u4ece\u5217\u8868\u9009\u62e9')}><input name="schema" list={listId+'-schemas'} value={values.engine==='mysql'?values.database:values.schema} disabled={values.engine==='mysql'} maxLength={128} placeholder="public" onChange={e=>change('schema',e.target.value)}/><datalist id={listId+'-schemas'}>{schemas.map(name=><option key={name} value={name}/>)}</datalist></Field>
 <Field label={ui('\u6570\u636e\u5e93\u7528\u6237')}><input name="user" value={values.user} required maxLength={128} autoComplete="off" onChange={e=>change('user',e.target.value)}/></Field>
 <Field label={ui('\u6570\u636e\u5e93\u5bc6\u7801')} hint={initial.has_password?ui('\u7559\u7a7a\u4fdd\u7559\u5df2\u4fdd\u5b58\u7684\u5bc6\u7801'):undefined}><input name="password" type="password" value={values.password} maxLength={500} autoComplete="new-password" onChange={e=>change('password',e.target.value)}/></Field>
 </div><label className="checkbox-label"><input name="tls" type="checkbox" checked={values.tls} onChange={e=>change('tls',e.target.checked)}/>{ui('\u542f\u7528 TLS \u5e76\u9a8c\u8bc1\u8bc1\u4e66')}</label>
 <p className="help">{ui('\u6d4b\u8bd5\u4ec5\u8bfb\u53d6\u8fde\u901a\u72b6\u6001\u3001\u53ef\u8bbf\u95ee\u7684\u5e93\u548cschema\uff0c\u4e0d\u521b\u5efa\u5e93\u3001\u4e0d\u8fc1\u79fb\u6570\u636e\u3001\u4e0d\u542f\u7528\u4e1a\u52a1\u5b58\u50a8\u3002')}</p>
 <div className="form-actions"><button type="button" onClick={()=>void run('test')}>{ui(busy==='test'?'\u6b63\u5728\u6d4b\u8bd5\u2026':'\u6d4b\u8bd5\u8fde\u63a5 / Test')}</button><button type="submit" className="primary">{ui(busy==='save'?'\u6b63\u5728\u4fdd\u5b58\u2026':'\u4fdd\u5b58\u914d\u7f6e')}</button><button type="button" onClick={()=>{if(!dirty||confirm(ui('\u653e\u5f03\u672a\u4fdd\u5b58\u7684\u8fde\u63a5\u914d\u7f6e\uff1f')))onCancel()}}>{ui('\u53d6\u6d88')}</button></div>
 </fieldset></form>
 {error&&<ErrorBox message={error}/>}
 {result&&<div className="database-test-result" role="status"><strong>{ui('\u8fde\u63a5\u6210\u529f\uff08\u4ec5\u6d4b\u8bd5\uff09')}</strong><span>{result.database} / {result.schema} · {result.duration_ms} ms</span><small>{ui(result.schema_exists?'\u6240\u9009schema\u53ef\u8bbf\u95ee':'\u6240\u9009schema\u4e0d\u5b58\u5728\u6216\u5f53\u524d\u8d26\u53f7\u65e0\u6743\u8bbf\u95ee\uff0c\u8bf7\u4ece\u5217\u8868\u9009\u62e9')}</small></div>}
 </section>
}
