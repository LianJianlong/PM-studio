import {needsBusinessRuleCheck} from './business-rule-checks.ts';
export const ontologyRules={
 identity:'同一业务对象通过当前项目真实表绑定和记录ID识别；名称/编码只用于检索，不因同名合并或猜测关系。',
 relations:'只沿可见的显式关联字段追踪；未建立关联不表示不存在业务影响。权限内未查到不表示全项目没有。',
 progress:'作业完成率存在工期、实物、工量等口径；不可简单平均作业完成率作为项目进度。工期与日期按项目日历，不凭日期差替代工作日。',
 costs:'计划费用、实际费用、剩余费用、合同额、计量额、现金流分别解释；不能按完成率猜实际费用，不能把现金余额当利润。数量、单价、资源分配率和持续时长分别核对。',
 state:'到货、验收、入库、可安装以及整改、复查、关闭是不同业务状态；不得连带认定后续状态已完成。草稿不能当作有效实绩参与汇总。',
 collaboration:'先查对象、关系、责任和制约，再说明影响、备选措施、责任建议与缺项。没有排程试算证据时不能声称交付一定延期几天；建议不是事实或已批准决定。',
 actions:'人工与AI调用同一原业务校验；增删改仍需本轮授权、完整预览及最终确认。查询工具完全只读，不执行SQL或修改任何业务记录。'
};
export const ontologyTool={name:'business_context',description:'只读业务认知：catalog发现项目对象/字段/显式关系；search读授权记录；related沿真实引用双向追踪（最多2层50对象）；aggregate精确统计有效记录；plan读取原计划/资源/日历；procurement_impact从真实采购记录追踪安装作业并在内存执行项目日历CPM试算，根记录必须来自真实业务绑定。closure汇总指定起点的真实关联、逐记录规则、责任动态与交付风险（最多4层50对象，检查12对象），只读且不认定业务已完成；check检查指定表或记录的关联缺失、引用状态、必填及已实现业务规则（每页100条），只读并区分问题与待核实。每步重新鉴权，返回来源与覆盖范围，禁止猜关系或把局部当全量。',parameters:{type:'object',properties:{mode:{type:'string',enum:['catalog','search','related','aggregate','plan','procurement_impact','check','closure']},table_id:{type:'string',description:'Exact table UUID from authorized context. Use table_name if no ID is known.'},table_name:{type:'string',description:'Exact visible table name, never a translated or guessed name.'},record_id:{type:'string',description:'Visible record UUID or unique exact code/name.'},availability_date:{type:'string',description:'仅可与记录中的已确认安装就绪日期一致，不能补造或替代确认'},scenario_basis:{type:'string',description:'补充说明，不能替代记录中的就绪确认依据'},preparation_work_hours:{type:'integer',minimum:0,maximum:87600},delivery_activity_id:{type:'string',description:'可选，明确选择的有效交付作业；缺省为整个有效计划末端'},search:{type:'string'},page:{type:'integer',minimum:1},depth:{type:'integer',minimum:1,maximum:2},dimension:{type:'string'},metric:{type:'string'},aggregation:{type:'string',enum:['count','sum','average','min','max']},dateField:{type:'string'},dateFrom:{type:'string'},dateTo:{type:'string'},filterField:{type:'string'},filterValue:{type:'string'},dataset:{type:'string',enum:['plan','resources','resource-load','calendar']}},required:['mode'],additionalProperties:false}};
export function needsBusinessInvestigation(prompt:string){return needsBusinessRuleCheck(prompt)||/关联|关系|影响|协同|联动|原因|责任|闭环|汇总|统计|分析|哪些|查询|采购|库存|related|impact|dependency|aggregate|analyse|analyze|query/i.test(prompt)}

export function needsProcurementImpact(prompt:string){return /采购|到货|供货|设备|材料|订单|procurement|arrival|delivery order/i.test(prompt)&&/交付|工期|延期|延误|排程|delay|completion|schedule/i.test(prompt);}

export function needsRelationDiagram(prompt:string){return /关联|关系|追踪|闭环|协同|联动|related|relations|trace|dependency/i.test(prompt)&&!/什么是|原理|概念|含义|what is/i.test(prompt);}

export function needsClosureAnalysis(prompt:string){if(/(?:写|编写|生成).*(?:制度|管理方案|流程说明)|(?:write|draft|generate).*(?:policy|procedure)/i.test(prompt)&&!/分析|检查|核查|执行情况|analysis|check|status/i.test(prompt))return false;return /闭环|全链路|closed.?loop|end.to.end/i.test(prompt)&&!/什么是|原理|概念|模板|what is|how to/i.test(prompt);}
