export function reportAssessment(block:any,data:any,sourceName='业务台账'){
 const total=data.matched??data.overall,rows=data.rows||[],partial=(data.groupCount||0)>rows.length;
 const basis=`依据：${sourceName}；仅主管确认有效且当前账号有权读取的记录；${block.dateFrom||block.dateTo?`${block.dateFrom||'起始'}—${block.dateTo||'截至当前'}`:block.datePreset?'所选相对周期':'当前已保存范围'}。`;
 if(!rows.length||data.matched===0)return [basis,'结论：本范围没有可用记录，无法判定业务表现；无记录不等于无风险、零费用或已完成。','下一步建议（待确认）：核对统计周期、业务日期、授权和主管确认状态，补齐原始记录后重新生成报告。'].join('\n\n');
 const distribution=rows.slice(0,8).map((r:any)=>`${r.label}：${r.value}`).join('；');
 const missing=data.missingValues?`其中${data.missingValues}条指标未填，不将缺报解释为零；` : '';
 const value=block.metric==='__count__'?`匹配${total}条记录。`:`整体指标：${data.overall}（按组件指标口径；不等同完成率或利润）。`;
 return [basis,`结论：${missing}${value}${distribution}${partial?'。仅展示部分分组，不能据此得出全量闭环率。':'。'}${block.metric==='__count__'?'记录数量仅表示台账覆盖，不能代替现场核查或效果评价。':''}`,
 '下一步建议（待主管确认）：'+(block.text||'按明细核对异常原因，为每项措施明确责任人、期限、验收证据，下一期复核。')].join('\n\n');
}
