export const relationColumns = [
  {id:'predecessors', name:'前置任务'},
  {id:'successors', name:'后置任务'},
  {id:'type', name:'关系类型（FS / FF / SS / SF）'},
  {id:'lead', name:'提前（工作日）'},
  {id:'lag', name:'滞后（工作日）'},
] as const;
export const planComputedColumns = [
 {id:'actual_elapsed_hours',name:'已历工时（按日期）',description:'按实际开始至实际完成或状态日期日初的项目日历时长，不是资源实际工时。'},
 {id:'remaining_work_hours',name:'剩余工作小时',description:'显式剩余工期或现有估算，最小整数工作小时。'},
  {id:'free_float',name:'自由浮时（工作日）',description:'不推迟紧后作业最早安排的允许延误时间。'},
  {id:'total_float',name:'总浮时（工作日）',description:'不推迟要求完工或网络完工的允许延误时间；负值表示约束无法满足，关键性按项目设置判定。'},
] as const;
export const planTableColumns=[...relationColumns,...planComputedColumns,{id:'resource_allocations',name:'资源分配'}];
export function activityRelations(activityId: string, activities: any[]) {
  const current = activities.find(a => a.id === activityId);
  if (!current) return [];
  const incoming = (current.predecessors || []).map((edge: any) => ({
    predecessor: edge.id, successor: current.id, type: edge.type,
    lag: edge.lag, version: current.version, direction: '前置',
    other: activities.find(a => a.id === edge.id), editable: !!current.custom_editable,
  }));
  const outgoing = activities.flatMap(a => (a.predecessors || [])
    .filter((edge: any) => edge.id === activityId).map((edge: any) => ({
      predecessor: activityId, successor: a.id, type: edge.type,
      lag: edge.lag, version: a.version, direction: '后置', other: a,
      editable: !!a.custom_editable,
    })));
  return [...incoming, ...outgoing];
}
export function relationInterval(mode: string, days: number) {
  if (!Number.isInteger(days) || days < 0 || days > 3650)
    throw Error('提前／滞后天数必须是 0～3650 的整数');
  if (!['none','lead','lag'].includes(mode)) throw Error('无效的时间间隔');
  return mode === 'none' ? 0 : mode === 'lead' ? -days : days;
}
