import {useEffect,useMemo,useState} from 'react';
import {cpmReport} from '../shared/cpm-report';
import {translateUiValue as ui} from './i18n';

export default function CpmPanel({data,preview}:{data:any;preview:any}){
 const [source,setSource]=useState('current'),[tab,setTab]=useState('activities'),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(1);
 useEffect(()=>{setSource(preview?'preview':'current');setPage(1)},[preview]);
 const current=useMemo(()=>cpmReport(data),[data]);
 const trial=source==='preview'&&preview?.cpm_report,report=trial||current,context=trial?preview:data;
 const hpd=context?.calendar_config?.hours_per_day||8;
 const hours=(days:number)=>Math.round(Number(days)*hpd*1000000)/1000000;
 const date=(offset:number)=>{if(!context?.start_date||!Number.isFinite(offset))return '—';const value=new Date(Date.parse(context.start_date+'T00:00:00Z')+Math.round(offset*24)*3600000).toISOString();return value.slice(0,10)+' '+value.slice(11,13)+ui('时');};
 const relationState=(r:any)=>r.non_driving?'LOE非驱动关系':r.violated?'关系未满足':r.driving?'驱动关系':r.fixed?'实际或强制日期固定':'非驱动关系';
 const query=search.trim().toLocaleLowerCase();
 const rows=(tab==='activities'?report.activities:report.relationships).filter((r:any)=>{
  const text=tab==='activities'?[r.code,r.name]:[r.predecessor_code,r.predecessor_name,r.successor_code,r.successor_name,r.type];
  if(query&&!text.some(v=>String(v||'').toLocaleLowerCase().includes(query)))return false;
  if(filter==='all')return true;
  if(tab==='activities')return filter==='critical'?r.critical:filter==='negative'?r.float< -1e-7:filter==='near'?r.near_critical:filter==='longest'?r.on_longest_path:filter==='float'?r.float_critical:!r.predecessors?.length;
  return filter==='driving'?r.driving:filter==='conflict'?r.violated||r.historical_conflict:r.non_driving;
 });
 const headers=tab==='activities'?['作业编码','作业名称','早开始 ES','早完成 EF','晚开始 LS','晚完成 LF','总浮时（小时）','自由浮时（小时）','关键作业','总浮时口径关键','位于最长路径','近关键预警','关键性依据']:['前置作业','后置作业','关系类型','时距（小时）','关系余量（小时）','历史关系余量（小时）','关系判定','历史顺序冲突'];
 const values=(r:any)=>tab==='activities'?[r.code,r.name,date(r.es),date(r.ef),date(r.ls),date(r.lf),hours(r.float),hours(r.free_float),ui(r.critical?'是':'否'),ui(r.float_critical?'是':'否'),ui(r.on_longest_path?'是':'否'),ui(r.near_critical?'是':'否'),ui(r.critical_reason==='float'?'总浮时阈值':r.critical_reason==='longest'?'最长路径':r.critical_reason==='loe'?'LOE非驱动关系':'非关键')]:[`${r.predecessor_code} · ${r.predecessor_name}`,`${r.successor_code} · ${r.successor_name}`,r.type,hours(r.lag),hours(r.gap_work_days),hours(r.historical_gap_work_days),ui(relationState(r)),ui(r.historical_conflict?'是':'否')];
 function exportCsv(){const cell=(v:any)=>'"'+String(v??'').replace(/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/,"'$&").replaceAll('"','""')+'"';const url=URL.createObjectURL(new Blob(['\uFEFF'+[headers.map(ui),...rows.map(values)].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`cpm-${tab}-${trial?'trial':'current'}.csv`;a.click();URL.revokeObjectURL(url);}
 const pages=Math.max(1,Math.ceil(rows.length/100)),selectedPage=Math.min(page,pages),summary=report.summary;
 return <div className="cpm-panel">
  <p className="help">{ui('CPM按项目工作日历前推早日期、后推晚日期。驱动关系不等于关键路线；关系余量与浮时均以工作小时显示。')}</p>
  <div className="gantt-settings-fields">
   <label>{ui('排程来源')}<select aria-label={ui('排程来源')} value={trial?'preview':'current'} onChange={e=>{setSource(e.target.value);setPage(1)}}><option value="current">{ui(data?.preview?'当前预排（含授权草稿）':'当前正式计划')}</option>{preview&&<option value="preview">{ui('排程试算（不保存，仅正式数据）')}</option>}</select></label>
   <label>{ui('CPM明细')}<select aria-label={ui('CPM明细')} value={tab} onChange={e=>{setTab(e.target.value);setFilter('all');setPage(1)}}><option value="activities">{ui('早晚日期与浮时')}</option><option value="relationships">{ui('逻辑关系与驱动分析')}</option></select></label>
   <input aria-label={ui('搜索CPM作业')} placeholder={ui('搜索作业编码或名称')} value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/>
   <select aria-label={ui('CPM筛选')} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}}><option value="all">{ui('全部')}</option>{(tab==='activities'?[['critical','关键作业'],['negative','负浮时作业'],['near','近关键作业'],['longest','位于最长路径'],['float','总浮时口径关键'],['starts','无前置作业']]:[['driving','驱动关系'],['conflict','关系冲突'],['loe','LOE非驱动关系']]).map(([value,label])=><option key={value} value={value}>{ui(label)}</option>)}</select>
   <button disabled={!rows.length} onClick={exportCsv}>{ui('导出CPM明细CSV')}</button>
  </div>
  <p role="status">{ui('普通作业')}：{summary.activities} · {ui('逻辑关系')}：{summary.relationships} · {ui('驱动关系')}：{summary.driving} · {ui('关系未满足')}：{summary.violations} · {ui('历史顺序冲突')}：{summary.historical_conflicts} · {ui('近关键预警')}：{summary.near_critical} · {ui('负浮时作业')}：{summary.negative} · {ui('起点 / 终点')}：{summary.starts} / {summary.ends}</p>
  <p className="help">{ui('进行中作业启用剩余重排时，开始类关系检查剩余工作的开始边界；历史余量仍按实际开始核对。历史冲突不会改写实际日期。强制日期或实际日期固定的事件不作为可移动的驱动关系。')}</p>
  <div className="plan-inspection-scroll grid-scroll"><table className="data-grid" aria-label={ui('CPM计算明细')}><thead><tr>{headers.map(h=><th key={h}>{ui(h)}</th>)}</tr></thead><tbody>{rows.slice((selectedPage-1)*100,selectedPage*100).map((r:any,i:number)=><tr key={tab==='activities'?r.id:`${r.predecessor}:${r.successor}:${r.type}:${i}`} style={tab==='activities'&&r.critical?{color:'#d3293b'}:tab==='activities'&&r.near_critical?{color:'#a65a00'}:undefined}>{values(r).map((v:any,j:number)=><td key={j}>{v}</td>)}</tr>)}</tbody></table>{!rows.length&&<p>{ui('没有匹配的CPM明细')}</p>}</div>
  <div className="gantt-settings-fields"><span>{ui('记录数')}：{rows.length} · {selectedPage} / {pages}</span><button disabled={selectedPage<=1} onClick={()=>setPage(selectedPage-1)}>{ui('上一页')}</button><button disabled={selectedPage>=pages} onClick={()=>setPage(selectedPage+1)}>{ui('下一页')}</button></div>
 </div>;
}
