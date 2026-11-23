export const ledgerSpecs:Record<string,{columns:string[];state:string;deadline:string;closed:string[]}>={
 safety:{columns:['name','finding','responsible','latest_update','closure_state','risk_level','due_date','location','discipline','subsystem','priority'],state:'closure_state',deadline:'due_date',closed:['已关闭']},
 quality:{columns:['name','batch','responsible','latest_update','result','inspector','due_date','inspection_date','discipline','subsystem','priority'],state:'result',deadline:'due_date',closed:['通过','复验通过']},
 design:{columns:['drawing_no','name','responsible','latest_update','drawing_state','planned_date','received_date','revision','discipline','subsystem','priority'],state:'drawing_state',deadline:'planned_date',closed:['批准施工','作废']},
 procurement:{columns:['material_name','name','responsible','latest_update','progress_state','progress_percent','planned_arrival','forecast_arrival','risk','supplier_name','order_no','discipline','subsystem','priority'],state:'progress_state',deadline:'planned_arrival',closed:['关闭']},
};
export function ledgerPriority(kind:string,data:Record<string,any>,today:string){const s=ledgerSpecs[kind];if(s.closed.includes(data[s.state]))return '已完成';if(data.priority==='紧急'||data.risk_level==='高'||data.result==='不通过')return '紧急';if(data.priority==='高'||data[s.deadline]&&data[s.deadline]<today)return '高';return data.priority==='低'?'低':'普通';}
