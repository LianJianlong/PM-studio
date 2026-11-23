import {marked} from 'marked';import {cleanDocument} from './document-content.ts';
import {escapeDocument} from '../shared/toolbox-document.ts';import {visibleAIAnswer} from '../shared/ai-context.ts';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export function formatDocumentAIResult(value:string,labels:Record<string,string>={}){
 const text=visibleAIAnswer(value).replace(/```html\s*\n?([\s\S]*?)```/gi,'$1').replace(/^\s*```(?:html)?[ \t]*\r?\n/i,'').replace(/```\s*$/,'').trim();
 return cleanDocument(marked.parse(text,{async:false}) as string,text=>text
  .replace(new RegExp('[（(]\\s*(?:ID|UUID|\\u6807\\u8bc6|\\u7f16\\u53f7)\\s*[:：]\\s*'+uuid+'\\s*[)）]','gi'),'')
  .replace(new RegExp('\\b'+uuid+'\\b','gi'),id=>escapeDocument(labels[id]||'')));
}
