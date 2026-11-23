import {isLoe} from '../shared/loe.ts';
import {resourceCost,resourceTicks,resourceText} from '../shared/resource-values.ts';
import {requireThat} from './auth.ts';
import type pg from 'pg';
export async function captureBaselineBudget(c:pg.Pool|pg.PoolClient,project:string,activities:any[],currency:string){
 const mismatch=await c.query('SELECT 1 FROM activity_resource_allocations x JOIN activities a ON a.id=x.activity_id JOIN project_resources r ON r.id=x.resource_id WHERE a.project_id=$1 AND a.id=ANY($2::uuid[]) AND r.currency<>$3 LIMIT 1',[project,activities.map(a=>a.id),currency]);
 requireThat(!mismatch.rowCount,400,'资源费用币种与项目不一致，请先统一币种');
 const rows=(await c.query(`SELECT x.activity_id,SUM(x.planned_cost)::text budget FROM activity_resource_allocations x
 JOIN activities a ON a.id=x.activity_id JOIN project_resources r ON r.id=x.resource_id AND r.project_id=a.project_id
 WHERE a.project_id=$1 AND a.id=ANY($2::uuid[]) GROUP BY x.activity_id`,[project,activities.map(a=>a.id)])).rows;
 const support=activities.filter(isLoe);
 if(support.length){const allocations=(await c.query('SELECT x.activity_id,x.quantity::text,r.rate::text FROM activity_resource_allocations x JOIN project_resources r ON r.id=x.resource_id AND r.project_id=$1 WHERE x.activity_id=ANY($2::uuid[])',[project,support.map(a=>a.id)])).rows;for(const a of support){const budget=resourceText(allocations.filter(x=>x.activity_id===a.id).reduce((sum,x)=>sum+resourceTicks(resourceCost(x.quantity,x.rate,String(a.duration))),0n));const row=rows.find(x=>x.activity_id===a.id);if(row)row.budget=budget;else rows.push({activity_id:a.id,budget});}}
 return {currency,budget_capture:'approved_resource_plan_v2',budget_by_activity:Object.fromEntries(activities.map(a=>[a.id,rows.find(r=>r.activity_id===a.id)?.budget||'0.0000']))};
}
