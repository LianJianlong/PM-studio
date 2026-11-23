/** Normalize unambiguous read-only argument aliases. Business values are never changed. */
export function normalizeBusinessReadShape(value:any){
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const b={...value};b.mode=({query:'search',read:'search',list:'search'} as Record<string,string>)[b.mode]||b.mode;
 if(b.table!==undefined){if(!b.table_id&&!b.table_name){if(typeof b.table==='string'&&/^[a-f0-9-]{36}$/i.test(b.table))b.table_id=b.table;else b.table_name=b.table;}delete b.table;}
 if(b.mode!=='plan'&&typeof b.dataset==='string'&&/^[a-f0-9-]{36}$/i.test(b.dataset)){if(b.table_id&&b.table_id!==b.dataset)throw Error('Conflicting table identities');b.table_id??=b.dataset;delete b.dataset;}
 if(b.field!==undefined){if(['sum','count','average','min','max'].includes(b.metric)){b.aggregation??=b.metric;b.metric=b.field;}else b.metric??=b.field;delete b.field;}
 if(b.mode==='aggregate'&&!b.dimension)b.dimension='__status__';
 return b;
}
