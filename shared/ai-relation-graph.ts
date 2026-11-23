/** Human-facing graph metadata comes from authorized backend reads, never model prose. */
export function relationVisualization(result:{source:string;nodes:any[];edges:any[];coverage:{depth:number;truncated:boolean}}){
 const nodes=result.nodes.map(n=>({key:n.table_id+':'+n.id,table_id:n.table_id,record_id:n.id,label:n.table_name+' / '+n.title,kind:'source',status:n.status,version:n.version}));
 const byId=new Map(result.nodes.map(n=>[n.id,n.table_id+':'+n.id]));const seen=new Set<string>();
 const edges=result.edges.flatMap(e=>{const from=byId.get(e.from),to=byId.get(e.to),key=JSON.stringify([from,to,e.relation]);if(!from||!to||seen.has(key))return [];seen.add(key);return [{from,to,label:e.relation,kind:'reference'}]});
 return {title:'业务关联路径 · '+result.source,nodes,edges,status:'relations_only',missing:edges.length?[]:['本次权限与层数范围内未找到可绘制的显式引用；请核对关联字段，未找到不代表不存在业务影响。'],truncated:result.coverage.truncated,legend:'节点表示已读业务记录，箭头表示实际引用方向；未有效记录以虚线标出，不参与正式统计。点击节点查看当前依据。',notice:'仅展示当前项目与当前账号权限内的显式关联，不代表因果关系或确定影响；未执行排程、费用试算或写入。未绘制不代表不存在；请结合读取层数及截取范围。',coverage:result.coverage};
}
/** Breadth first levels on the undirected neighborhood preserve directed arrows but tolerate cycles. */
export function relationGraphPositions(nodes:{key:string}[],edges:{from:string;to:string}[]){
 const keys=new Set(nodes.map(n=>n.key)),neighbors=new Map(nodes.map(n=>[n.key,new Set<string>()]));
 for(const e of edges)if(keys.has(e.from)&&keys.has(e.to)){neighbors.get(e.from)!.add(e.to);neighbors.get(e.to)!.add(e.from);}
 const ranks=new Map<string,number>();let componentBase=0;
 for(const seed of nodes){if(ranks.has(seed.key))continue;ranks.set(seed.key,componentBase);const queue=[seed.key];let end=componentBase;for(let i=0;i<queue.length;i++){const key=queue[i],rank=ranks.get(key)!;for(const next of neighbors.get(key)!){if(ranks.has(next))continue;ranks.set(next,rank+1);end=Math.max(end,rank+1);queue.push(next);}}componentBase=end+1;}
 const lanes=new Map<number,number>();return nodes.map(n=>{const rank=ranks.get(n.key)!,lane=lanes.get(rank)||0;lanes.set(rank,lane+1);return {key:n.key,x:20+rank*340,y:30+lane*140}});
}
