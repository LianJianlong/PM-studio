/** Business semantics shared by chat compilation and discovery. Instance data remains project-scoped. */
export const businessActions=['activity.update','wbs.add_child','resource.create','resource.update','resource.deactivate','allocation.assign'] as const;
export type BusinessScope={activity_table?:string;wbs_table?:string;activities:{id:string;record_id:string;code:string;name:string;status?:string;version?:number;record_version?:number}[];resources:any[];resources_access?:'allowed'|'denied'|'not_requested';resources_loaded:number;resources_total:number};
export const businessActionHelp={
 'activity.update':'更新真实作业数据表中的作业。target=已读编码/唯一名称/记录ID；data=原表可见字段，duration是项目工作日。通过原记录接口，普通有效数据修改后待主管重新确认，不直接改投影activities。',
 'wbs.add_child':'在真实WBS表下新增子项。target=已读父WBS编码/唯一名称；data={name,code?:自定义编码,...}。parent由服务器绑定；不要手写层级或猜父ID，最多50层沿用原校验。',
 'resource.create':'新增资源。key=本方案唯一标识；data={name,kind:human|equipment|material|expense,unit?,rate?,capacity?,...}。未知实际数值不编造。',
 'resource.update':'更新已读资源。target=唯一编码/名称/ID；data仅需变化字段。单价、币种、费率和分配影响由原接口校验。',
 'resource.deactivate':'停用已读资源，target为唯一编码/名称/ID。仅用户明确要求删除/停用时使用。',
 'allocation.assign':'为已有有效作业分配资源，或更新其已有分配。target=已读作业编码/唯一名称；resource=已读资源编码/唯一名称，或本方案新资源的$steps.KEY.id；data={quantity:精确字符串,reason?:说明}。数量为每日分配率，费用由原业务计算，不猜实际费用，不写计算表。'
};
const resourceFields=['code','kind','name','unit','rate','capacity','productivity','configuration','currency','sale_rate','tax_rate','stock_quantity','productivity_unit'] as const;
export function resourceBusinessOperation(op:any,project:string,scope:BusinessScope,created:Map<string,string>,versions:Map<string,number>){
 const find=(token:string)=>{const exact=scope.resources.find(r=>r.id===token);const matches=exact?[exact]:scope.resources.filter(r=>r.code===token||r.name===token);if(matches.length!==1)throw Error('资源未读取、不可见或名称/编码不唯一');return matches[0]};
 const data=op.data||{};
 if(op.action==='allocation.assign'){
  if(Object.keys(data).some(k=>!['quantity','reason'].includes(k)))throw Error('分配操作仅接收quantity和reason，费用与实绩由原业务计算');
  if(data.quantity===undefined)throw Error('资源分配必须提供明确数量quantity');
  const matches=scope.activities.filter(a=>[a.id,a.record_id,a.code,a.name].includes(op.target));if(matches.length!==1)throw Error('作业未读取、不可见或编码/名称不唯一');
  const activity=matches[0];if(activity.status&&activity.status!=='approved')throw Error('资源只能分配到已确认有效的作业，请先由主管确认');const newResource=created.get(op.resource);const resource=newResource?null:find(op.resource);const id=newResource||resource!.id;
  const original=resource?.allocations?.find((a:any)=>a.activity_id===activity.id);const versionKey='allocation:'+activity.id+':'+id;
  const version=versions.get(versionKey)??original?.version??0;versions.set(versionKey,version+1);
  const locked=versions.has('activity-lock:'+activity.id);versions.set('activity-lock:'+activity.id,1);
  return {method:'POST',path:`/activities/${activity.id}/resources`,body:{resource_id:id,quantity:data.quantity,reason:data.reason||'',version,resource_version:newResource?1:versions.get(id)??resource!.version,...(!locked?{activity_version:activity.version,activity_record_version:activity.record_version}:{})}};
 }
 if(Object.keys(data).some(k=>!resourceFields.includes(k as any)))throw Error('存在未知资源业务字段');
 if(op.action==='resource.create'){
  if(!op.key||created.has('$steps.'+op.key+'.id'))throw Error('新增资源需要唯一key');
  if(!data.name||!data.kind)throw Error('新增资源需要名称和类型');
  created.set('$steps.'+op.key+'.id','$steps.'+op.key+'.id');return {method:'POST',path:`/projects/${project}/resources`,body:data};
 }
 const current=find(op.target);
 if(op.action==='resource.deactivate'&&Object.keys(data).length)throw Error('停用资源不能夹带字段修改');
 if(op.action==='resource.deactivate')return {method:'DELETE',path:`/projects/${project}/resources/${current.id}`,body:{version:current.version}};
 if(!Object.keys(data).length)throw Error('资源修改需要非空data');
 if(versions.has(current.id))throw Error('同一资源请合并为一次修改，避免覆盖前一步变化');const version=current.version;versions.set(current.id,version+1);
 return {method:'PUT',path:`/projects/${project}/resources/${current.id}`,body:{...Object.fromEntries(resourceFields.filter(k=>current[k]!==undefined).map(k=>[k,current[k]])),...data,version}};
}
