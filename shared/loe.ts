export class LoeError extends Error{constructor(message:string){super(message);this.name='LoeError'}}
export const LOE='LOE持续性作业';
export const isLoe=(a:any)=>a?.activity_type===LOE;
export function loeReferenceField(table:string){return {id:'loe_scope',name:'LOE关联作业',type:'reference',target_table:table,display_column:'name'};}
/** Keep complete executable chains; LOE follows its scope and never drives ordinary work. */
export function completeLoeScope<T extends {id:string;predecessors:any[];loe_scope?:string[];activity_type?:string}>(rows:T[],allLoeIds=new Set(rows.filter(isLoe).map(a=>a.id)),allowUnconfigured=false){
 let result=rows;
 for(;;){const ids=new Set(result.map(a=>a.id));const next=result.filter(a=>isLoe(a)?(!a.loe_scope?.length?allowUnconfigured:a.loe_scope.every(id=>ids.has(id))):a.predecessors.every(d=>allLoeIds.has(d.id)||ids.has(d.id)));if(next.length===result.length)return result.map(a=>({...a,predecessors:a.predecessors.filter(d=>ids.has(d.id))}));result=next;}
}
