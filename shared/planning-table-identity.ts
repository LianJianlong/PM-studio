export function planningTableLabel(kind?:string|null){return kind==='wbs'?'计划管理 · WBS':kind==='organization'?'计划管理 · 组织架构':'';}
export function ambiguousPlanningName(name:string){const value=name.trim().toLowerCase();return ['wbs','项目wbs'].includes(value)?'wbs':['组织架构','项目组织架构'].includes(value)?'organization':null;}
