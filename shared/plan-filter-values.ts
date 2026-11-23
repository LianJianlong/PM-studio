import {activityRelations,relationColumns,planComputedColumns} from './plan-relations';
export const planFilterColumns=[...relationColumns.map(c=>({id:'__plan_'+c.id,name:c.name,type:'text'})),...planComputedColumns.map(c=>({id:'__plan_'+c.id,name:c.name,type:'decimal'})),{id:'__plan_resource_allocations',name:'资源分配',type:'text'}];
export function planFilterValues(record:string,context:any){
 const current=context?.activities?.find((a:any)=>a.record_id===record);if(!current)return {};
 const edges=activityRelations(current.id,context.activities),label=(a:any)=>a?.record_id?`${a.code} · ${a.name}`:'不可见作业';const out:Record<string,unknown>={};
 for(const c of relationColumns){const selected=c.id==='predecessors'?edges.filter(e=>e.direction==='前置'):c.id==='successors'?edges.filter(e=>e.direction==='后置'):edges;out['__plan_'+c.id]=selected.map(e=>c.id==='predecessors'||c.id==='successors'?label(e.other):c.id==='type'?e.type:String(c.id==='lead'?Math.max(0,-e.lag):Math.max(0,e.lag))).join('；')}
 for(const c of planComputedColumns)out['__plan_'+c.id]=current.metrics?.[c.id]!=null?Number(current.metrics[c.id].toFixed(4)):null;
 out.__plan_resource_allocations=(current.allocations||[]).map((a:any)=>[a.code,a.name,a.quantity,a.remaining_quantity,a.unit].filter(v=>v!==null&&v!==undefined).join(' ')).join('；');return out;
}
