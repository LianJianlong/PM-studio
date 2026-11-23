export const resourceGridFields=['code','name','kind','unit','productivity','rate','capacity','configuration','calendar','sale_rate','tax_rate','stock_quantity','productivity_unit','currency'] as const;
export type ResourceGridField={key:string;label:string;anchor:string;side:'left'|'right'};
export function resourceGridOrder(custom:ResourceGridField[]){
  const keys:string[]=[...resourceGridFields];
  for(const field of custom){
    const index=keys.indexOf(field.anchor);
    keys.splice(index<0?keys.length:index+Number(field.side==='right'),0,field.key);
  }
  return keys;
}
