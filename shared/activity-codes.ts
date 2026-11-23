export type ActivityCodeRule={auto_code:boolean;code_prefix:string;code_start:string;code_step:string;code_width:number;code_fill_gaps:boolean};
export function codeRule(field:any):ActivityCodeRule{return {auto_code:field?.auto_code!==false,code_prefix:field?.code_prefix??'ACT-',code_start:field?.code_start??'1',code_step:field?.code_step??'1',code_width:field?.code_width??3,code_fill_gaps:field?.code_fill_gaps??false};}
export function activityCode(rule:ActivityCodeRule,n:bigint){if(n<1n||n>999999999999n)throw Error('作业编码已达到数字上限');const code=rule.code_prefix+String(n).padStart(rule.code_width,'0');if(code.length>40)throw Error('作业编码不能超过40个字符');return code;}
export function codeSuggestions(rule:ActivityCodeRule,used:string[],count=5){
 const reserved=new Set(used);let n=BigInt(rule.code_start),step=BigInt(rule.code_step);
 if(step<1n)throw Error('编码间隔须大于0');
 if(!rule.code_fill_gaps)for(const value of used){if(value.startsWith(rule.code_prefix)){const suffix=value.slice(rule.code_prefix.length);if(/^\d{1,12}$/.test(suffix)&&BigInt(suffix)+step>n)n=BigInt(suffix)+step;}}
 const out:string[]=[];while(out.length<count){const code=activityCode(rule,n);if(!reserved.has(code)){out.push(code);reserved.add(code)}n+=step;}return out;
}
export function renumberActivityCodes(rule:ActivityCodeRule,rows:{id:string;code:string}[],outside:string[]){
 const taken=new Set(outside),start=BigInt(rule.code_start),step=BigInt(rule.code_step);
 if(step<1n)throw Error('编码间隔须大于0');
 return rows.map((r,i)=>{const code=activityCode(rule,start+BigInt(i)*step);if(code!==r.code&&taken.has(code))throw Error('新编码与未选中的作业或保留记录冲突：'+code);return {...r,before:r.code,after:code,changed:code!==r.code};});
}
