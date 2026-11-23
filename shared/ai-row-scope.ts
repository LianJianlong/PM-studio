/** Stable aliases never point at a different record when another page/search is loaded. */
export function mergeAIRows(existing:any|undefined,incoming:any[],sameSearch:boolean,limit=1000){
 const aliases:Record<string,string>={...(existing?.row_aliases||{})},known=new Set(Object.values(aliases));let serial=Object.keys(aliases).length;
 for(const r of incoming)if(!known.has(r.id)){aliases['row_'+(++serial)]=r.id;known.add(r.id);}
 const merged=sameSearch?[...(existing?.rows||[])]:[],positions=new Map(merged.map((r:any,i:number)=>[r.id,i]));
 for(const r of incoming){const at=positions.get(r.id);if(at!==undefined)merged[at]=r;else if(merged.length<limit){positions.set(r.id,merged.length);merged.push(r);}}
 return {rows:merged,row_aliases:aliases};
}
