import {resourceCost,resourceUnits,resourceTicks,resourceText} from './resource-values.ts';
export const inProgress=(a:any)=>!!a.actual_start||Number(a.progress)>0;
export function remainingDays(a:any,hoursPerDay:number){
 if(a.actual_finish||Number(a.progress)>=100)return 0;
 const days=a.remaining_duration!=null?Number(a.remaining_duration):Number(a.duration)*(1-Number(a.progress)/100);
 return Math.max(0,Math.ceil(days*hoursPerDay-1e-7)/hoursPerDay);
}
export function remainingCostSummary(allocations:{remaining_forecast_cost:string;actual_cost:string}[]){
 const remaining=allocations.reduce((n,r)=>n+resourceTicks(r.remaining_forecast_cost),0n),actual=allocations.reduce((n,r)=>n+resourceTicks(r.actual_cost),0n);
 return {remaining_cost:resourceText(remaining),actual_cost:resourceText(actual),forecast_total_cost:resourceText(actual+remaining)};
}
export function remainingAllocation(a:any,r:any,allocation:any,days:number,hoursPerDay=8){
 const quantity=allocation.remaining_quantity??allocation.quantity;
 const units=resourceUnits(String(quantity),String(days)),cost=resourceCost(String(quantity),String(r.rate),String(days));
 return {remaining_quantity:String(quantity),remaining_units:units,remaining_hours:Math.round(days*hoursPerDay),remaining_duration:days,remaining_forecast_cost:cost,forecast_total_cost:resourceText(resourceTicks(cost)+resourceTicks(String(allocation.actual_cost||'0'))),has_remaining_override:allocation.remaining_quantity!=null};
}
