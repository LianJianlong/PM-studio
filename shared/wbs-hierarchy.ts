export type WbsNode = { id: string; data: { code?: string; name?: string; parent?: string[] }; created_at?: string };

export function orderWbs<T extends WbsNode>(rows: T[], sortField = 'code', direction: 1|-1 = 1) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const children = new Map<string, T[]>();
  const originalOrder = new Map(rows.map((row,index)=>[row.id,index]));
  const collator = new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  const compare = (left:T,right:T) => {
    const a=(left.data as Record<string,unknown>)[sortField],b=(right.data as Record<string,unknown>)[sortField];
    const value=(input:unknown)=>Array.isArray(input)?input.join(' / '):String(input??'');
    const result=collator.compare(value(a),value(b))*direction;
    return result || (originalOrder.get(left.id)!-originalOrder.get(right.id)!);
  };
  for (const row of rows) {
    const parent = row.data.parent?.[0];
    const key = parent && byId.has(parent) && parent !== row.id ? parent : '';
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(row);
  }
  for (const siblings of children.values()) siblings.sort(compare);
  const result: Array<{ row: T; depth: number }> = [];
  const visited = new Set<string>();
  function visit(start: T) {
    const stack: Array<{row:T;depth:number}> = [{row:start,depth:0}];
    while (stack.length) {
      const {row,depth} = stack.pop()!;
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      result.push({row,depth});
      for (const child of (children.get(row.id) || []).slice().reverse()) stack.push({row:child,depth:depth+1});
    }
  }
  for (const root of children.get('') || []) visit(root);
  for (const row of rows) visit(row);
  return result;
}

export function wbsLevelColor(depth: number) {
  const hue = (depth * 137.508 + 164) % 360;
  return `hsl(${hue.toFixed(3)} 62% 34%)`;
}

export type WbsMoveNode={id:string;depth:number;parent_id:string|null;code?:string;name?:string};
export function wbsMoveTarget(nodes:WbsMoveNode[],id:string):string|null|undefined{
  const index=nodes.findIndex(node=>node.id===id);
  if(index<0)return undefined;
  const current=nodes[index];
  if(!current.parent_id)return undefined;
  return nodes.find(node=>node.id===current.parent_id)?.parent_id;
}
export function wbsDemoteCandidates(nodes:WbsMoveNode[],id:string){
  const current=nodes.find(node=>node.id===id);
  if(!current||current.depth>=49)return [];
  const byId=new Map(nodes.map(node=>[node.id,node]));
  return nodes.filter(node=>{
    if(node.id===id||node.depth<current.depth||node.depth>=49)return false;
    let parent=node.parent_id;const seen=new Set<string>();
    while(parent&&!seen.has(parent)){
      if(parent===id)return false;
      seen.add(parent);parent=byId.get(parent)?.parent_id||null;
    }
    return true;
  });
}
export function wbsDefaultDemoteParent(nodes:WbsMoveNode[],id:string){
  const current=nodes.find(node=>node.id===id);
  if(!current)return undefined;
  const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
  return wbsDemoteCandidates(nodes,id)
    .filter(node=>collator.compare(node.code||'',current.code||'')<0)
    .sort((a,b)=>collator.compare(b.code||'',a.code||''))[0]?.id;
}
