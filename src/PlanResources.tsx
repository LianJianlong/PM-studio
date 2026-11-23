import ColumnFilterButton from './ColumnFilterButton';
import {emptyColumnFilters,matchesColumnFilters,type ColumnFilters} from '../shared/column-filters';
import CostManagementPanel from './CostManagementPanel';
import ResourceTimeCurves from './ResourceTimeCurves';
import SheetScrollSpace from "./SheetScrollSpace";
import SheetNavigation from "./SheetNavigation";
import ResourceTransfer from "./ResourceTransfer";
import GridColumnMenu from "./GridColumnMenu";
import {Plus,PenLine,Trash2} from "lucide-react";
import {useDismissColumnMenu} from "./useDismissColumnMenu";
import {Fragment} from 'react';
import RowInsertHandle from './RowInsertHandle';
import {resourceGridOrder,type ResourceGridField} from '../shared/resource-grid';
import NativeGridRow,{type NativeColumn} from './NativeGridRow';
import './table-overrides.css';
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
import { api, useApi, useApp, useRememberedState, Modal, Form, Field, ErrorBox, Empty, Confirm, ApproveDialog, } from "./lib";
import { resourceTicks, resourceText } from "../shared/resource-values";
const kinds: Record<string, string> = {
    human: "人力",
    equipment: "设备",
    material: "材料",
    expense: "费用",
};
export default function PlanResources({ mode, projectId, activities, resources:baseResources, canWrite, canCreate, canManage, error, reload, refreshResources, calendar, currency="CNY", }: {
    currency?:string;
    mode: "pool" | "load" | "cost";
    projectId: string;
    activities: any[];
    resources: any[];
    canWrite: boolean;
    canCreate: boolean;
    canManage: boolean;
    error?: string | null;
    reload: () => void;
    refreshResources:(onCommit:()=>void)=>Promise<unknown>;
    calendar: string;
}) {
    const { notify, boot } = useApp(), [assign, setAssign] = useState<any>(null), [curve, setCurve] = useState<any>(null), [remove, setRemove] = useState<any>(null), [proposal, setProposal] = useState<any>(null);
    const [loadBasis,setLoadBasis]=useState('planned'),[costOpen,setCostOpen]=useState(false);
    const scopedResources=mode==='pool'||mode==='load'&&loadBasis==='remaining'?baseResources.filter(r=>r.active!==false):baseResources;
    const resources=mode==='load'&&loadBasis==='remaining'?scopedResources.map(r=>({...r,curve:r.remaining_curve||[],total_quantity:r.remaining_total_quantity||'0.0000',peak:r.remaining_peak,overloaded_days:r.remaining_overloaded_days,activity_count:r.remaining_activity_count})):scopedResources;
    const [resourceTransfer,setResourceTransfer]=useState(false),[resourceImport,setResourceImport]=useState(false);
    const [inline,setInline]=useState<any>(null);
    const [codeSettings,setCodeSettings]=useState(false);
    const [resourceMenu,setResourceMenu]=useState('');
    const openColumnHeader=useDismissColumnMenu(!!resourceMenu,()=>setResourceMenu(''));
    const [resourceColumn,setResourceColumn]=useState<{anchor:string;side:'left'|'right'}|{key:string;label:string}|null>(null);
    const [deleteColumn,setDeleteColumn]=useState<NativeColumn|null>(null);
    const [selectedRows,setSelectedRows]=useState<string[]>([]);
    const [localColumnOrder,setLocalColumnOrder]=useRememberedState<string[]>(`resource-grid:${boot.user.id}:${projectId}:column-order`,[],true);
    const [dragKey,setDragKey]=useState('');
    const [resourceSort,setResourceSort]=useState<{key:string;direction:1|-1}|null>(null);
    const [resourceGroups,setResourceGroups]=useState<string[]>([]);
    const [poolFilters,setPoolFilters]=useState<ColumnFilters>(emptyColumnFilters);
    const settingsUrl=`/projects/${projectId}/planning-settings`;
    const {data:planningSettings}=useApi(mode==='pool'?settingsUrl:null,useApp().tick);
    const codeRule=planningSettings?.resource_code||{prefix:'RES-',start:1,step:1,width:3,fill_gaps:false};
    function openAssign(value: any) {
        setAssign({
            ...value,
            activity: value.activity ||
                activities.find((a: any) => a.id === value.activity_id) ||
                activities[0],
            _versions: Object.fromEntries(resources.flatMap((r: any) => (r.allocations || []).map((a: any) => [
                `${r.id}:${a.activity_id}`,
                a.version,
            ]))),
        });
    }
    const heading = { pool: "项目资源池", load: "资源负荷", cost: "费用明细" }[mode];
    const allocations = resources.flatMap((r) => (r.allocations || []).map((a: any) => ({
        ...a,
        resource: r,
        activity: activities.find((n) => n.id === a.activity_id),
    })));
    const total = (key: string) => resourceText(allocations.reduce((n, a) => n + resourceTicks(String(a[key] || "0")), 0n));
    const variance = (a: any) => {
        const n = resourceTicks(a.actual_cost) - resourceTicks(a.planned_cost);
        return (n < 0n ? "-" : "") + resourceText(n < 0n ? -n : n);
    };
    function exportCsv(){
      let headers:string[],rows:any[][];
      if(mode==='cost'){headers=['作业','资源','分配数量','实际填报工量','剩余工作量','实际加剩余预测工量','成本单价','持续工作日','完成率（%）','计划费用','已完预算费用（挣值）','剩余预算费用','实际费用','剩余资源预测费用','实际加剩余预测费用'];rows=allocations.map(a=>[a.activity?.name,a.resource.name,a.quantity,a.actual_units??'',a.remaining_units??'',a.forecast_total_units??'',a.resource.rate,a.activity?.duration,a.progress,a.planned_cost,a.earned_cost,a.remaining_cost,a.actual_cost,a.remaining_forecast_cost,a.forecast_total_cost]);}
      else if(mode==='load'){headers=['资源','单位','日期','数量','可用容量','超载',loadBasis==='remaining'?'剩余预测费用':'计划费用',...(loadBasis==='remaining'?[]:['实际费用（按计划时段分摊示意）'])];rows=resources.flatMap(r=>r.curve.map((d:any)=>[r.name,r.unit,d.date,d.quantity,d.available_capacity,d.overloaded?'Yes':'No',d.planned_cost,...(loadBasis==='remaining'?[]:[d.actual_cost])]));}
      else{headers=poolFields.filter(f=>f.key!=='currency').map(f=>f.label);rows=resources.map(r=>poolFields.filter(f=>f.key!=='currency').map(f=>poolValue(r,f.key)));}
      headers.push('币种');rows=rows.map((row,index)=>[...row,mode==='pool'?(resources[index]?.currency||currency):currency]);
      const cell=(v:any)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
      const content='\ufeff'+[headers.map(__ui),...rows].map(row=>row.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='project-'+mode+'.csv';a.click();URL.revokeObjectURL(url);
    }
    function exportResourceFile(){
      const data={format:'project-studio.resources.v1',rows:resources.map(r=>Object.fromEntries(['code','kind','name','unit','rate','capacity','productivity','configuration','currency','sale_rate','tax_rate','stock_quantity','productivity_unit','custom_values'].map(key=>[key,r[key]])))};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='project-resources.json';a.click();URL.revokeObjectURL(url);
    }
    const basePoolFields:NativeColumn[]=[{key:'code',label:__ui('资源编码')},{key:'name',label:__ui('资源名称'),required:true},{key:'kind',label:__ui('类型'),options:Object.entries(kinds).map(([value,label])=>({value,label:__ui(label)}))},{key:'unit',label:__ui('单位')},{key:'productivity',label:__ui('功效')},{key:'rate',label:__ui('单价')},{key:'capacity',label:__ui('日容量')},{key:'configuration',label:__ui('配置')},{key:'calendar',label:__ui('日历'),readonly:true},{key:'sale_rate',label:__ui('销售单价')},{key:'tax_rate',label:__ui('税率')},{key:'stock_quantity',label:__ui('库存数量')},{key:'productivity_unit',label:__ui('功效单位')},{key:'currency',label:__ui('币种')}];
    const customFields:ResourceGridField[]=planningSettings?.resource_columns||[];
    const allPoolFields=new Map<string,NativeColumn>([...basePoolFields,...customFields.map(f=>({key:f.key,label:f.label}))].map(f=>[f.key,f]));
    const naturalColumns=resourceGridOrder(customFields);
    const keys=localColumnOrder.filter(key=>allPoolFields.has(key));
    for(const key of naturalColumns)if(!keys.includes(key)){
      const prior=naturalColumns.slice(0,naturalColumns.indexOf(key)).reverse().find(k=>keys.includes(k));
      keys.splice(prior?keys.indexOf(prior)+1:0,0,key);
    }
    const poolFields=keys.map(key=>{
      const f=allPoolFields.get(key)!;return {...f,label:planningSettings?.resource_column_labels?.[key]||f.label};
    });
    const pickedRows=resources.filter(r=>selectedRows.includes(r.id));
    const picked=pickedRows.length===1?pickedRows[0]:undefined;
    const validGroups=resourceGroups.filter(key=>allPoolFields.has(key));
    const poolSort=resourceSort&&allPoolFields.has(resourceSort.key)?resourceSort:null;
    const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
    const numbers=new Set(['productivity','rate','capacity','sale_rate','tax_rate','stock_quantity']);
    function compareResource(a:any,b:any,key:string){
      const av=poolValue(a,key),bv=poolValue(b,key);
      if(numbers.has(key)){const x=resourceTicks(String(av==='—'?'0':av)),y=resourceTicks(String(bv==='—'?'0':bv));return x<y?-1:x>y?1:0}
      return collator.compare(String(av),String(bv));
    }
    const filterColumns=poolFields.map(f=>({id:f.key,name:f.label,type:numbers.has(f.key)?'decimal':f.options?'single_select':'text',options:f.options}));
    const filteredResources=mode==='pool'?resources.filter(r=>matchesColumnFilters({data:{...r,...r.custom_values,calendar}},filterColumns,poolFilters)):resources;
    const displayed=mode==='pool'&&(validGroups.length||poolSort)?[...filteredResources].sort((a,b)=>{
      for(const key of validGroups){const result=compareResource(a,b,key);if(result)return result;}
      return poolSort?compareResource(a,b,poolSort.key)*poolSort.direction:0;
    }):filteredResources;
    function poolValue(r:any,key:string){
      if(key==='calendar')return calendar;
      if(key==='kind')return __ui(kinds[r.kind]);
      return r.custom_values?.[key]??r[key]??(key==='currency'?currency:'—');
    }
    const resourceRow=(value:any,rowNumber?:number)=><NativeGridRow key={value.id||'new'} focusField={value._focusField} columns={poolFields} leadingCell={<td className="check-cell sheet-row-header">{rowNumber??"+"}</td>} initial={{kind:'human',rate:'0',capacity:'0',productivity:'0',sale_rate:'0',tax_rate:'0',stock_quantity:'0',productivity_unit:'',...value,...value.custom_values,calendar,currency:value.currency||currency}} onCancel={()=>setInline(null)} onSaved={async()=>{await refreshResources(()=>setInline(null))}} onWrite={(data,id,version)=>{const {_focusField,...values}=data;const body={...values,...(id?{version}:{}),insert_before:id?undefined:value.insert_before,custom_values:Object.fromEntries(customFields.map(f=>[f.key,String(data[f.key]??'')]))};for(const key of ['rate','capacity','productivity','sale_rate','tax_rate','stock_quantity'])body[key]=String(body[key]||'0');return api(`/projects/${projectId}/resources${id?'/'+id:''}`,id?'PUT':'POST',body)}}/>;
    return (<section className={"panel resource-load-panel spreadsheet-layout native-sheet"}>
      <div className="section-heading">
        <h3>{__ui(heading)} · {currency}</h3>
        <div className="row-actions">
          {mode==='cost'&&<button onClick={()=>setCostOpen(v=>!v)}>{__ui('单价版本与费用科目')}</button>}
          {mode==='load'&&<select aria-label={__ui('资源负荷口径')} value={loadBasis} onChange={e=>{setLoadBasis(e.target.value);setCurve(null)}}><option value='planned'>{__ui('计划负荷')}</option><option value='remaining'>{__ui('剩余预测负荷')}</option></select>}
          <button onClick={exportCsv}>{__ui('导出资源报表CSV')}</button>
          {mode==='pool'&&<button onClick={exportResourceFile}>{__ui('导出资源交换文件')}</button>}
          {mode==='pool'&&canCreate&&<button onClick={()=>setResourceImport(true)}>{__ui('导入资源交换文件')}</button>}
          {mode==='pool'&&canManage&&selectedRows.length>0&&<button onClick={()=>setResourceTransfer(true)}>{__ui('跨项目转移资源')}</button>}
          {mode==='pool'&&planningSettings?.can_manage&&<button onClick={()=>setCodeSettings(true)}>{__ui('资源编码规则')}</button>}

          {__ui(canWrite && (<button disabled={!resources.length || !activities.length} onClick={() => openAssign({})}>{__ui("分配资源到作业")}</button>))}
        </div>
      </div>
      {mode==='cost'&&costOpen&&<CostManagementPanel key={projectId}/>}
      {mode==='pool'&&<div className="data-toolbar">
        {canCreate&&<button className="primary" disabled={!!inline} onClick={()=>setInline({new:true})}><Plus size={16}/>{__ui('新增记录')}</button>}
        {canWrite&&<button disabled={!!inline||!picked} onClick={()=>setInline(picked)}><PenLine size={16}/>{__ui('编辑')}</button>}
        {canManage&&pickedRows.length>0&&<button className="danger" disabled={!!inline} onClick={()=>setRemove({resources:pickedRows.map(r=>({id:r.id,version:r.version}))})}><Trash2 size={16}/>{__uiFormat('删除行（{0}）',[pickedRows.length])}</button>}
        {planningSettings?.can_manage&&<button disabled={!!inline} onClick={()=>setResourceColumn({anchor:poolFields.at(-1)!.key,side:'right'})}>{__ui('新增字段')}</button>}
        <ColumnFilterButton columns={filterColumns} value={poolFilters} disabled={!!inline} onChange={v=>{setPoolFilters(v);setSelectedRows([])}}/>
        {validGroups.length>0&&<button disabled={!!inline} onClick={()=>{setResourceGroups([]);setSelectedRows([])}}>{__ui('取消归类')}</button>}
        {poolSort&&<button disabled={!!inline} onClick={()=>{setResourceSort(null);setSelectedRows([])}}>{__ui('取消排序')}</button>}
      </div>}
      {resourceTransfer&&<ResourceTransfer source={projectId} ids={selectedRows} onClose={()=>setResourceTransfer(false)}/>}
      {resourceImport&&<Modal title={__ui('导入资源交换文件')} onClose={()=>setResourceImport(false)}><Form onClose={()=>setResourceImport(false)} submit="导入" onSubmit={async d=>{
        const file=d.get('file');if(!(file instanceof File)||!file.size||file.size>4*1024*1024)throw Error(__ui('请选择 4 MB 以内的资源文件'));
        const content=JSON.parse(await file.text());if(content.format!=='project-studio.resources.v1'||!Array.isArray(content.rows))throw Error(__ui('请选择本软件导出的资源交换文件'));
        const rows=content.rows.map((r:any)=>({...r,...d.get('recode')==='on'?{code:''}:{}}));
        const result=await api(`/projects/${projectId}/resources/import`,'POST',{rows});notify(__uiFormat('已导入 {0} 项资源',[result.count]));setResourceImport(false);reload();
      }}><Field label={__ui('资源交换文件')}><input name="file" type="file" accept=".json,application/json" required/></Field><label className="checkbox-label"><input name="recode" type="checkbox"/>{__ui('重新生成资源编码')}</label></Form></Modal>}
      {resourceColumn&&<Modal title={__ui('key' in resourceColumn?'修改列':resourceColumn.side==='left'?'左侧插入列':'右侧插入列')} onClose={()=>setResourceColumn(null)}>
        <Form onClose={()=>setResourceColumn(null)} onSubmit={async d=>{
          const label=String(d.get('label'));
          await api(settingsUrl,'PUT','key' in resourceColumn?{kind:'resource_column_rename',key:resourceColumn.key,label}:{kind:'resource_column',...resourceColumn,label});
          setResourceColumn(null);reload();
        }}><Field label={__ui('字段名称')}><input name="label" required maxLength={120} defaultValue={'key' in resourceColumn?resourceColumn.label:''}/></Field></Form>
      </Modal>}
      {deleteColumn&&<Confirm title={__ui('删除列')} detail={deleteColumn.label} onClose={()=>setDeleteColumn(null)} onConfirm={async()=>{
        await api(settingsUrl,'PUT',{kind:'resource_column_delete',key:deleteColumn.key});setDeleteColumn(null);reload();
      }}/>}
      {codeSettings&&<Modal title={__ui('资源编码规则')} onClose={()=>setCodeSettings(false)}>
        <Form onClose={()=>setCodeSettings(false)} onSubmit={async d=>{await api(settingsUrl,'PUT',{kind:'resource_code',prefix:String(d.get('prefix')||''),start:Number(d.get('start')),step:Number(d.get('step')),width:Number(d.get('width')),fill_gaps:d.get('fill_gaps')==='on'});setCodeSettings(false);reload()}}>
          <Field label={__ui('编码前缀')}><input name="prefix" maxLength={20} defaultValue={codeRule.prefix}/></Field>
          <Field label={__ui('起始数字')}><input name="start" type="number" min={1} max={999999999999} required defaultValue={codeRule.start}/></Field>
          <Field label={__ui('自增间隔')}><input name="step" type="number" min={1} max={9999999} required defaultValue={codeRule.step}/></Field>
          <Field label={__ui('数字最少位数')}><input name="width" type="number" min={1} max={12} required defaultValue={codeRule.width}/></Field>
          <label className="checkbox-label"><input name="fill_gaps" type="checkbox" defaultChecked={codeRule.fill_gaps}/>{__ui('优先填补未使用的空号')}</label>
          <p className="help">{__ui('新增资源时留空自动生成，也可手工填写。修改规则只影响后续生成的编码。')}</p>
        </Form>
      </Modal>}
      <p className="help">{__ui("资源与项目共用“")}{__ui(calendar)}{__ui("”日历；功效和配置用于资源描述，工期仍由作业数据确定。负荷及费用只分摊至作业的工作日期。")}</p>
      {__ui(error && <ErrorBox message={__ui(error)}/>)}
      <div className="grid-scroll" onClick={e=>{if(e.target===e.currentTarget&&mode==="pool"&&canCreate&&!inline)setInline({new:true})}}>
        {__ui(mode === "cost" ? (<>
            <p className="help">{__ui("计划费用＝单价×分配数量×持续工作日")} · {__ui("已完预算费用＝计划费用×完成率；剩余预算费用＝计划费用－已完预算费用。实际费用按实际录入。")} · {__ui('剩余预测费用采用剩余投入率×剩余工期×当前单价，仅覆盖已登记的资源费用。')}</p>
            <p>{__ui("计划费用")}{__ui(total("planned_cost"))}{__ui(" · 已完预算费用（挣值） ")}{__ui(total("earned_cost"))}{__ui(" · 剩余预算费用 ")}{__ui(total("remaining_cost"))}{__ui(" · 实际费用 ")}{__ui(total("actual_cost"))} · {__ui("剩余资源预测费用")} {total("remaining_forecast_cost")} · {__ui("实际加剩余预测费用")} {total("forecast_total_cost")}
            </p>
            <table className="data-grid">
              <thead>
                <tr>
                  <th>{__ui("作业")}</th>
                  <th>{__ui("资源")}</th>
                  <th>{__ui("数量")}</th><th>{__ui("实际填报工量")}</th><th>{__ui("剩余工作量")}</th><th>{__ui("实际加剩余预测工量")}</th>
                  <th>{__ui("单价")}</th>
                  <th>{__ui("持续工作日")}</th>
                  <th>{__ui("完成率（%）")}</th>
                  <th>{__ui("计划费用")}</th>
                  <th>{__ui("已完预算费用（挣值）")}</th>
                  <th>{__ui("剩余预算费用")}</th>
                  <th>{__ui("实际费用")}</th>
                  <th>{__ui("剩余资源预测费用")}</th><th>{__ui("实际加剩余预测费用")}</th><th>{__ui("差额（实际-计划）")}</th>
                  <th>{__ui("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {__ui(allocations.map((a) => (<tr key={a.id}>
                    <td>
                      {__ui(a.activity?.code)} · {a.activity?.name}
                    </td>
                    <td>{a.resource.code} · {a.resource.name}{a.resource.active===false?' · '+__ui('已停用'):''}</td>
                    <td>{__ui(a.quantity)}</td><td>{a.actual_units??'—'}</td><td>{a.remaining_units??'—'}</td><td>{a.forecast_total_units??'—'}</td>
                    <td>{__ui(a.resource.rate)}</td>
                    <td>{__ui(a.activity?.duration??0)}</td>
                    <td>{__ui(a.progress??0)}%</td>
                    <td>{__ui(a.planned_cost)}</td>
                    <td>{__ui(a.earned_cost)}</td>
                    <td>{__ui(a.remaining_cost)}</td>
                    <td>{__ui(a.actual_cost)}</td>
                    <td>{a.remaining_forecast_cost??'—'}</td><td>{a.forecast_total_cost??'—'}</td><td>{__ui(variance(a))}</td>
                    <td>
                      {__ui(canWrite && a.resource.active!==false && (<button onClick={() => openAssign({ ...a, id: a.resource.id })}>{__ui("编辑分配")}</button>))}
                      {__ui(canManage && a.resource.active!==false && (<button onClick={() => setProposal({
                        action: "delete",
                        activity_id: a.activity_id,
                        resource_id: a.resource.id,
                        version: a.version,
                        reason: "申请删除资源分配",
                    })}>{__ui("申请删除")}</button>))}
                      {__ui(canManage && (<button onClick={() => setRemove({ allocation: a })}>{__ui("删除分配")}</button>))}
                    </td>
                  </tr>)))}
              </tbody>
            </table>
          </>) : (<table className="data-grid resource-table" data-stable-grid={mode==="pool"?"":undefined} data-style-key={mode==="pool"?"plan-resource-pool":undefined}>
            <thead>
              <tr>
                {mode==='pool'&&<th className="check-cell" data-style-column="__row"><input type="checkbox" aria-label={__ui('选择本页')} checked={displayed.length>0&&displayed.every(r=>selectedRows.includes(r.id))} disabled={!!inline} onChange={e=>setSelectedRows(e.target.checked?displayed.map(r=>r.id):[])}/></th>}
                {mode==='pool'?poolFields.map(f=><th key={f.key} data-style-column={f.key} className="resource-column-header" ref={resourceMenu===f.key?openColumnHeader:undefined}
                  draggable={!inline} onDragStart={()=>setDragKey(f.key)} onDragOver={e=>e.preventDefault()} onDrop={()=>{
                    if(!dragKey||dragKey===f.key||inline)return;
                    const next=poolFields.map(col=>col.key),from=next.indexOf(dragKey),to=next.indexOf(f.key);
                    if(from>=0){next.splice(from,1);next.splice(to,0,dragKey);setLocalColumnOrder(next);}setDragKey('');
                  }}>
                  <button type="button" disabled={!!inline} onClick={()=>setResourceMenu(resourceMenu===f.key?'':f.key)}>{f.label}<span className="column-menu-arrow" aria-hidden="true"/></button>
                  {resourceMenu===f.key&&<GridColumnMenu
                    onSort={direction=>{setResourceSort({key:f.key,direction});setResourceMenu('');setSelectedRows([])}}
                    onGroup={()=>{setResourceGroups(v=>v.includes(f.key)?v:[...v,f.key].slice(0,3));setResourceMenu('');setSelectedRows([])}}
                    onInsert={planningSettings?.can_manage?side=>{setResourceColumn({anchor:f.key,side});setResourceMenu('')}:undefined}
                    onEdit={planningSettings?.can_manage?()=>{setResourceColumn({key:f.key,label:f.label});setResourceMenu('')}:undefined}
                    onDelete={planningSettings?.can_manage&&customFields.some(col=>col.key===f.key)?()=>{setDeleteColumn(f);setResourceMenu('')}:undefined}/>}
                </th>):<>
                  <th>{__ui('资源编码')}</th><th>{__ui('资源名称')}</th><th>{__ui('类型')}</th><th>{__ui('单位')}</th>
                  <th>{__ui(loadBasis==='remaining'?'剩余工作量':'累计工量')}</th><th>{__ui('实际工量（已报部分）')}</th><th>{__ui('未报实际工量项数')}</th><th>{__ui('日容量')}</th><th>{__ui('超载天数')}</th><th>{__ui('作业数')}</th>
                </>}
                <th>{__ui("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((r,index)=><Fragment key={r.id}>
                {mode==='pool'&&validGroups.length>0&&(index===0||validGroups.some(key=>compareResource(displayed[index-1],r,key)!==0))&&<tr className="group-row"><td colSpan={poolFields.length+2}>{validGroups.map(key=>String(poolValue(r,key))).join(' / ')}</td></tr>}
                {mode==='pool'&&inline?.new&&inline.insert_before===r.id&&resourceRow(inline)}
                {mode==='pool'&&inline?.id===r.id?resourceRow(inline,index+1):<tr data-sheet-record={r.id} className={selectedRows.includes(r.id)?'selected':''}>
                  {mode==='pool'&&<td className="check-cell sheet-row-header">
                    {canCreate&&!inline&&<RowInsertHandle onInsert={()=>setInline({new:true,insert_before:r.id})}/>}
                    <span className="sheet-row-number" aria-hidden="true">{index+1}</span>
                    <input type="checkbox" aria-label={__uiFormat('选择记录 {0}',[r.code||r.name])} checked={selectedRows.includes(r.id)} disabled={!!inline} onChange={e=>setSelectedRows(rows=>e.target.checked?[...rows,r.id]:rows.filter(id=>id!==r.id))}/>
                  </td>}
                  {mode==='pool'?poolFields.map(f=><td key={f.key} data-sheet-field={f.key} tabIndex={0} data-label={f.label} onDoubleClick={()=>{if(canWrite&&!inline&&!f.readonly)setInline({...r,_focusField:f.key})}}>{poolValue(r,f.key)}
                  </td>):<>
                    <td>{r.code||'—'}</td><td>{r.name} · {r.currency||currency}</td><td>{__ui(kinds[r.kind])}</td><td>{r.unit||'—'}</td>
                    <td>{r.total_quantity}</td><td>{r.actual_total_units??'—'}</td><td>{r.actual_unreported_count??0}</td><td>{r.capacity}</td><td className={r.overloaded_days?'red-text':''}>{r.overloaded_days}</td><td>{r.activity_count}</td>
                  </>}
                  <td data-label={__ui("操作")}>
                    <div className="row-actions">
                      {__ui(mode === "load" && (<button onClick={() => setCurve(r)}>{__ui("查看曲线")}</button>))}
                      {__ui(canWrite && r.active!==false && (<button onClick={() => openAssign({ id: r.id })}>{__ui("分配到作业")}</button>))}
                    </div>
                  </td>
                </tr>}</Fragment>)}
              {mode==='pool'&&inline?.new&&!inline.insert_before&&resourceRow(inline)}
              {mode==='pool'&&canCreate&&!inline?.new&&<tr className="record-add-space" onClick={()=>{if(!inline)setInline({new:true})}}><td colSpan={poolFields.length+2}><button type="button">{__ui('点击此处新增...')}</button></td></tr>}
            </tbody>
          </table>))}
        {mode==='load'&&loadBasis==='remaining'&&resources.some(r=>Number(r.remaining_unplaced_quantity)>0)&&<p className='help'>{__ui('部分剩余工作受强制日期约束，未排入负荷曲线；剩余工量和费用仍保留，请核对排程检查。')}</p>}
      {mode==='load'&&<p className='help'>{__ui(loadBasis==='remaining'?'剩余预测按项目状态日期或今天排布，不代表已发生工量；实际费用不分摊到未来。':'计划负荷使用原计划分配量；查看剩余投入调整请切换到剩余预测负荷。')}</p>}
      {mode==="pool"&&<><SheetScrollSpace/><SheetNavigation/></>}
      </div>
      {__ui(!resources.length && <Empty text={__ui("请在资源池新增资源，再分配到作业")}/>)}
      {curve&&mode==='load'&&<ResourceTimeCurves key={projectId+':'+curve.id} projectId={projectId} initialResource={curve.id} onClose={()=>setCurve(null)}/>}
      {__ui(assign && (<Modal title={__ui("分配资源到作业")} onClose={() => setAssign(null)}>
          <Form submit="保存分配" onClose={() => setAssign(null)} onSubmit={async (d) => {
                const payload = {
                    resource_id: String(d.get("resource_id")),
                    activity_id: String(d.get("activity_id")),
                    version: assign._versions[`${d.get("resource_id")}:${d.get("activity_id")}`] ?? 0,
                    quantity: String(d.get("quantity")),
                    ...(d.get("planned_cost")
                        ? { planned_cost: String(d.get("planned_cost")) }
                        : {}),
                    actual_cost: String(d.get("actual_cost") || "0"),
                    reason: String(d.get("reason") || ""),
                };
                if (d.get("approval")) {
                    if (!payload.reason.trim())
                        throw Error("请先填写变更说明");
                    setProposal(payload);
                    setAssign(null);
                    return;
                }
                await api(`/activities/${d.get("activity_id")}/resources`, "POST", {
                    ...payload,
                });
                setAssign(null);
                setCurve(null);
                reload();
                notify("资源分配已保存");
            }}>
            <Field label={__ui("项目资源")}>
              {__ui(assign.activity_id && (<input type="hidden" name="resource_id" value={assign.id}/>))}
              <select name={assign.activity_id ? undefined : "resource_id"} disabled={!!assign.activity_id} defaultValue={assign.id || resources[0]?.id}>
                {__ui(resources.map((r) => (<option key={r.id} value={r.id}>
                    {r.name} · {r.currency||"CNY"}
                  </option>)))}
              </select>
            </Field>
            <Field label={__ui("计划作业")}>
              {__ui(assign.activity_id && (<input type="hidden" name="activity_id" value={assign.activity_id}/>))}
              <select name={assign.activity_id ? undefined : "activity_id"} disabled={!!assign.activity_id} defaultValue={assign.activity_id || activities[0]?.id}>
                {__ui(activities.map((a) => (<option key={a.id} value={a.id}>
                    {__ui(a.code)} · {a.name}
                  </option>)))}
              </select>
            </Field>
            {__ui([
                ["quantity", "每日分配数量"],
                
                ["actual_cost", "实际费用"],
            ].map(([key, name]) => (<Field key={key} label={__ui(name)}>
                <input name={key} required={key === "quantity"} type="number" min="0" step="0.0001" defaultValue={assign[key] || ""}/>
              </Field>)))}
            <p className="help">{__ui("计划费用＝单价×分配数量×持续工作日，按作业工期自动计算；非工作日不计入持续时长。修改工期、单价或数量后自动重算，实际费用仍按录入值汇总。")}</p>
            <p className="help">{__ui("日容量为0表示未设置容量，不据此判定超载。")}</p>
            <><Field label={__ui("变更说明")}>
              <textarea name="reason" maxLength={1000} placeholder={__ui("正式作业的资源费用变更须填写说明并提交审批")}/>
            </Field>
            <label className="checkbox-label">
              <input type="checkbox" name="approval" defaultChecked={!boot.user.system_admin &&
                assign.activity?.record_status === 'approved'}/>{__ui("提交资源费用变更审批")}</label>
            <p className="help">{__ui("已核准作业须通过审批后生效；superadmin可直接调整并保留审计。版本冲突时请刷新重新编辑。")}</p></>
          </Form>
        </Modal>))}
      {__ui(remove && (<Confirm title={__ui(remove.resources ? "停用资源" : "删除分配")} detail={remove.resources
                ? __uiFormat("确认停用所选 {0} 条资源？任何一条仍有作业分配时，整批不予停用。",[remove.resources.length])
                : __ui("删除后负荷和费用将重新汇总。")} onClose={() => setRemove(null)} onConfirm={async () => {
                if(remove.resources)await api(`/projects/${projectId}/resources/batch-deactivate`,"POST",{records:remove.resources});
                else await api(`/activity-resources/${remove.allocation.id}`, "DELETE", {version:remove.allocation.version,reason:"删除资源分配"});
                setRemove(null);setSelectedRows([]);
                setCurve(null);
                reload();
            }}/>))}
      {__ui(proposal && (<ApproveDialog kind="resource" title={__ui("资源费用变更")} payload={proposal} onClose={() => {
                setProposal(null);
                reload();
            }}/>))}
    </section>);
}
