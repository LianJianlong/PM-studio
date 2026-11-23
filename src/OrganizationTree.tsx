import OrganizationPerson,{safePersonPhoto} from './OrganizationPerson';
import {useState} from 'react';
import {Plus,Minus,PenLine,Trash2,UserRound,Settings2} from 'lucide-react';
import {RecordGrid} from './DataCenter';
import {ValueEditor} from './FieldControls';
import {inputValue,isSystemField} from '../shared/fields';
import {api,useApi,useApp,useRememberedState,Loading,ErrorBox,Empty,Modal,Form,Field,Confirm} from './lib';
import {translateUiValue as ui,formatUiTemplate as fmt} from './i18n';
import './organization-tree.css';

export default function OrganizationTree({table}:{table:any}){
 const {project,boot,tick,notify,reload}=useApp(),base=`/projects/${project.id}/organization-tree`;
 const [view,setView]=useRememberedState(`organization-view:${boot.user.id}:${project.id}`,'tree');
 const {data,error,refresh}=useApi<any>(view==='tree'?base:null,tick);
 const {data:rosterData,refresh:refreshRoster}=useApi<any>(`/projects/${project.id}/organization-roster`,tick);
 const [personEdit,setPersonEdit]=useState<any>(null),[configure,setConfigure]=useState(false);
 const [folded,setFolded]=useRememberedState<string[]>(`organization-folded:${boot.user.id}:${project.id}`,[]);
 const [edit,setEdit]=useState<any>(null),[remove,setRemove]=useState<any>(null),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false),[drag,setDrag]=useState(''),[over,setOver]=useState('');
 const rows:any[]=data?.rows||[],byId=new Map(rows.map(r=>[r.id,r]));
 const parentVisible=table.columns.some((f:any)=>f.id==='parent'&&f.lifecycle!=='deleted');
 const fields=table.columns.filter((f:any)=>!isSystemField(f)&&f.type!=='formula'&&f.type!=='backlink'&&f.id!=='parent'&&(!f.lifecycle||f.lifecycle==='active'));
 const childrenByParent=new Map<string,any[]>();
 for(const row of rows){const key=parentVisible?row.data.parent?.[0]:'';const children=childrenByParent.get(key)||[];children.push(row);childrenByParent.set(key,children);}
 const roots=rows.filter(r=>!parentVisible||!byId.has(r.data.parent?.[0]));
 function descendant(node:string,parent:string){
  const visited=new Set<string>();
  while(parent&&byId.has(parent)&&!visited.has(parent)){
   if(parent===node)return true;visited.add(parent);parent=byId.get(parent).data.parent?.[0];
  }
  return false;
 }
 async function move(node:string,parent:string){
  if(busy||node===parent)return;
  const row=byId.get(node);
  if(!row?.can_edit||!parentVisible||row.references?.parent?.restricted)return;
  if(descendant(node,parent)){setFailure(ui('不能将岗位移到自己的下级'));return;}
  if((row.data.parent?.[0]||'')===parent)return;
  setBusy(true);setFailure('');
  try{
   await api(`/records/${node}`,'PUT',{data:{parent:parent?[parent]:[]},version:row.version});
   await refresh();setFolded(v=>v.filter(id=>id!==parent));notify(ui('岗位层级已更新'));
  }catch(e){setFailure((e as Error).message)}finally{setBusy(false);setDrag('');setOver('')}
 }
 function drop(parent:string,e:React.DragEvent){
  e.preventDefault();e.stopPropagation();const node=e.dataTransfer.getData('application/project-studio-position');
  if(node&&node===drag)void move(node,parent);
 }
 function nextCode(){
  const greatest=Math.max(0,...rows.map(r=>/^ORG-(\d+)$/.exec(String(r.data.code||''))).filter(Boolean).map(m=>Number(m![1])));
  return 'ORG-'+String(greatest+1).padStart(3,'0');
 }
 function renderNode(row:any,path:Set<string>){
  if(path.has(row.id))return null;
  const chain=new Set([...path,row.id]),children=parentVisible?(childrenByParent.get(row.id)||[]):[],collapsed=folded.includes(row.id);
  return <li key={row.id} role="treeitem" aria-label={row.data.name||ui('岗位')} aria-expanded={children.length?!collapsed:undefined}>
   <div className={'organization-node'+(over===row.id?' drop-target':'')} data-org-node={row.id}
    draggable={!busy&&row.can_edit&&parentVisible&&!row.references?.parent?.restricted}
    onDragStart={e=>{e.dataTransfer.setData('application/project-studio-position',row.id);e.dataTransfer.effectAllowed='move';setDrag(row.id)}}
    onDragEnd={()=>{setDrag('');setOver('')}}
    onDragOver={e=>{if(drag&&drag!==row.id){e.preventDefault();e.stopPropagation();setOver(row.id)}}}
    onDragLeave={()=>setOver(v=>v===row.id?'':v)} onDrop={e=>drop(row.id,e)}>
    <div className="organization-node-title">
     {!!children.length&&<button type="button" className="icon-button" aria-label={fmt(collapsed?'展开 {0}':'折叠 {0}',[row.data.name])} onClick={()=>setFolded(v=>collapsed?v.filter(id=>id!==row.id):[...v,row.id])}>{collapsed?<Plus size={13}/>:<Minus size={13}/>}</button>}
     <strong>{row.data.name||ui('名称不可见')}</strong>
    </div>
    {row.data.code&&<small>{ui('岗位编码')}：{row.data.code}</small>}
    <div className="organization-person">
      {safePersonPhoto(row.person?.values.photo)?<img className="organization-person-photo" draggable={false} src={safePersonPhoto(row.person.values.photo)} alt={ui('人员照片')}/>:<span className="organization-person-placeholder" aria-label={ui('暂无照片')}><UserRound size={27}/></span>}
      <div className="organization-person-details">
       <strong>{row.person?.values.name||(!row.data.person_ref?.length?row.data.owner:null)||ui(row.references?.person_ref?.restricted?'人员信息受限':'未关联人员')}</strong>
       {row.person?.values.employee_no&&<small>{ui('人员编码')}：{row.person.values.employee_no}</small>}
       {row.person?.values.position&&<span>{ui('职位')}：{row.person.values.position}</span>}
      </div>
    </div>
    <dl className="organization-person-contact">
      <div><dt>{ui('电话')}</dt><dd>{row.person?.values.phone||'—'}</dd></div>
      <div><dt>{ui('邮箱')}</dt><dd>{row.person?.values.email||'—'}</dd></div>
    </dl>
    {row.data.description&&<p title={row.data.description}>{row.data.description}</p>}
    <div className="organization-node-actions">
     <span className={'status '+row.status}>{ui(({draft:'草稿',approved:'有效',pending:'待审批',rejected:'退回'} as any)[row.status]||row.status)}</span>
     {data?.can_create&&parentVisible&&<button type="button" disabled={busy} className="icon-button" aria-label={fmt('在 {0} 下新增岗位',[row.data.name])} onClick={()=>setEdit({parent:row.id})}><Plus size={14}/></button>}
     {row.person?.can_edit&&<button type="button" disabled={busy} className="icon-button" aria-label={fmt('编辑人员资料 {0}',[row.person.values.name||row.data.name])} onClick={()=>setPersonEdit(row.person)}><UserRound size={14}/></button>}
     {row.can_edit&&<button type="button" disabled={busy} className="icon-button" aria-label={fmt('编辑岗位 {0}',[row.data.name])} onClick={()=>setEdit({row,parent:row.data.parent?.[0]||''})}><PenLine size={14}/></button>}
     <button type="button" disabled={busy||!row.can_remove} className="icon-button danger" aria-label={fmt('移除岗位 {0}',[row.data.name])} title={ui(row.has_children?'请先调整下级岗位，再移除此岗位':'移除岗位')} onClick={()=>setRemove(row)}><Trash2 size={14}/></button>
    </div>
   </div>
   {!!children.length&&!collapsed&&<ul role="group">{children.map(child=>renderNode(child,chain))}</ul>}
  </li>;
 }
 return <section className="organization-workbench">
  <div className="sheet-heading"><h3>{ui('组织架构')}</h3><div className="program-tabs"><button className={view==='tree'?'active':''} onClick={()=>setView('tree')}>{ui('树状图')}</button><button className={view==='table'?'active':''} onClick={()=>setView('table')}>{ui('数据表')}</button>{rosterData?.table&&<button className={view==='roster'?'active':''} onClick={()=>setView('roster')}>{ui('人员花名册')}</button>}</div></div>
  {error&&<ErrorBox message={ui(error)}/>}
  {failure&&<ErrorBox message={ui(failure)}/>}
  {view==='roster'?(rosterData?.table?<RecordGrid key={rosterData.table.id} table={rosterData.table} mode="entry"/>:<Loading/>):view==='table'?<RecordGrid key={table.id} table={table} mode="entry"/>:!data?<Loading/>:<>
   <div className="data-toolbar">
    {data.can_create&&<button className="primary" disabled={busy} onClick={()=>setEdit({parent:''})}><Plus size={14}/>{ui('新增顶级岗位')}</button>}
    {rosterData?.can_configure&&<button disabled={busy} onClick={()=>setConfigure(true)}><Settings2 size={14}/>{ui('关联花名册')}</button>}
    <button onClick={()=>setFolded([])}>{ui('全部展开')}</button><button onClick={()=>setFolded(rows.filter(r=>r.has_children).map(r=>r.id))}>{ui('全部折叠')}</button>
    <span className="help">{ui('将岗位拖到另一岗位上，调整上下级；拖到顶层区域恢复为顶级岗位。')}</span>
   </div>
   <div className={'organization-root-drop'+(over==='root'?' drop-target':'')} onDragOver={e=>{if(drag){e.preventDefault();setOver('root')}}} onDrop={e=>drop('',e)}>{ui('顶级岗位区域')}</div>
   <div className="organization-tree-scroll"><ul className="organization-tree" role="tree" aria-label={ui('项目组织架构')}>{roots.map(row=>renderNode(row,new Set()))}</ul>{!rows.length&&<Empty text={ui('点击新增顶级岗位建立组织架构')}/>}</div>
  </>}
  {edit&&<Modal title={ui(edit.row?'编辑岗位':'新增岗位')} onClose={()=>setEdit(null)}>
   <Form onClose={()=>setEdit(null)} onSubmit={async form=>{
    const value:Record<string,unknown>={};
    for(const field of fields){if(edit.row?.references?.[field.id]?.restricted)continue;value[field.id]=field.type==='multi_select'?form.getAll(field.id).map(String):inputValue(field,String(form.get(field.id)??''));}
    if(Array.isArray(value.person_ref)&&value.person_ref.length>1)throw Error(ui('每个岗位只能关联一名花名册人员'));
    if(parentVisible&&!edit.row?.references?.parent?.restricted)value.parent=String(form.get('org_parent')||'')?[String(form.get('org_parent'))]:[];
    if(edit.row)await api(`/records/${edit.row.id}`,'PUT',{data:value,version:edit.row.version});
    else await api(`/tables/${table.id}/records`,'POST',{data:value});
    await refresh();if(edit.parent)setFolded(v=>v.filter(id=>id!==edit.parent));setEdit(null);notify(ui('岗位已保存'));
   }}>
    {fields.map((field:any)=><Field key={field.id} label={field.name+(field.required&&!field.auto_code?' *':'')}><ValueEditor field={field} tableId={table.id} value={edit.row?.data[field.id]??(field.id==='code'&&!field.auto_code?nextCode():null)} reference={edit.row?.references?.[field.id]}/></Field>)}
    {parentVisible&&<Field label={ui('上级岗位')}><select name="org_parent" defaultValue={edit.parent} disabled={!!edit.row?.references?.parent?.restricted}><option value="">{ui('顶级岗位')}</option>{rows.filter(r=>!edit.row||!descendant(edit.row.id,r.id)).map(r=><option key={r.id} value={r.id}>{r.data.code} · {r.data.name}</option>)}</select></Field>}
   </Form>
  </Modal>}
  {personEdit&&<OrganizationPerson person={personEdit} onClose={()=>setPersonEdit(null)} onSaved={async()=>{await refresh();notify(ui('人员资料已同步至花名册'))}}/>}
  {configure&&<Modal title={ui('关联人员花名册')} onClose={()=>setConfigure(false)}>
   <Form onClose={()=>setConfigure(false)} onSubmit={async form=>{
    const key=String(form.get('roster')||'');
    await api(`/projects/${project.id}/organization-roster`,'PUT',key?{table_id:key}:{});
    await refreshRoster();await refresh();reload();setConfigure(false);notify(ui('花名册关联已更新'));
   }}>
    <Field label={ui('人员数据表')}><select name="roster" defaultValue={rosterData?.table?.id||''}><option value="">{ui('自动选择或创建人员花名册')}</option>{rosterData?.candidates?.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
    <p className="help">{ui('只关联当前项目人员；电话、邮箱、照片等缺少的字段会自动补齐，已有内容保留。已有人员关联时，需先解除后才能更换来源。')}</p>
   </Form>
  </Modal>}
  {remove&&<Confirm title={ui('移除岗位')} detail={fmt('移除「{0}」？有效岗位将作废，草稿移入回收站，历史数据保留。',[remove.data.name])} onClose={()=>setRemove(null)} onConfirm={async()=>{
   await api(base+'/'+remove.id+'/remove','POST',{version:remove.version});await refresh();setRemove(null);notify(ui('岗位已移除'));
  }}/>}
 </section>;
}
