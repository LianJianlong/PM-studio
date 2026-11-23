import translations from './locales/en.json';
export type InterfaceLanguage='zh-CN'|'en';
let currentLanguage:InterfaceLanguage='zh-CN';
export function setInterfaceLanguage(language:InterfaceLanguage){currentLanguage=language;}
export function interfaceLocale(){return currentLanguage==='en'?'en-GB':'zh-CN';}
const dictionary:Record<string,string>=translations;
const hasChinese=(text:string)=>/[\u3400-\u9fff]/.test(text);
function escapeRegex(text:string){return text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
const patterns=Object.entries(dictionary).filter(([key])=>/\{\d+\}/.test(key)).sort((a,b)=>b[0].length-a[0].length).map(([source,target])=>{
 const keys:number[]=[];let at=0,regex='';
 for(const match of source.matchAll(/\{(\d+)\}/g)){regex+=escapeRegex(source.slice(at,match.index))+'([\\s\\S]*?)';keys.push(Number(match[1]));at=match.index!+match[0].length;}
 return {regex:new RegExp('^'+regex+escapeRegex(source.slice(at))+'$'),target,keys};
});
export function translateUiText(text:string):string{
 if(currentLanguage!=='en'||!hasChinese(text))return text;
 const normalized=text.replace(/\s+/g,' ').trim();
 if(dictionary[normalized])return text.trim()===normalized?text.replace(normalized,dictionary[normalized]):dictionary[normalized];
 for(const pattern of patterns){const match=normalized.match(pattern.regex);if(match){const args:Record<number,string>={};pattern.keys.forEach((key,i)=>args[key]=match[i+1]);return pattern.target.replace(/\{(\d+)\}/g,(_,id)=>args[Number(id)]??'');}}
 return text;
}
export function translateUiValue<T>(value:T):T{
 if(typeof value==='string')return translateUiText(value) as T;
 if(Array.isArray(value))return value.map(v=>translateUiValue(v)) as T;
 return value;
}
export function localizeChart(value:unknown):unknown{
 if(typeof value==='string')return translateUiText(value);
 if(Array.isArray(value))return value.map(localizeChart);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,localizeChart(v)]));
 return value;
}

export function formatUiTemplate(source:string,args:unknown[]):string{
 const target=currentLanguage==='en'?(dictionary[source]||source):source;
 return target.replace(/\{(\d+)\}/g,(_,id)=>String(args[Number(id)]??''));
}
