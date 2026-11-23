export function operationOutcome(change:any,receipt?:any){
 if(receipt?.ok||change.status==='done')return {state:'written',label:'已写入',recoverable:false};
 if(['executing','unknown'].includes(change.status))return {state:'unknown',label:'结果待核实',recoverable:true};
 if(change.status==='cancelled')return {state:'cancelled',label:'已取消，未写入',recoverable:false};
 if(change.status==='pending'&&new Date(change.expires_at)<=new Date())return {state:'expired',label:'已过期，未写入',recoverable:false};
 if(change.status==='failed')return {state:change.result?.rolled_back?'rolled_back':'failed',label:change.result?.rolled_back?'执行失败，整批已回滚':'执行失败，请查看结果',recoverable:false};
 return {state:'review',label:'待预览确认，未写入',recoverable:false};
}
