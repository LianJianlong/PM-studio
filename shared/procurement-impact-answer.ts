const clean=(v:any)=>String(v??'—').replace(/[|\n\r]/g,' ');
export function procurementImpactAnswer(result:any){
 const s=result.simulation,computed=s?.status==='computed';const lines=['## 结论'];
 if(computed){lines.push(`在“${clean(result.date_basis)}”及所列假设下，${clean(s.delivery_basis)}从 **${s.before_finish}** 变为 **${s.after_finish}**，变化 **${s.finish_shift_work_hours} 工作小时**（完成日期相差 ${s.finish_shift_calendar_dates} 自然日）。${s.finish_shift_work_hours===0?'本情景未推迟该计划终点；不等于采购没有风险。':''}`);if(s.delivery_reachable===false)lines.push('当前作业逻辑未找到安装作业通往指定交付节点的路径；不能据此认定现实中没有影响。');}
 else lines.push('目前不能给出可靠的交付延期数字。'+(result.missing?.[0]||'需要补齐可核验的供货就绪条件。'));
 lines.push('\n## 关键依据',`起点：${clean(result.source)}；仅使用已确认有效、当前账号可读取的明确关联。`);
 if(result.chain?.length){lines.push('```text',...result.chain.map((e:any)=>`${clean(e.from)} ──${clean(e.relation)}──> ${clean(e.to)}`),'```');}
 if(result.source_records?.length){lines.push('| 业务记录 | 状态 | 版本 |','| --- | --- | --- |',...result.source_records.map((r:any)=>`| ${clean(r.table)} / ${clean(r.name)} | ${r.status==='approved'?'有效':'未确认，不参与试算'} | ${r.version} |`));}
 if(computed){lines.push(`项目日历：${clean(s.calendar)}，每天 ${s.hours_per_day} 工作小时；就绪准备时长：${s.preparation_work_hours} 工作小时。`, '| 作业 | 原完成日期 | 试算完成日期 | 完成变化（工作小时） | 原总浮时（小时） |','| --- | --- | --- | --- | --- |',...s.changes.map((a:any)=>`| ${clean(a.code)} · ${clean(a.name)} | ${a.before_finish} | ${a.after_finish} | ${a.finish_shift_hours} | ${a.before_float_hours} |`));if(s.coverage.changes_truncated||s.coverage.links_truncated)lines.push('变化作业/逻辑关系仅展示前60项，试算本身使用完整有效计划。');}
 lines.push('\n## 缺项与假设',...[...(result.missing||[]),...(result.assumptions||[]),...(s?.assumptions||[])].map(x=>'- '+x));
 if(!(result.missing||[]).length&&!result.assumptions?.length)lines.push('- 仍需确认到货、验收、齐套及作业面条件是否与输入一致。');
 lines.push('\n## 下一步建议','1. 采购负责人核实供应商到货承诺、运输和齐套情况；如无已登记责任人，由项目明确人员。','2. 安装负责人核对验收、吊装、作业面、图纸和资源条件，确认安装就绪日期及准备工时。','3. 计划负责人复核受影响逻辑、浮时与交付口径；如需更新数据，先形成差异预览并最终确认。','\n本轮仅只读分析/内存试算，未改动采购、作业、日历或排程设置。多个单项情景的延期不能直接相加。');
 return lines.join('\n\n');
}
