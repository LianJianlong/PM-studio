export function selectWorkflow<T extends {kind:string;active:boolean;table_ids?:string[];created_at?:string}>(flows:T[],kind:string,tableId?:string):T|undefined{
 const candidates=flows.filter(w=>w.active&&w.kind===kind&&(!(w.table_ids||[]).length||(kind==='record'&&!!tableId&&w.table_ids!.includes(tableId))));
 return candidates.sort((a,b)=>Number(!!b.table_ids?.length)-Number(!!a.table_ids?.length)||String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
}

export function availableWorkflows<T extends {kind:string;active:boolean;table_ids?:string[]}>(flows:T[],kind:string,tableId?:string):T[]{return flows.filter(w=>w.active&&w.kind===kind&&(!(w.table_ids||[]).length||(kind==='record'&&!!tableId&&w.table_ids!.includes(tableId))))}
