import {resourceTicks,resourceText} from './resource-values.ts';
export function costAccountOrder(accounts:any[]){
 const lookup=new Map<string,any>(accounts.map(a=>[a.id,a])),children=new Map<string,any[]>();
 for(const a of accounts){const seen=new Set<string>([a.id]);let parent=a.parent_id,depth=1;while(parent){if(seen.has(parent))throw Error('费用科目不能循环引用');seen.add(parent);const p=lookup.get(parent);if(!p)throw Error('费用科目父级不存在');parent=p.parent_id;if(++depth>50)throw Error('费用科目最多50层');}
  const key=a.parent_id||'';if(!children.has(key))children.set(key,[]);children.get(key)!.push(a);
 }
 for(const rows of children.values())rows.sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true})||a.id.localeCompare(b.id));
 const result:any[]=[],pending=(children.get('')||[]).map(a=>({a,depth:1})).reverse();while(pending.length){const {a,depth}=pending.pop()!;result.push({...a,depth});for(const child of [...(children.get(a.id)||[])].reverse())pending.push({a:child,depth:depth+1});}return result;
}
export function costAccountSummary(accounts:any[],rows:any[]){
 const ordered=costAccountOrder(accounts),keys=['planned_cost','actual_cost','remaining_forecast_cost','forecast_total_cost'] as const;
 const empty=()=>Object.fromEntries(keys.map(k=>[k,0n])) as Record<typeof keys[number],bigint>;
 const own=new Map<string,ReturnType<typeof empty>>(),grand=empty();
 for(const row of rows){const key=row.account_id||'',sum=own.get(key)||empty();for(const k of keys){sum[k]+=resourceTicks(row[k]);grand[k]+=resourceTicks(row[k]);}own.set(key,sum);}
 const roll=new Map([...own].map(([k,v])=>[k,{...v}]));
 for(const a of [...ordered].reverse()){const value=roll.get(a.id)||empty();roll.set(a.id,value);if(a.parent_id){const p=roll.get(a.parent_id)||empty();for(const k of keys)p[k]+=value[k];roll.set(a.parent_id,p);}}
 const format=(v:ReturnType<typeof empty>)=>Object.fromEntries(keys.map(k=>[k,resourceText(v[k])])) as Record<typeof keys[number],string>;
 return {totals:format(grand),accounts:ordered.map(a=>({...a,direct:format(own.get(a.id)||empty()),rollup:format(roll.get(a.id)||empty())})),unclassified:format(own.get('')||empty())};
}
