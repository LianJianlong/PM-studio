/** Keep recent goals and outcomes, not verbose tool transcripts. Current request is never truncated here. */
export function compactAIHistory(history:{role:'user'|'assistant';text:string}[]){
 return history.slice(-4).map(m=>({role:m.role,text:(m.role==='assistant'?m.text.replace(/```[\s\S]*?```/g,'[详细内容已省略，需通过工具重新读取]'):m.text).split('\n').map(s=>s.trim()).filter(s=>s&&!/^\|[- :|]+\|$/.test(s)).slice(0,12).join('\n').slice(0,1200)}));
}
export function hasWriteIntent(prompt:string){
 const text=prompt.replace(/@\[[\s\S]*?\]\([^)]*\)/g,'').trim();
 // References and questions about changes do not authorize changes themselves.
 if (/^(?:请|帮我|麻烦|please\s+)*(?:查询|查一下|查看|列出|统计|汇总|分析|归纳|总结|比较|解释|说明|如何|怎么|怎样|能否|是否|query\b|list\b|show\b|summari[sz]e\b|analy[sz]e\b)/i.test(text)
   && !/(?:并|然后|同时|再|并且|and\s+then)[，,\s]*(?:请|帮我)*(?:新增|添加|写入|修改|删除|更新|创建|录入|补充|完善|create\b|insert\b|update\b|delete\b)/i.test(text)) return false;
 return /为.+分配|给.+分配|分配.+(?:给|到)|停用|禁用|\b(allocate|assign|deactivate)\b|完善|补全|编写|拟定|撰写|改成|改为|新增|添加|写入|修改|删除|更新|填入|补充|创建|录入|增补|更名|重命名|\b(create|insert|update|delete|rename|add|edit)\b/i.test(text);
}
/** Normalize only unambiguous tool-envelope aliases; never change business values. */
export function normalizeTableToolArgs(name:string,args:any){
 if(!args||typeof args!=='object'||Array.isArray(args))return args;
 const out={...args};for(const key of ['table_id','table_name','column_id'])if(out[key]===''||out[key]===null)delete out[key];
 const aliases:Record<string,string>=name==='table_records'?{list:'query',read:'query',search:'query',get:'query',insert:'create',add:'create',edit:'update',remove:'delete'}:{get:'inspect',list:'inspect',read:'inspect',create:'add',edit:'update',rename:'update',drop:'delete'};
 out.action=aliases[out.action]||out.action;if(name==='table_records'&&out.action!=='query'){delete out.page;delete out.search;}return out;
}

/** Display only the answer when a provider embeds reasoning in its text channel. */
export function visibleAIAnswer(text:string){
 return text.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<(?:think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*$/gi,'').trim();
}
