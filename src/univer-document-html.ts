import {DocumentDataModel} from '@univerjs/core';
// Normalize semantic HTML before handing it to Univer's clipboard converter.
// Its clipboard grammar expects styled paragraphs/spans rather than HTML headings.
export function prepareUniverHtml(html:string){
 const tree=new DOMParser().parseFromString(html,'text/html');
 const blocks=new Set(['P','H1','H2','H3','H4','H5','H6','UL','OL','TABLE','DIV','BLOCKQUOTE','PRE','HR']);
 for(const container of [tree.body,...Array.from(tree.querySelectorAll('li,td,th'))]){let paragraph:HTMLElement|null=null;
 for(const node of Array.from(container.childNodes)){
 if(node.nodeType===1&&blocks.has((node as Element).tagName)){paragraph=null;continue}
 if(node.nodeType===3&&!node.textContent?.trim()&&!paragraph)continue;
 if(node.nodeType!==1&&node.nodeType!==3)continue;
 if(!paragraph){paragraph=tree.createElement('p');node.before(paragraph)}paragraph.append(node);
 }}
 tree.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(el=>{const p=tree.createElement('p'),span=tree.createElement('span');p.style.cssText=(el as HTMLElement).style.cssText;span.style.fontSize=[24,20,17,15,13,12][Number(el.tagName[1])-1]+'pt';span.style.fontWeight='700';span.innerHTML=el.innerHTML;p.append(span);el.replaceWith(p)});
 tree.querySelectorAll('em,i,strong,b').forEach(el=>{const span=tree.createElement('span');span.style.cssText=(el as HTMLElement).style.cssText;if(['EM','I'].includes(el.tagName)){span.style.fontStyle='italic';span.style.fontWeight='400'}else span.style.fontWeight='700';span.innerHTML=el.innerHTML;el.replaceWith(span)});
 return tree.body.innerHTML;
}

// Keep inline image anchors visible to the HTML parser, including after tables.
// A one-character placeholder preserves all native character/style offsets.
export function exportUniverImages(doc:any,convert:(value:any)=>string){
 const copy=structuredClone(doc),images:{token:string;html:string}[]=[];
 const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 for(const [index,block]of (copy.body?.customBlocks||[]).entries()){
 const image=copy.drawings?.[block.blockId];if(!image||image.drawingType!==0)continue;
 if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.source||''))throw Error('Export requires embedded images');
 const token=String.fromCharCode(0xe000+index),offset=block.startIndex;
 copy.body.dataStream=copy.body.dataStream.slice(0,offset)+token+copy.body.dataStream.slice(offset+1);
 const width=Math.max(1,Number(image.docTransform?.size?.width)||400),height=Math.max(1,Number(image.docTransform?.size?.height)||300);
 images.push({token,html:`<img src="${escape(image.source)}" width="${width}" height="${height}" alt="${escape(image.description)}" />`});
 }
 copy.body.customBlocks=(copy.body?.customBlocks||[]).filter((block:any)=>!copy.drawings?.[block.blockId]||copy.drawings[block.blockId].drawingType!==0);
 // Univer stores inherited formatting as sparse runs. Its HTML converter
 // expects covered ranges; explicitly fill gaps on this export-only clone.
 const runs:any[]=[];let covered=0;const defaults=copy.documentStyle?.textStyle||{};
 for(const run of (copy.body.textRuns||[]).slice().sort((a:any,b:any)=>a.st-b.st)){if(run.st>covered)runs.push({st:covered,ed:run.st,ts:{...defaults}});runs.push({...run,ts:{...defaults,...run.ts}});covered=Math.max(covered,run.ed)}
 if(covered<copy.body.dataStream.length)runs.push({st:covered,ed:copy.body.dataStream.length,ts:{...defaults}});copy.body.textRuns=runs;
 const tables=(copy.body?.tables||[]).slice().sort((a:any,b:any)=>a.startIndex-b.startIndex),segments:{from:number;to:number}[]=[];let cursor=0;
 for(const table of tables){if(table.startIndex<cursor)continue;if(table.startIndex>cursor)segments.push({from:cursor,to:table.startIndex});segments.push({from:table.startIndex,to:table.endIndex});cursor=table.endIndex}
 if(cursor<copy.body.dataStream.length-2)segments.push({from:cursor,to:copy.body.dataStream.length-2});
 let html:string;if(tables.length){const model=new DocumentDataModel(copy);try{html=segments.map(({from,to})=>{const body=model.sliceBody(from,to);return body?convert({...copy,body}):''}).join('')}finally{model.dispose()}}else html=convert(copy);
 for(const image of images){if(!html.includes(image.token))throw Error('Image anchor could not be exported');html=html.replace(image.token,image.html)}return html;
}
