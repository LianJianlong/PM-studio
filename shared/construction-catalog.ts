export type ConstructionProfile='generic'|'hospital'|'stadium';
export const constructionProfiles={generic:'通用公共建筑',hospital:'医院建设项目',stadium:'体育场建设项目'};
type System={key:string;discipline:string;name:string;work:string;checks:string;materials:[string,string][]};
const sys=(key:string,discipline:string,name:string,work:string,checks:string,materials:[string,string][]):System=>({key,discipline,name,work,checks,materials});
const common:System[]=[
 sys('earth','土建工程','土方与基坑支护','测量放线、土方开挖、支护、降排水、回填','基坑监测、支护验收、回填压实', [['支护型钢','t'],['钢板桩','t'],['土工布','m²'],['级配碎石','m³']]),
 sys('foundation','土建工程','桩基与基础','成孔、钢筋笼、桩基浇筑、承台、底板','成孔检测、桩身完整性、隐蔽验收', [['桩基钢筋','t'],['桩基混凝土','m³'],['桩基声测管','m']]),
 sys('structure','土建工程','钢筋混凝土主体','模板支设、钢筋绑扎、预埋、混凝土浇筑与养护','钢筋隐蔽、试块、实体与外观检查', [['钢筋','t'],['商品混凝土','m³'],['模板','m²'],['止水钢板','m']]),
 sys('steel','钢结构工程','钢结构与金属屋面','构件进场、吊装、高强螺栓、焊接、防腐防火、屋面安装','焊缝检测、螺栓连接、防火涂层与屋面淋水', [['钢结构构件','t'],['高强螺栓连接副','套'],['金属屋面板','m²'],['防火涂料','kg']]),
 sys('envelope','建筑围护工程','幕墙与门窗','龙骨、连接件、面板、玻璃、门窗与密封','连接节点隐蔽、气水密与结构性能', [['幕墙玻璃','m²'],['铝型材','t'],['石材面板','m²'],['密封胶','支'],['建筑门窗','樘']]),
 sys('waterproof','建筑防水工程','屋面与地下防水','基层、附加层、防水层、保护层、节点收口','基层验收、搭接与节点、蓄水或淋水', [['防水卷材','m²'],['防水涂料','kg'],['止水带','m']]),
 sys('finish','装饰装修工程','砌筑与室内装修','砌筑、抹灰、吊顶、墙地面、隔墙与门安装','材料复验、隐蔽、观感与室内环境', [['砌块','m³'],['砂浆','t'],['石膏板','m²'],['地砖','m²'],['墙面涂料','kg']]),
 sys('water','给排水工程','生活给水与热水','管道、阀门、设备、保温、试压、冲洗消毒','压力试验、冲洗消毒与水质检测', [['给水管','m'],['热水管','m'],['给水阀门','个'],['生活水泵','台']]),
 sys('drainage','给排水工程','排水与雨水','污废水、通气、雨水管道与泵坑','灌水、通水、通球与排水坡度', [['排水管','m'],['雨水管','m'],['潜污泵','台'],['地漏','个']]),
 sys('hvac','暖通工程','空调冷热源与水系统','冷热源设备、水管、阀门、保温、水力平衡','水压、清洁度、保温与水力平衡调试', [['冷水机组','台'],['热泵机组','台'],['空调水管','m'],['保温材料','m³'],['循环水泵','台']]),
 sys('ventilation','暖通工程','通风空调与防排烟','风管、风阀、风机、末端、保温与风量调试','风管严密性、风量平衡、防排烟联动', [['镀锌钢板风管','m²'],['防火阀','个'],['排烟风机','台'],['空调箱','台'],['送回风口','个']]),
 sys('power','电气工程','变配电与应急电源','配电设备、变压器、母线、电缆、发电机与切换','绝缘、接地、继保、送电与应急切换', [['变压器','台'],['高低压配电柜','面'],['柴油发电机组','台'],['封闭母线','m'],['电力电缆','m']]),
 sys('lighting','电气工程','动力照明与防雷接地','桥架、配管穿线、配电箱、灯具、接地与测试','绝缘、回路、防雷接地、应急照明', [['电缆桥架','m'],['电线','m'],['配电箱','台'],['普通照明灯具','套'],['接地扁钢','m']]),
 sys('firewater','消防工程','消防给水与自动灭火','消防管网、消火栓、喷淋、泵房与设备安装','管网试压冲洗、末端试水与泵组联动', [['消防钢管','m'],['喷淋头','个'],['消火栓箱','套'],['消防泵','台'],['报警阀组','套']]),
 sys('firealarm','消防工程','火灾报警与消防联动','报警回路、探测器、联动控制、消防广播','报警、联动矩阵、故障与应急响应', [['火灾报警控制器','台'],['感烟探测器','个'],['消防控制模块','个'],['消防报警电缆','m']]),
 sys('ict','智能化工程','综合布线与信息网络','管路、铜缆光纤、机柜、交换设备与测试','链路测试、光纤测试、网络与设备配置', [['网络铜缆','m'],['光纤光缆','m'],['网络机柜','台'],['网络交换机','台']]),
 sys('security','智能化工程','安防与门禁','视频监控、出入口、门禁、入侵报警','图像、存储、门禁权限与报警联动', [['监控摄像机','台'],['门禁控制器','台'],['门禁读卡器','个'],['监控存储设备','台']]),
 sys('bms','智能化工程','楼宇自控与能耗计量','控制箱、传感器、执行器、点位与平台集成','点表核对、单点测试、控制策略与趋势', [['DDC控制箱','台'],['温湿度传感器','个'],['电动调节阀','个'],['能耗计量表','只']]),
 sys('lift','电梯工程','垂直运输','井道验收、导轨、轿厢、扶梯与调试','设备检验、运行保护与应急救援', [['客梯设备','台'],['货梯设备','台'],['自动扶梯','台']]),
 sys('external','室外工程','道路管网与景观','地下管网、道路基层、铺装、绿化与照明','管网检测、压实度、道路与景观验收', [['道路级配料','m³'],['室外雨污水管','m'],['路缘石','m'],['景观铺装砖','m²'],['苗木','株']]),
];
const hospital:System[]=[
 sys('h-gas','医疗专项工程','医用气体与真空吸引','气源站、脱脂铜管、阀门箱、报警、终端与标识','清洁脱脂、强度严密性、气体身份与品质、报警测试', [['医用脱脂铜管','m'],['医用气体终端','套'],['医用气体区域阀门箱','台'],['医用气体报警装置','套'],['医用真空机组','套']]),
 sys('h-clean','医疗专项工程','手术部与洁净空间','洁净围护、净化空调、过滤器、气密门与末端','洁净度、压差、风量、温湿度与环境检测', [['洁净围护板','m²'],['医用气密门','樘'],['高效过滤器','台'],['净化空调机组','台'],['洁净送风天花','套']]),
 sys('h-negative','医疗专项工程','感染控制与负压通风','分区隔离、气流组织、专用排风、压差监测','气流方向、压差梯度、排风过滤与报警', [['负压排风机组','台'],['压差传感器','个'],['排风高效过滤箱','台'],['气密调节阀','个']]),
 sys('h-water','医疗专项工程','医疗纯水与污水处理','纯水设备与循环管道、污水处理、消毒与监测','水质、管道清洁度、循环运行与排放检测', [['医疗纯水设备','套'],['洁净水管','m'],['污水处理设备','套'],['消毒加药装置','套']]),
 sys('h-isolated','医疗专项工程','医疗场所隔离电源与不间断供电','医疗IT系统、隔离变压器、绝缘监测、UPS与等电位','绝缘监测、故障报警、后备供电与等电位测试', [['医用隔离变压器','台'],['绝缘监测装置','套'],['UPS主机','台'],['等电位端子箱','台']]),
 sys('h-call','医疗专项工程','医护呼叫与病房信息','床头终端、护士站、走廊显示与信息集成','呼叫优先级、显示、故障与网络测试', [['医护呼叫主机','台'],['床头呼叫终端','套'],['走廊信息显示屏','台']]),
 sys('h-logistics','医疗专项工程','医用物流与气动传输','物流轨道、传输管道、站点、控制与联调','站点寻址、传输安全、故障恢复与噪声', [['气动传输管','m'],['物流传输站','台'],['传输控制柜','台']]),
 sys('h-radiation','医疗专项工程','放射防护与屏蔽','屏蔽墙门窗、穿墙节点、射线防护与标识','屏蔽完整性、防护检测与专业验收', [['防护铅板','m²'],['射线防护门','樘'],['防护铅玻璃','m²'],['防护砂浆','t']]),
 sys('h-lab','医疗专项工程','实验室与病理通风','实验台柜、通风柜、排风、补风与安全设施','面风速、排风联锁、气流组织与安全测试', [['实验室通风柜','台'],['实验台','延米'],['实验室排风机','台']]),
 sys('h-sterile','医疗专项工程','消毒供应与医疗设备接口','洁污分区、灭菌设备、蒸汽与水电气接口','设备接口、工艺验证、清洁区隔离与联调', [['灭菌设备','台'],['清洗消毒设备','台'],['洁净蒸汽管','m'],['医疗设备接口箱','台']]),
];
const stadium:System[]=[
 sys('s-roof','体育场专项工程','大跨度屋盖与索膜结构','钢桁架、索张拉、膜结构、支座与监测','吊装方案、张拉控制、连接检测与结构监测', [['空间钢桁架','t'],['结构拉索','套'],['屋盖膜材','m²'],['结构支座','套']]),
 sys('s-seats','体育场专项工程','看台座椅与观众设施','预制看台、座椅、栏杆、无障碍席与导向','锚固、座椅编号、疏散通道与无障碍核查', [['看台座椅','套'],['看台预制构件','件'],['防护栏杆','m'],['导向标识牌','块']]),
 sys('s-field','体育场专项工程','比赛场地与草坪排灌','场地基层、盲排、灌溉、草坪与养护','平整度、排水、土层、草坪与灌溉测试', [['运动草坪','m²'],['草坪根区砂','m³'],['透水盲管','m'],['草坪灌溉喷头','个'],['运动场排水沟','m']]),
 sys('s-track','体育场专项工程','田径跑道与运动面层','基层、防水、弹性层、面层与划线','平整度、厚度、面层性能与划线复核', [['跑道面层材料','kg'],['弹性颗粒','kg'],['运动场划线涂料','kg']]),
 sys('s-light','体育场专项工程','比赛照明与场景控制','投光灯具、支架、控制、瞄准与场景调试','照度均匀性、眩光、频闪、转播与应急切换', [['比赛投光灯','套'],['投光灯安装支架','套'],['比赛照明控制柜','台']]),
 sys('s-pa','体育场专项工程','赛事扩声与应急广播','扬声器、功放、音频网络与声场调试','语言清晰度、覆盖、延时与消防广播联动', [['体育场扬声器','只'],['功率放大器','台'],['数字音频处理器','台']]),
 sys('s-score','体育场专项工程','计时计分与大屏显示','计时计分设备、大屏、信号与赛事接口','显示与计时同步、信号冗余、赛事场景测试', [['计时计分系统','套'],['LED显示屏','m²'],['赛事控制终端','台']]),
 sys('s-broadcast','体育场专项工程','赛事转播与媒体通信','转播机位、光纤、媒体接口、评论席与供电','光纤链路、信号接口、专用电源与联调', [['转播光纤','m'],['转播接口箱','台'],['媒体通信终端','台']]),
 sys('s-ticket','体育场专项工程','票务闸机与人流管理','检票闸机、票务网络、客流监测与疏散接口','验票、断电释放、人流监测与应急联动', [['检票闸机','通道'],['票务验票终端','台'],['客流监测设备','台']]),
];
export function constructionSystems(profile:ConstructionProfile){return [...common,...(profile==='hospital'?hospital:profile==='stadium'?stadium:[])];}
export function constructionClassification(profile:ConstructionProfile){const systems=constructionSystems(profile);return {disciplines:[...new Set(systems.map(s=>s.discipline))],subsystems:systems.map(s=>s.name)};}
export const constructionSources=[{title:'NHS healthcare engineering and medical systems',url:'https://www.england.nhs.uk/estates/health-technical-memoranda/'},{title:'FIFA stadium technical systems and services',url:'https://publications.fifa.com/de/football-stadiums-guidelines/technical-guideline/stadium-guidelines/technical-systems-and-services/'}];
export const constructionSharedKeys=['system_catalog','material_catalog','daily_log','daily_labor','daily_equipment','daily_materials','weekly_log','weekly_plan','commissioning','handover','progress_snapshots'];
export function constructionSpecs(base:{key:string;dept:string;name:string;fields:any[];description?:string}[],profile:ConstructionProfile){
 const {disciplines,subsystems}=constructionClassification(profile);
 const text=(id:string,name:string,required=false)=>({id,name,type:'text',required});
 const num=(id:string,name:string,unit='')=>({id,name,type:'decimal',precision:24,scale:4,unit});
 const date=(id:string,name:string)=>({id,name,type:'date'});
 const ref=(id:string,name:string,target_key:string)=>({id,name,type:'reference',target_key,display_column:'name'});
 const choice=(id:string,name:string,options:string[])=>({id,name,type:'single_select',options});
 const classified=()=>[choice('discipline','施工专业',disciplines),choice('subsystem','子系统',subsystems),ref('system_ref','专业子系统目录','system_catalog'),text('building_zone','楼栋 / 分区'),text('floor','楼层 / 标高'),text('work_item','部位 / 工序')];
 const work=()=>[ref('wbs_ref','所属WBS','wbs'),ref('activity_ref','关联作业','activities')];
 const header=()=>ref('daily_log_ref','施工日报主表','daily_log');
 const materialNames=[...new Set(constructionSystems(profile).flatMap(s=>s.materials.map(m=>m[0])))];
 const keys=new Set(['daily','quantities','material_demands','purchase_requests','purchase_orders','procurement','arrivals','stock','movements','materials','equipment','training','hazards','documents','briefings','schemes','itp','inspections','quality','drawings','rfi','changes','valuations']);
 const enriched=base.map(t=>{const fields=t.fields.map(f=>({...f}));if(keys.has(t.key))for(const f of classified())if(!fields.some(old=>old.id===f.id))fields.push(f);
  if(['hazards','inspections','drawings','procurement'].includes(t.key)){for(const f of [text('responsible','责任人'),text('latest_update','最新动态 / 下一步行动'),choice('priority','事项优先级',['紧急','高','普通','低']),...(t.key==='inspections'?[date('due_date','计划验收期限')]:[])])if(!fields.some(old=>old.id===f.id))fields.push(f);}
  if(t.key==='stock')fields.push({id:'stock_key',name:'库存分组（含单位）',type:'formula',formula:"CONCAT([material_code],' / ',[material_name],' / ',[unit],' / ',[warehouse],' / ',COALESCE([batch],''))"});
  if(t.key==='materials')fields.push(ref('catalog_ref','标准材料设备目录','material_catalog'));
  if(t.key==='daily')fields.push(header(),choice('shift','班次',['白班','夜班','全天']),text('crew','施工班组'),text('blocker','未完成原因 / 制约条件'),text('coordination','需协调事项'),{id:'quantity_key',name:'工程量统计分组（含单位）',type:'formula',formula:"CONCAT([discipline],' / ',[subsystem],' / ',[building_zone],' / ',[floor],' / ',[work_item],' / ',[unit])"});
  if(['inspections','hazards','quality'].includes(t.key))fields.push(header());
  return {...t,fields};});
 return [...enriched,
 {key:'progress_snapshots',dept:'工程',name:'项目进度快照',description:'项目级累计完成率，每个统计日期保留一条已审核有效记录；按同一批准计量口径填报，不是各专业工程量之和。',fields:[{...num('actual_percent','实际累计完成率','%'),required:true},text('basis','计量依据 / 权重口径'),text('baseline_version','对应基线版本'),ref('daily_log_ref','依据日报','daily_log'),text('note','进度说明')]},
 {key:'earned_snapshots',dept:'财税',name:'项目挣值快照',description:'项目级累计PV、EV、AC快照；每日期一条，以项目本币和同一批准基线计价，不跨日期累加。PV为计划工作预算，EV为已完工作预算，AC为已完工作实际成本，不以现金收支代替AC。',fields:[text('currency','计价币种（项目本币）',true),num('bac','完工预算BAC'),{...num('pv','累计计划值PV'),required:true},{...num('ev','累计挣值EV'),required:true},{...num('ac','累计实际成本AC'),required:true},text('baseline_version','批准基线版本'),text('basis','测量与成本确认依据'),text('note','偏差与纠偏说明')]},
 {key:'system_catalog',dept:'技术',name:'专业与子系统目录',description:'行业分类模板；仅预置专业、系统、典型工序和检查提示，不代表已施工或已验收。项目可按设计增补。',fields:[text('discipline','施工专业',true),text('work_scope','典型施工工序'),text('quality_checks','检验与调试关注点'),text('applicability','适用建筑类型')]},
 {key:'material_catalog',dept:'物资',name:'标准材料设备目录',description:'材料设备分类与命名参考；无品牌、型号、价格、数量。规格与性能以批准设计、合同及适用标准为准。',fields:[ref('system_ref','所属子系统','system_catalog'),text('discipline','施工专业'),text('subsystem','子系统'),text('unit','建议计量单位'),text('specification_prompt','规格 / 性能填报提示'),text('inspection_prompt','进场检验提示')]},
 {key:'daily_log',dept:'工程',name:'施工日报主表',description:'每项目、日期、班次一份主表；专业施工、人工、机械、材料分别关联明细填报。',fields:[choice('shift','班次',['白班','夜班','全天']),choice('weather','天气',['晴','多云','雨','雪','大风','其他']),text('temperature','气温 / 施工环境'),text('site_summary','当日总体施工情况'),text('major_milestones','关键节点与完成情况'),text('safety_summary','安全活动与风险概况'),text('quality_summary','验收、试验与质量概况'),text('constraints','停工、延误与制约条件'),text('coordination','需协调事项及责任人'),text('instructions','监理 / 业主指令与来访'),text('tomorrow','次日工作与资源安排'),text('prepared_by','填报人'),text('reviewed_by','复核人')]},
 {key:'daily_labor',dept:'工程',name:'日报人工投入明细',fields:[header(),...classified(),text('crew','班组 / 分包单位'),choice('trade','工种',['管理人员','测量工','土方工','钢筋工','模板工','混凝土工','架子工','焊工','钢结构安装工','砌筑工','装修工','管道工','通风工','电工','弱电工','防水工','设备安装工','特种作业人员','其他']),num('workers','出勤人次（非去重人数）','人次'),num('hours','投入工时','工时'),text('overtime','加班与缺工说明')]},
 {key:'daily_equipment',dept:'工程',name:'日报机械投入明细',fields:[header(),...classified(),ref('equipment_ref','设备台账','equipment'),text('equipment_name','机械设备名称'),num('operating_hours','运行台时','台时'),num('downtime_hours','停机台时','台时'),text('downtime_reason','停机原因与处置')]},
 {key:'daily_materials',dept:'工程',name:'日报材料使用明细',fields:[header(),...classified(),ref('material_ref','项目材料','materials'),ref('catalog_ref','标准材料设备目录','material_catalog'),choice('material_family','材料设备类别名称',materialNames),text('material_name','实际材料 / 设备名称'),text('specification','规格型号'),text('unit','计量单位'),num('planned_usage','计划使用量'),num('actual_usage','实际使用量'),num('received','当日到场量'),text('shortage','缺料与进场风险')]},
 {key:'weekly_log',dept:'工程',name:'周报与周期报告主表',description:'周报、双周报、月报共用周期主表；起止日期明确，不把日报累计数再次相加。',fields:[choice('period_type','周期类型',['周报','双周报','月报']),date('period_from','统计开始日期'),date('period_to','统计结束日期'),text('overall_summary','本期建设概况'),text('milestone_review','关键节点计划与实际对比'),text('delay_analysis','偏差原因及纠偏措施'),text('design_coordination','设计出图、RFI与专业接口'),text('procurement_summary','长周期设备、采购与到货风险'),text('quality_summary','检验试验、验收与质量闭环'),text('safety_summary','安全风险、隐患整改与培训'),text('resources_summary','人工机械投入与资源瓶颈'),text('commercial_summary','变更签证及商务事项（不填敏感金额）'),text('decisions_required','需业主 / 监理决策事项'),text('next_period_plan','下期计划及前置条件'),text('prepared_by','编制人')]},
 {key:'weekly_plan',dept:'工程',name:'专业滚动计划与制约清单',fields:[ref('weekly_log_ref','所属周期报告','weekly_log'),...classified(),...work(),text('unit','计量单位'),num('planned_qty','下期计划工程量'),date('planned_start','计划开始'),date('planned_finish','计划完成'),text('resources_required','所需人工机械材料'),text('prerequisites','图纸 / 材料 / 作业面前置条件'),text('responsible','责任单位 / 人'),choice('readiness','开工条件',['待落实','部分具备','已具备','已完成']),text('recovery_action','纠偏与赶工安排')]},
 {key:'commissioning',dept:'质量',name:'子系统调试与联合试运转台账',fields:[...classified(),...work(),ref('itp_ref','检验试验计划','itp'),text('test_scope','测试项目与范围'),text('acceptance_criteria','批准的验收标准 / 指标'),text('measured_result','实测结果 / 检测报告编号'),choice('test_stage','调试阶段',['单机调试','子系统调试','联合试运转','专项检测','性能验证']),choice('result','测试结论',['待测','通过','不通过','复测通过']),text('interfaces','跨专业接口与联动条件'),text('witness','见证单位 / 人'),text('outstanding','遗留问题与处理责任人')]},
 {key:'handover',dept:'技术',name:'专业移交与竣工资料清单',fields:[...classified(),ref('commissioning_ref','调试验收记录','commissioning'),ref('document_ref','竣工文件','documents'),text('deliverable','竣工图 / 说明书 / 培训 / 备件 / 测试报告'),text('revision','版本'),text('recipient','接收单位 / 人'),date('handover_date','移交日期'),choice('handover_state','移交状态',['待编制','待审核','待接收','已接收','待补正']),text('punch_list','尾项与关闭安排')]},
 ];
}
export function constructionWorkflows<T extends {key:string;tables:string[]}>(base:T[]):T[]{return base.map(w=>({...w,tables:[...w.tables,...(w.key==='engineering'?['daily_log','daily_labor','daily_equipment','daily_materials','weekly_log','weekly_plan','progress_snapshots']:w.key==='technical'?['system_catalog','handover']:w.key==='procurement'?['material_catalog']:w.key==='quality'?['commissioning']:w.key==='finance'?['earned_snapshots']:[])]}));}
