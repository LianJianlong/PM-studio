const referencePattern=()=>/@\[([\s\S]*?)\]\(project:[^)]*\)/g;
const uuid=/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi;
/** Visible labels are presentation only; the original opaque reference is retained for transport. */
export class AIReferenceLabels {
 private rawToLabel=new Map<string,string>();
 private labelToRaw=new Map<string,string>();
 display(text:string){return text.replace(referencePattern(),(raw,title:string)=>{
  const known=this.rawToLabel.get(raw);if(known)return known;
  const clean=title.replace(uuid,'').replace(/\s*·\s*(?=\/|$)/g,'').trim()||'引用';
  let label=`@[${clean}]`,n=2;
  while(this.labelToRaw.has(label)&&this.labelToRaw.get(label)!==raw)label=`@[${clean}（同名项 ${n++}）]`;
  this.rawToLabel.set(raw,label);this.labelToRaw.set(label,raw);return label;
 });}
 expand(text:string){
  // One pass prevents expanding any token inside an already expanded reference.
  return text.replace(/@\[[^\]\n]*\](?:\(project:[^)]*\))?/g,token=>this.labelToRaw.get(token)||token);
 }
}
export function displayAIText(text:string){
 return text.replace(referencePattern(),(_raw,title:string)=>`@[${title.replace(uuid,'').replace(/\s*·\s*(?=\/|$)/g,'').trim()}]`).replace(uuid,'').trim();
}
