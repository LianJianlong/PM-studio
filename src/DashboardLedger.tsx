import {useEffect,useRef,useState} from 'react';
import {translateUiValue as t} from './i18n';
import {useApi,ErrorBox,Loading} from './lib';
import {displayValue} from '../shared/fields';
export default function DashboardLedger({widget,project,tick}:{widget:any;project:string;tick:number}){
 const [page,setPage]=useState(1),[rows,setRows]=useState<any[]>([]),host=useRef<HTMLDivElement>(null),cached=useRef<any>(null);const {data,error}=useApi<any>(`/projects/${project}/dashboard/widgets/${widget.id}/ledger?page=${page}`,tick);
 useEffect(()=>{setPage(1);setRows([]);if(host.current)host.current.scrollTop=0;},[project,widget.id,widget.version]);
 useEffect(()=>{if(data?.page===page){cached.current=data;setRows(data.rows);}},[data,page]);
 if(error)return <ErrorBox message={t(error)}/>;
 const current=data||cached.current;if(!current)return <Loading/>;const more=page*current.pageSize<current.total;
 return <><p className="help">{t('高优先级在前 · 同级最新动态在前 · 完成事项在后')}</p><div className="dashboard-ledger-scroll" ref={host} tabIndex={0} aria-label={t('台账明细，可向下滚动')} onScroll={e=>{const el=e.currentTarget;if(more&&data?.page===page&&el.scrollTop+el.clientHeight>=el.scrollHeight-35)setPage(p=>p+1);}}><table className="dashboard-ledger-table"><thead><tr><th>{t('关注等级')}</th>{current.columns.filter((c:any)=>c.id!=='priority').map((c:any)=><th key={c.id}>{t(c.name)}</th>)}<th>{t('最后更新')}</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><span className={'ledger-priority ledger-priority-'+({'紧急':'urgent','高':'high','普通':'normal','低':'low','已完成':'done'} as any)[row.priority]}>{t(row.priority)}</span></td>{current.columns.filter((c:any)=>c.id!=='priority').map((c:any)=><td key={c.id}>{displayValue(row.data[c.id])||'—'}</td>)}<td>{new Date(row.updated_at).toLocaleString()}</td></tr>)}{!rows.length&&<tr><td colSpan={current.columns.length+2}>{t('暂无符合条件的记录')}</td></tr>}</tbody></table>{more&&<button className="ledger-load-more" disabled={data?.page!==page} onClick={()=>setPage(p=>p+1)}>{t(data?.page===page?'继续向下加载':'正在加载…')}</button>}</div><p className="help">{t('已显示')} {rows.length} / {current.total} · {t('向下滚动自动加载全部，表头固定；可横向查看其余字段。')}</p></>;
}
