import {ontologyTool} from './ai-ontology';
export const aiProviders = {
  openai: {name:'OpenAI', protocol:'responses', base_url:'https://api.openai.com/v1'},
  claude: {name:'Claude', protocol:'claude', base_url:'https://api.anthropic.com/v1'},
  gemini: {name:'Gemini', protocol:'gemini', base_url:'https://generativelanguage.googleapis.com/v1beta'},
  deepseek: {name:'DeepSeek', protocol:'chat', base_url:'https://api.deepseek.com'},
  glm: {name:'GLM', protocol:'chat', base_url:'https://open.bigmodel.cn/api/paas/v4'},
  minimax: {name:'MiniMax', protocol:'chat', base_url:'https://api.minimax.io/v1'},
  ollama: {name:'Ollama', protocol:'chat', base_url:'http://host.docker.internal:11434/v1'},
  compatible: {name:'其他兼容服务', protocol:'chat', base_url:''},
} as const;
export type AIConfig = {provider:keyof typeof aiProviders; protocol:'responses'|'chat'|'claude'|'gemini';base_url:string;model:string;api_key?:string;enabled:boolean;max_tokens:number;timeout_seconds:number;thinking?:boolean;cold_start_seconds?:number};
export const businessPath = /^\/(?:projects|workspaces|tables|records|activities|resources|todos|approvals|objects|files|owner-items|report-documents|departments|workflows|activity-resources|report-sources)(?:\/[a-zA-Z0-9_-]+)*(?:\?[^#]*)?$/;
export function normalizeBusinessPath(path:string){
  const value=path.trim();
  return /^(?:projects|workspaces|tables|records|activities|resources|todos|approvals|objects|files|owner-items|report-documents|departments|workflows|activity-resources|report-sources|public)(?:\/|$)/.test(value)?'/'+value:value;
}
export function safeBusinessPath(path:string){
  if(/[\\\r\n#]/.test(path))return false;
  const pathname=path.split('?')[0],parts=pathname.split('/').filter(Boolean).map(p=>p.toLowerCase());
  if(pathname.includes('%'))return false;
  if(parts[0]==='workspaces'&&['connections','users','ai-configs'].includes(parts[2]))return false;
  if(parts[0]==='projects'&&parts[2]==='ai')return false;
  return businessPath.test(path)||/^\/public\/views\/[a-f0-9-]{36}$/.test(pathname);
}
export const aiTools = [{name:'business_api',description:'调用当前用户授权的 Project Studio 业务接口。先用GET发现项目上下文、表字段和数据，再按字段类型操作。禁止SQL、用户凭据、外部数据库连接或模型配置。写入须用户明确要求且allow_write开启。聊天中的写请求会预演后加入最终方案，可多次分批准备大任务，系统自动汇总一次确认，不需一次输出整个大JSON。接口失败不得声称成功。',parameters:{type:'object',properties:{method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},path:{type:'string',description:'不含/api前缀；从目录选择接口。查询参数使用普通文本，禁止路径编码。'},body:{type:'object',description:'接口要求的JSON对象，更新须携带版本号。'}},required:['method','path'],additionalProperties:false}},

{name:'table_records',description:'优先使用的表内容工具。table_id或当前项目唯一table_name定位用户所见表；query返回真实字段、授权行和版本；create新增rows:[{data:{字段ID或唯一中文字段名:值}}]；update修改rows:[{id:真实记录ID,data:{字段:新值}}]；delete删除rows:[{id:真实记录ID}]。版本可省略由服务器读取冻结。写操作自动预演并生成待确认方案，绝不直接写入。批量新增5000/修改删除1000。WBS默认实际计划绑定表。',parameters:{type:'object',properties:{table_id:{type:'string'},table_name:{type:'string'},action:{type:'string',enum:['query','create','update','delete']},rows:{type:'array',items:{type:'object',properties:{id:{type:'string'},version:{type:'integer'},data:{type:'object'}},additionalProperties:false}},search:{type:'string'},page:{type:'integer'}},required:['action'],additionalProperties:false}},
{name:'table_schema',description:'优先使用的字段工具：inspect读取可见字段及类型；add通过definition新增字段；update用column_id和definition修改字段；delete用column_id删除字段。table_id或唯一table_name定位表。写操作预演后等待用户最终确认，仍需表管理权限。新增definition例{id:"remark",name:"备注",type:"text"}；修改definition例{name:"新列名"}。',parameters:{type:'object',properties:{table_id:{type:'string'},table_name:{type:'string'},action:{type:'string',enum:['inspect','add','update','delete']},column_id:{type:'string'},definition:{type:'object'}},required:['action'],additionalProperties:false}},
{name:'capability_catalog',description:'发现Agent当前接入的真实业务接口、模块覆盖、批量上限和任务方案用法。只列接口，不授予权限。',parameters:{type:'object',properties:{},additionalProperties:false}},
{name:'read_many',description:'对独立业务查询受控并发读取，最多16个GET、同时4个；每个均按当前用户权限过滤，失败逐项返回。',parameters:{type:'object',properties:{requests:{type:'array',minItems:1,maxItems:16,items:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}},required:['requests'],additionalProperties:false}},
{name:'prepare_plan',description:'自主Agent的最终写入工具：将本次任务的全部步骤汇总，真实业务事务预演后回滚；失败返回具体步骤/原因，自己修正后重试；成功仅需用户最后整体确认一次。支持先建表再录入等依赖，每个步骤必须有key（例table、row），用路径/字段值中的$steps.table.id引用key为table的步骤结果。示例operations:[{key:"table",method:"POST",path:"/projects/项目ID/tables",body:{name:"新表",department_id:"部门ID",columns:[{id:"title",name:"事项",type:"text",required:true}]}},{key:"row",method:"POST",path:"/tables/$steps.table.id/records",body:{data:{title:"内容"}}}]。预演UUID不能直接复制。所有权限和审批仍检查。',parameters:{type:'object',properties:{summary:{type:'string'},operations:{type:'array',minItems:1,maxItems:96,items:{type:'object',properties:{key:{type:'string'},method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},path:{type:'string'},body:{type:'object'}},required:['key','method','path'],additionalProperties:false}}},required:['summary','operations'],additionalProperties:false}},
{name:'api_catalog',description:'按主题取得业务接口参数、权限和字段类型说明，避免猜测建表/列/数据参数。',parameters:{type:'object',properties:{topic:{type:'string',enum:['overview','tables','fields','records','views','reports','planning','external_sql','files','approvals','permissions','calendar','resources','agent']}},additionalProperties:false}},
ontologyTool,
{name:'business_object_catalog',description:'发现当前项目真实业务绑定及动作；scope=global分页发现授权空间项目的全局表目录，仅元数据，不跨项目写入。',parameters:{type:'object',properties:{scope:{type:'string',enum:['project','global']},workspace_id:{type:'string'},project_id:{type:'string'},search:{type:'string'},page:{type:'integer',minimum:1}},additionalProperties:false}},
{name:'data_catalog',description:'发现当前用户授权的工作空间、项目、表和可见字段；不读取隐藏数据或凭据。',parameters:{type:'object',properties:{scope:{type:'string',enum:['workspaces','project']},project_id:{type:'string'},table_id:{type:'string'},search:{type:'string',description:'按表名搜索授权数据表，避免遍历目录'},page:{type:'integer',minimum:1}},additionalProperties:false}},
{name:'database_connections',description:'列出指定或当前工作空间内当前用户有权使用的外部数据库连接，不返回连接凭据。',parameters:{type:'object',properties:{workspace_id:{type:'string'}},additionalProperties:false}},
{name:'database_query',description:'使用已授权连接执行只读SELECT/WITH查询；缺省sql时浏览数据库表，不支持原始SQL写入。',parameters:{type:'object',properties:{connection_id:{type:'string'},sql:{type:'string'}},required:['connection_id'],additionalProperties:false}}];
export const aiCatalog = `GET /projects/{project}/context: 部门、成员、权限。GET /projects/{project}/tables: 可见表及字段。GET /tables/{table}/records?search=文本&page=1: 授权行及版本。POST /tables/{table}/records {data:{字段ID:值}}: 新草稿。PUT /records/{record} {version:当前版本,data:{字段ID:值}}: 修改草稿；普通表的有效记录可修改，保存后退回草稿等待主管确认。DELETE /records/{record} {}: 删除草稿。POST /records/{record}/change {}: 正式记录发起变更。POST /tables/{table}/columns {id,name,type,...}: 新列。GET /projects/{project}/plan: 作业与扩展字段。POST /projects/{project}/activities {code,name,duration,progress,predecessors:[]}: 新作业。PUT /projects/{project}/activities/{activity} {version,code,name,duration,progress,predecessors:[]}: 修改作业。DELETE /projects/{project}/activities/{activity} {}: 删除作业。GET /projects/{project}/resources: 资源。GET /projects/{project}/todos: 待办。POST /projects/{project}/todos {title,owner_id,due_date,priority}: 新待办。PATCH /todos/{todo} {version,done}: 完成待办。GET /objects/workspaces: 管理层级。GET /objects/workspaces/{workspace}/projects; GET /objects/projects/{project}/tables; GET /objects/tables/{table}/records。其他业务路由可以在权限允许时调用；失败以服务端消息为准。数据表写入值不能包含只读公式/系统字段，工期为整数项目工作日，按项目日历换算。`;
