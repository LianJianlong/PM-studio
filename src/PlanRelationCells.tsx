import ActivityResourceCell from "./ActivityResourceCell";
import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, Field, Form, Modal, useApp } from './lib';
import { activityRelations, relationColumns, planComputedColumns, relationInterval } from '../shared/plan-relations';
import './plan-relations.css';
export function PlanRelationCells({ record, context, onResourceChange }: any) {
    const [editor, setEditor] = useState<any>(null);
    const choicesId=useId();
    const { reload, notify } = useApp();
    const activities = context?.activities || [];
    const current = activities.find((a: any) => a.record_id === record?.id);
    const edges = current ? activityRelations(current.id, activities) : [];
    const label = (a: any) => a?.record_id ? `${a.code} · ${a.name}` : '不可见作业';
    function open(edge?: any, direction='前置') {
        if (!current?.custom_editable && !edge?.editable)
            return;
        setEditor(edge ? { ...edge, existing: true, mode: edge.lag < 0 ? 'lead' : edge.lag > 0 ? 'lag' : 'none', days: Math.abs(edge.lag) } :
            { direction, otherId: '', query: '', type: 'FS', mode: 'none', days: 0, existing: false });
    }
    return <>
    {relationColumns.map(column => {
      const shown=column.id==='predecessors'?edges.filter(edge=>edge.direction==='前置'):column.id==='successors'?edges.filter(edge=>edge.direction==='后置'):edges;
      const text=(edge:any)=>column.id==='predecessors'||column.id==='successors'?label(edge.other):column.id==='type'?`${__ui(edge.direction)} ${edge.type}`:String(column.id==='lead'?Math.max(0,-edge.lag):Math.max(0,edge.lag));
      return <td key={column.id} className="plan-relation-cell" tabIndex={0} title={shown.map(text).join('；')||__ui('双击新增逻辑关系')} onDoubleClick={e=>{e.stopPropagation();open(undefined,column.id==='successors'?'后置':'前置')}} onKeyDown={e=>{if(e.key==='Enter'&&e.target===e.currentTarget){e.preventDefault();open(undefined,column.id==='successors'?'后置':'前置')}}}>
        <div className="plan-relation-line">{shown.length?shown.map(edge=><button type="button" key={`${edge.predecessor}:${edge.successor}`} disabled={!edge.editable} onClick={e=>{e.stopPropagation();open(edge)}} title={__uiFormat("{0}：{1} · {2} · {3} {4} 工作日",[__ui(edge.direction),label(edge.other),edge.type,edge.lag<0?__ui('提前'):__ui('滞后'),Math.abs(edge.lag)])}>{text(edge)}</button>):<span className="muted">—</span>}</div>
      </td>;
    })}
    {planComputedColumns.map(column=><td key={column.id} className="plan-float-cell numeric" tabIndex={0} title={__ui(column.description)+(current?.metrics?__ui('预排指标，正式资源费用仍仅使用有效数据。'):__ui('完整可见依赖链建立后参与预排。'))} onDoubleClick={e=>e.stopPropagation()}>{current?.metrics?.[column.id]!=null?Number(current.metrics[column.id].toFixed(4)):'—'}</td>)}
    <ActivityResourceCell activity={current} context={context} onChanged={onResourceChange}/>
    {__ui(editor && createPortal(<div onDoubleClick={e => e.stopPropagation()}><Modal title={__ui("作业逻辑关系")} onClose={() => setEditor(null)}>
      <Form submit={editor.remove ? '解除关系' : '保存关系'} onClose={() => setEditor(null)} onSubmit={async () => {
                const successor = editor.existing ? activities.find((a: any) => a.id === editor.successor) :
                    editor.direction === '前置' ? current : activities.find((a: any) => a.id === editor.otherId);
                const predecessor = editor.existing ? editor.predecessor : editor.direction === '前置' ? editor.otherId : current.id;
                if (!successor || !predecessor)
                    throw Error('请选择关联作业');
                await api(`/projects/${context.project_id}/dependencies`, 'POST', {
                    predecessor, successor: successor.id, type: editor.type,
                    lag: relationInterval(editor.mode, Number(editor.days)),
                    version: editor.existing ? editor.version : successor.version, remove: !!editor.remove,
                });
                setEditor(null);
                reload();
                notify('逻辑关系已保存，横道图与网络图同步更新');
            }}>
        <p>{__ui(label(current))}</p>
        <Field label={__ui("关系方向")}><select aria-label={__ui("关系方向")} disabled={editor.existing} value={editor.direction} onChange={e => setEditor({ ...editor, direction: e.target.value, otherId: '', query: '' })}>
          <option>{__ui("前置")}</option><option>{__ui("后置")}</option></select></Field>
        {__ui(editor.existing ? <p>{__ui(label(editor.other))} → {__ui(editor.type)}</p> :
                <Field label={__ui("关联作业")} hint={__ui('输入作业编码或名称自动查找，选择匹配作业。')}>
                  <input aria-label={__ui('关联作业')} autoComplete="off" list={choicesId} required value={editor.query||''} placeholder={__ui('输入作业编码或名称')} onChange={e=>{
                    const query=e.target.value,normalized=query.trim().toLocaleLowerCase();
                    const matches=activities.filter((a:any)=>a.id!==current.id&&a.record_id&&(editor.direction==='前置'||a.custom_editable)&&(String(a.code).toLocaleLowerCase()===normalized||label(a).toLocaleLowerCase()===normalized||String(a.name).toLocaleLowerCase()===normalized));
                    setEditor({...editor,query,otherId:matches.length===1?matches[0].id:''});
                  }}/>
                  <datalist id={choicesId}>{activities.filter((a:any)=>a.id!==current.id&&a.record_id&&(editor.direction==='前置'||a.custom_editable)).map((a:any)=><option key={a.id} value={label(a)}/>)}</datalist>
                  {editor.otherId&&<small role="status">{label(activities.find((a:any)=>a.id===editor.otherId))}</small>}
                </Field>)}
        <Field label={__ui("关系类型")}><select aria-label={__ui("关系类型")} value={editor.type} onChange={e => setEditor({ ...editor, type: e.target.value })}>
          <option value="FS">{__ui("FS 完成 → 开始")}</option><option value="FF">{__ui("FF 完成 → 完成")}</option>
          <option value="SS">{__ui("SS 开始 → 开始")}</option><option value="SF">{__ui("SF 开始 → 完成")}</option></select></Field>
        <Field label={__ui("提前／滞后")}><select aria-label={__ui("提前／滞后")} value={editor.mode} onChange={e => setEditor({ ...editor, mode: e.target.value })}>
          <option value="none">{__ui("无间隔")}</option><option value="lead">{__ui("提前")}</option><option value="lag">{__ui("滞后")}</option></select></Field>
        <Field label={__ui("天数")} hint={__ui("按项目日历工作日计算；提前存为负间隔，滞后存为正间隔。")}>
          <input type="number" min={0} max={3650} step={1} required disabled={editor.mode === 'none'} value={editor.days} onChange={e => setEditor({ ...editor, days: e.target.value })}/></Field>
        {__ui(editor.existing && <Field label={__ui("解除这条关系")}><input type="checkbox" checked={!!editor.remove} onChange={e => setEditor({ ...editor, remove: e.target.checked })}/></Field>)}
      </Form>
    </Modal></div>, document.body))}
  </>;
}
