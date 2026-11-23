import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState } from 'react';
import { Download, Link2, Trash2 } from 'lucide-react';
import { api, useApi, Modal, Field, ErrorBox, Loading } from './lib';
export default function RecordLinks({ recordId, onClose, onUpdate, readOnly = false }: {
    recordId: string;
    onClose: () => void;
    onUpdate: () => void;
    readOnly?: boolean;
}) {
    const [revision, setRevision] = useState(0), [search, setSearch] = useState(''), [file, setFile] = useState(''), [version, setVersion] = useState(''), [activity, setActivity] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const links = useApi(`/records/${recordId}/links`, revision), candidates = useApi(`/records/${recordId}/link-candidates?search=${encodeURIComponent(search)}`, revision), versions = useApi(file ? `/files/${file}/versions` : null, revision);
    const current = links.data ? { ...links.data, editable: links.data.editable && !readOnly } : undefined;
    async function change(path: string, method: string, body: any) {
        setBusy(true);
        setError('');
        try {
            await api(path, method, { version: current.record_version, ...body });
            setRevision(v => v + 1);
            onUpdate();
        }
        catch (e) {
            setError((e as Error).message);
            setRevision(v => v + 1);
        }
        finally {
            setBusy(false);
        }
    }
    return <Modal title={__ui("记录附件与作业关联")} wide onClose={() => {
            if (!busy)
                onClose();
        }}>
  {__ui(links.error && <ErrorBox message={__ui(links.error)}/>)}{__ui(error && <ErrorBox message={__ui(error)}/>)}
  {__ui(!current && !links.error && <Loading />)}
  {__ui(current && <div className='record-links'>
   <p className='help'>{__ui("记录版本 ")}{__ui(current.record_version)}{__ui(" · 文件固定到指定版本；关联不会自动修改作业进度。")}</p>
   {__ui(!current.editable && <p className='note'>{__ui("当前记录只读。待审、已审核或冻结记录不可修改关联；正式记录需先发起变更。")}</p>)}
   <section><h3>{__ui("固定版本附件 · ")}{__ui(current.attachments.length)}</h3>
    {__ui(!current.attachments.length && <p className='help'>{__ui("尚无附件，可从项目文件库关联。")}</p>)}
    {__ui(current.attachments.map((item: any) => <div className='record-link-item' key={item.id}><div><strong>{item.file_name}</strong><small>{__ui("版本 ")}{__ui(item.version)} · {__ui(item.size_bytes)}{__ui(" 字节")}{__ui(item.file_lifecycle === 'deleted' ? ' · 原文件已回收，固定版本保留' : '')}</small><small title={__ui(item.sha256)}>SHA-256：{__ui(item.sha256)}</small></div><a className='button-link' href={`/api/records/${recordId}/attachments/${item.id}/download`} download><Download size={15}/>{__ui("下载固定版本")}</a>{__ui(current.editable && <button className='danger' disabled={busy} aria-label={__uiFormat("解除附件 {0}", [item.file_name])} onClick={() => void change(`/records/${recordId}/attachments/${item.id}`, 'DELETE', {})}><Trash2 size={15}/>{__ui("解除")}</button>)}</div>))}
   </section>
   <section><h3>{__ui("关联计划作业 · ")}{__ui(current.activities.length)}</h3>
    {__ui(!current.activities.length && <p className='help'>{__ui("尚无关联作业。")}</p>)}
    {__ui(current.activities.map((item: any) => <div className='record-link-item' key={item.id}><div><strong>{__ui(item.code)} · {item.name}</strong><small>{__ui("计划工期 ")}{__ui(item.duration)}{__ui(" 天 · 完成率 ")}{__ui(item.progress)}%</small></div>{__ui(current.editable && <button className='danger' disabled={busy} aria-label={__uiFormat("解除作业 {0}", [item.name])} onClick={() => void change(`/records/${recordId}/activities/${item.id}`, 'DELETE', {})}><Trash2 size={15}/>{__ui("解除")}</button>)}</div>))}
   </section>
   {__ui(current.editable && <section><h3>{__ui("添加关联")}</h3><Field label={__ui("搜索项目文件或作业")}><input aria-label={__ui("搜索关联候选项")} value={search} maxLength={120} onChange={e => setSearch(e.target.value)} placeholder={__ui("输入名称或作业编码")}/></Field><p className='help'>{__ui("候选文件和作业各显示前100项，可通过搜索缩小范围。")}</p>
    {__ui(candidates.error && <ErrorBox message={__ui(candidates.error)}/>)}
    <div className='record-link-form'><Field label={__ui("项目文件")}><select aria-label={__ui("关联项目文件")} value={file} disabled={busy} onChange={e => { setFile(e.target.value); setVersion(''); }}><option value=''>{__ui("选择文件")}</option>{__ui(candidates.data?.files.map((f: any) => <option key={f.id} value={f.id}>{f.name}{__ui(" · 最新v")}{__ui(f.current_version)}</option>))}</select></Field><Field label={__ui("固定版本")}><select aria-label={__ui("附件固定版本")} value={version} disabled={!file || busy} onChange={e => setVersion(e.target.value)}><option value=''>{__ui("选择版本")}</option>{__ui(versions.data?.map((v: any) => <option key={v.version} value={v.version}>v{__ui(v.version)} · {__ui(v.size_bytes)}{__ui(" 字节")}</option>))}</select></Field><button disabled={!file || !version || busy} onClick={() => void change(`/records/${recordId}/attachments`, 'POST', { file_id: file, file_version: Number(version) })}><Link2 size={15}/>{__ui("关联附件")}</button></div>
    {__ui(versions.error && <ErrorBox message={__ui(versions.error)}/>)}
    <div className='record-link-form'><Field label={__ui("计划作业")}><select aria-label={__ui("关联计划作业")} value={activity} disabled={busy} onChange={e => setActivity(e.target.value)}><option value=''>{__ui("选择作业")}</option>{__ui(candidates.data?.activities.map((a: any) => <option key={a.id} value={a.id}>{__ui(a.code)} · {a.name}</option>))}</select></Field><button disabled={!activity || busy} onClick={() => void change(`/records/${recordId}/activities`, 'POST', { activity_id: activity })}><Link2 size={15}/>{__ui("关联作业")}</button></div>
   </section>)}
  </div>)}
 </Modal>;
}
export function RecordEvidence({ approvalId }: {
    approvalId: string;
}) {
    const { data, error } = useApi(`/approvals/${approvalId}/record-evidence`);
    return <section className='record-links'><h3>{__ui("审批关联证据")}</h3>{__ui(error && <ErrorBox message={__ui(error)}/>)}{__ui(data && <><p className='help'>{__ui(data.snapshot ? '附件与作业名称保存于本次提交快照，不随退回后的修改变化。' : '此历史申请未保存关联证据快照。')}</p>{__ui(data.attachments.map((item: any) => <div className='record-link-item' key={item.id}><div><strong>{item.file_name} · v{__ui(item.version)}</strong><small>{__ui(item.sha256)}</small></div><a className='button-link' href={`/api/approvals/${approvalId}/record-evidence/${item.id}/download`} download>{__ui("下载固定版本")}</a></div>))}{__ui(data.activities.map((a: any) => <p key={a.id}>{__ui(a.code)} · {a.name}</p>))}{__ui(!data.attachments.length && !data.activities.length && <p className='help'>{__ui("此记录暂无关联证据。")}</p>)}</>)}</section>;
}
export function ActivityRecords({ activityId }: {
    activityId: string;
}) {
    const { data, error } = useApi<any[]>(`/activities/${activityId}/records`);
    return <section><h3>{__ui("关联业务记录")}</h3>{__ui(error && <ErrorBox message={__ui(error)}/>)}{__ui(data?.map(r => <div key={r.id} className='record-link-item'><div><strong>{r.table_name} · {r.title}</strong><small>{__ui(r.status === 'approved' ? '已审核' : r.status === 'pending' ? '待审核' : r.status === 'draft' ? '草稿' : r.status === 'rejected' ? '已退回' : '历史版本')}</small></div></div>))}{__ui(data?.length === 0 && <p className='help'>{__ui("暂无当前账号有权查看的关联记录。")}</p>)}<p className='help'>{__ui("最多展示最近200项关联中的授权记录；关联不自动回填进度。")}</p></section>;
}
