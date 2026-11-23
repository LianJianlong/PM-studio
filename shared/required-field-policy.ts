/** Only relax existing constraints. Never add required fields or change field identities. */
export function relaxRequiredColumns<T extends {id:string;required?:boolean;type?:string}>(columns:T[],templateKey?:string):T[]{
 const editable=columns.filter(f=>f.required&&f.type!=='formula'&&!['record_id','created_at','updated_at','created_by','updated_by','autonumber'].includes(f.type||''));
 if(editable.length<=5)return columns;
 const preferred=templateKey==='movements'?['date','material_code','unit','direction','quantity']:templateKey==='earned_snapshots'?['date','currency','pv','ev','ac']:['name','title','date','code','quantity','amount','status'];
 const rank=(f:T)=>{const i=preferred.indexOf(f.id);return i<0?preferred.length+columns.indexOf(f):i};
 const retained=new Set([...editable].sort((a,b)=>rank(a)-rank(b)).slice(0,5).map(f=>f.id));
 return columns.map(f=>f.required&&editable.includes(f)&&!retained.has(f.id)?{...f,required:false}:f);
}
