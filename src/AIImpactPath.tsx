import {relationGraphPositions} from '../shared/ai-relation-graph';
import {useState} from 'react';import AIRecordEvidence from './AIRecordEvidence';import {translateUiValue as ui} from './i18n';
export default function AIImpactPath({graph,project}:{graph:any;project:string}){
 const [selected,setSelected]=useState<any>(null);
 const nodes=(graph.nodes||[]).slice(0,100),keys=new Set(nodes.map((n:any)=>n.key)),edges=(graph.edges||[]).filter((e:any)=>keys.has(e.from)&&keys.has(e.to));
 const positions=new Map(relationGraphPositions(nodes,edges).map(p=>[p.key,p]));
 const width=Math.max(600,...[...positions.values()].map(p=>p.x+230)),height=Math.max(180,...[...positions.values()].map(p=>p.y+120));
 return <section className="ai-impact-path" aria-label={ui('影响路径图')} style={{border:'1px solid #d8e4e8',borderRadius:8,padding:12,marginTop:12}}>
 <strong>{ui(graph.title)}</strong>{graph.coverage&&<small style={{marginLeft:12}}>{ui('层数')} {graph.coverage.depth} · {ui('记录数')} {graph.nodes.length} · {ui('关系数')} {graph.edges.length}</small>}<p className="help">{ui(graph.legend||'绿色：已读业务依据；蓝色：有效作业逻辑；红色：试算日期变化。点击节点查看依据。')}</p>
 <div style={{overflow:'auto',maxHeight:560,background:'#f8fbfc'}}><svg width={width} height={height} role="group" aria-label={ui(graph.status==='relations_only'?'业务记录关联路径':'采购与作业影响路径')}>
 {edges.map((e:any,i:number)=>{const a=positions.get(e.from)!,b=positions.get(e.to)!,self=e.from===e.to,back=b.x<a.x,fromX=back?a.x:a.x+210,toX=back?b.x+210:b.x,direction=back?-1:1;return <g key={i}><path d={self?`M${a.x+210},${a.y+45} C${a.x+270},${a.y-35} ${a.x-60},${a.y-35} ${a.x},${a.y+45}`:`M${fromX},${a.y+45} C${fromX+direction*45},${a.y+45} ${toX-direction*45},${b.y+45} ${toX},${b.y+45}`} fill="none" stroke={e.kind==='logic'?'#3879aa':'#11947b'} strokeWidth="1.5"/><path d={`M${toX-direction*7},${b.y+41} L${toX},${b.y+45} L${toX-direction*7},${b.y+49}`} fill="none" stroke="#3879aa"/><text x={self?a.x+105:(fromX+toX)/2} y={self?a.y-10:(a.y+b.y)/2+(back?64:30)} fontSize="11" textAnchor="middle" fill="#456276"><title>{e.label}</title>{e.label.length>16?e.label.slice(0,16)+"…":e.label}</text></g>})}
 {nodes.map((n:any)=>{const p=positions.get(n.key)!,color=n.kind==='changed'?'#b84444':n.kind==='source'?'#008570':'#356b9c';return <foreignObject key={n.key} x={p.x} y={p.y} width="210" height="100"><button title={n.label} onClick={()=>setSelected(n)} disabled={!n.table_id} style={{width:'100%',height:92,whiteSpace:'normal',textAlign:'left',display:'block',background:'white',border:`2px ${n.kind==='source'&&n.status!=='approved'?'dashed':'solid'} ${color}`,borderRadius:6,padding:8,color}}><strong style={{display:'block',fontSize:12}}>{n.label}</strong><small>{n.kind==='source'?`${ui(n.status==='approved'?'有效':'非有效')} · ${ui('版本')} ${n.version}`:n.kind==='changed'?`${n.before} → ${n.after} · ${n.shift}h`:ui('有效作业')}</small></button></foreignObject>})}
 </svg></div><p className="help">{ui(graph.notice)} {graph.truncated?ui('路径展示已截取，请缩小分析范围。'):''}</p>
 {!!graph.missing?.length&&<details><summary>{ui('缺项与未核实条件')}</summary><ul>{graph.missing.map((m:string,i:number)=><li key={i}>{ui(m)}</li>)}</ul></details>}
 {selected&&<AIRecordEvidence node={selected} project={project} onClose={()=>setSelected(null)}/>}
 </section>
}
