import {z} from 'zod';
export const documentPage=z.object({page_numbers:z.boolean().default(false),orientation:z.enum(['portrait','landscape']).default('portrait'),margin:z.number().int().min(10).max(30).default(20),header:z.string().max(300).default(''),footer:z.string().max(300).default(''),font:z.enum(['system','song','hei','kai','arial','times']).default('song'),size:z.number().int().min(8).max(28).default(12)}).strict();
export const univerSnapshot=z.record(z.string(),z.unknown()).nullable().optional().superRefine((value,ctx)=>{
 if(value==null)return;
 const serialized=JSON.stringify(value);
 if(serialized.length>2500000||typeof (value.body as any)?.dataStream!=='string'||!(value.documentStyle&&typeof value.documentStyle==='object'))ctx.addIssue({code:'custom',message:'Invalid Univer document'});
 let count=0;
 function check(node:unknown,depth:number){if(++count>100000||depth>60){ctx.addIssue({code:'custom',message:'Document is too complex'});return}if(!node||typeof node!=='object')return;for(const [key,item] of Object.entries(node)){if(['__proto__','prototype','constructor'].includes(key)||(typeof item==='string'&&['src','source','imageSource'].includes(key)&&/^(?:https?:|file:|javascript:|blob:|\/\/)/i.test(item)))ctx.addIssue({code:'custom',message:'Unsafe document resource'});if(typeof item==='object')check(item,depth+1)}}
 check(value,0);for(const resource of (Array.isArray(value.resources)?value.resources:[])){if(typeof resource?.data==='string'&&resource.data){try{check(JSON.parse(resource.data),0)}catch{ctx.addIssue({code:'custom',message:'Invalid document resource'})}}}
});
export const documentBody=z.object({name:z.string().trim().min(1).max(120),folder_id:z.uuid().nullable().default(null),univer:univerSnapshot,content:z.string().max(1500000).default('<p></p>'),page:documentPage.default({page_numbers:false,orientation:'portrait',margin:20,header:'',footer:'',font:'song',size:12}),version:z.number().int().positive().optional()}).strict();
export type StudioDocument=z.infer<typeof documentBody>&{id?:string;updated_at?:string};
export const emptyDocument:StudioDocument=documentBody.parse({name:'未命名文档'});
export function escapeDocument(v:string){return v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
export function documentChartPoints(rows:{name:string;raw:string}[]){if(!rows.length)throw Error('没有可绘制的数据');return rows.map(p=>{const raw=p.raw.trim(),value=Number(raw);if(!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw)||!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('图表数值列必须为非空数字');return {name:p.name,value}})}
