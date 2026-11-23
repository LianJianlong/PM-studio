import {BATCH_CREATE_LIMIT} from './batch-limits.ts';
/** Correct the common batch-create shape without guessing field names or values. */
export function normalizeAIRecordWrite<T extends {method:string;path:string;body?:Record<string,unknown>}>(input:T):T{
 if(input.method!=='POST'||!/^\/tables\/[a-f0-9-]{36}\/records$/i.test(input.path))return input;
 const body=input.body||{};
 if(!Object.hasOwn(body,'records'))return input;
 if(Object.keys(body).length!==1||!Array.isArray(body.records)||!body.records.length||body.records.length>BATCH_CREATE_LIMIT||!body.records.every(row=>row&&typeof row==='object'&&!Array.isArray(row)))
  throw new Error('批量新增须提供1至5000条字段值对象；单条新增使用 {data:{字段ID:值}}');
 return {...input,path:input.path.replace(/\/records$/,'/import'),body:{rows:body.records}};
}
