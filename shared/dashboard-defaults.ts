export function dashboardSpecifications(ids:Record<string,string>){
return [
 {kind:'progress',name:'进度S曲线（计划与实际）',config:{sourceMode:'project_plan',mappingId:ids.progress_snapshots,dateField:'date',actualField:'actual_percent',plannedField:'actual_percent'},position:0},
 {kind:'safety',name:'安全隐患台账',config:{sourceMode:'priority_ledger',mappingId:ids.hazards,dimension:'closure_state',chartType:'donut'},position:1},
 {kind:'quality',name:'质量验收统计',config:{sourceMode:'priority_ledger',mappingId:ids.inspections,dimension:'result',chartType:'donut'},position:2},
 {kind:'design',name:'设计图纸进展',config:{sourceMode:'priority_ledger',mappingId:ids.drawings,dimension:'drawing_state',chartType:'horizontalBar'},position:3},
 {kind:'procurement',name:'采购阶段进展',config:{sourceMode:'priority_ledger',mappingId:ids.procurement,dimension:'progress_state',chartType:'horizontalBar'},position:4},
 {kind:'todo',name:'待办事项与逾期分布',config:{sourceMode:'project_todos',mappingId:ids.todos,dimension:'state',chartType:'donut'},position:5},
 {kind:'earned',name:'净值计算（挣值EVM）',config:{sourceMode:'earned_snapshots',mappingId:ids.earned_snapshots,dateField:'date',pvField:'pv',evField:'ev',acField:'ac'},position:6},
 ];
}
