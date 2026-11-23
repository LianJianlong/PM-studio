import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {createUniver,LocaleType,ImageSourceType,normalizeBody,ICommandService,type IDocumentData} from '@univerjs/presets';
import {UniverDocsCorePreset,convertClipboardHtmlToDocumentData,convertBodyToHtml,DocHtmlExportService,InnerPasteCommand,DocSelectionManagerService} from '@univerjs/preset-docs-core';
import {UniverDocsDrawingPreset} from '@univerjs/preset-docs-drawing';
import drawingZh from '@univerjs/preset-docs-drawing/locales/zh-CN';
import drawingEn from '@univerjs/preset-docs-drawing/locales/en-US';
import '@univerjs/preset-docs-drawing/lib/index.css';
import zhCN from '@univerjs/preset-docs-core/locales/zh-CN';
import enUS from '@univerjs/preset-docs-core/locales/en-US';
import '@univerjs/preset-docs-core/lib/index.css';
import {prepareUniverHtml,exportUniverImages} from './univer-document-html';
import {interfaceLocale} from './i18n';
import type {StudioDocument} from '../shared/toolbox-document';
import {localWritingOperations} from '../shared/document-diff';
import {selectionOperations,type WritingOperation} from '../shared/document-writing';
export interface DocumentEditorHandle {
 load(html:string,native?:unknown,page?:StudioDocument['page']):Promise<void>; getHTML():string; getNative():unknown; getText():string;
 textBetween(from:number,to:number):string; getSize():number; reveal(offset:number):void;
 target(operation:WritingOperation):{from:number;to:number;text:string;operation:WritingOperation;point:number;whole:boolean;html?:string};
 insert(html:string,from?:number,to?:number):Promise<void>; replace(html:string):Promise<void>;
}
export default forwardRef<DocumentEditorHandle,{editable:boolean;page:StudioDocument['page'];onChange:()=>void;onSelection:(text:string)=>void;onError:(message:string)=>void}>(function UniverDocumentEditor(props,ref){
 const host=useRef<HTMLDivElement>(null),state=useRef<any>(null),latest=useRef(props),pending=useRef<{html:string;native?:unknown;page?:StudioDocument['page']}>({html:'<p></p>'});latest.current=props;
 const data=(html:string,native?:unknown)=>{
 const converted=native?structuredClone(native) as IDocumentData:convertClipboardHtmlToDocumentData(prepareUniverHtml(html));
 const page=pending.current.page||latest.current.page,mm=96/25.4;
 return {...converted,id:crypto.randomUUID(),title:'Document',locale:interfaceLocale().startsWith('en')?LocaleType.EN_US:LocaleType.ZH_CN,documentStyle:{...converted.documentStyle,documentFlavor:1,textStyle:{ff:({song:'Songti SC',hei:'Heiti SC',kai:'Kaiti SC',system:'Arial',arial:'Arial',times:'Times New Roman'})[page.font],fs:page.size,...converted.documentStyle?.textStyle},pageSize:{width:(page.orientation==='portrait'?210:297)*mm,height:(page.orientation==='portrait'?297:210)*mm},marginTop:page.margin*mm,marginBottom:page.margin*mm,marginLeft:page.margin*mm,marginRight:page.margin*mm},body:converted.body||{dataStream:'\r\n',paragraphs:[{startIndex:0}]}} as IDocumentData;
 };
 async function load(html:string,native?:unknown,page?:StudioDocument['page']){pending.current={html,native,page};const s=state.current;if(!s)return;const previous=s.doc?.save();s.loading=true;s.lastRange=null;try{const images:{marker:string;source:string;width?:number;height?:number}[]=[];if(!native){const tree=new DOMParser().parseFromString(html,'text/html');tree.querySelectorAll('img').forEach((img,index)=>{const marker='STUDIOIMAGE'+index+'END',source=img.getAttribute('src')||'';if(!/^data:image\/(png|jpeg|webp);base64,/.test(source))throw Error('Only embedded images are supported');images.push({marker,source,width:Math.min(600,Number(img.getAttribute('width'))||400),...(Number(img.getAttribute('height'))?{height:Number(img.getAttribute('height'))}:{})})});for(const [index,img]of Array.from(tree.querySelectorAll('img')).entries())img.replaceWith(tree.createTextNode(images[index].marker));html=tree.body.innerHTML}
 if(s.doc)s.api.disposeUnit(s.doc.getId());s.doc=s.api.createDocument(data(html,native));await s.doc.getPermission().setEditable(true);for(const image of images){const offset=s.doc.getBody().dataStream.indexOf(image.marker);if(offset<0)throw Error('Image position could not be restored');const inserted=await s.doc.insertImage({source:image.source,imageSourceType:ImageSourceType.BASE64,width:image.width,height:image.height,textRange:{startOffset:offset,endOffset:offset+image.marker.length}});if(!inserted)throw Error('Image import failed')}
 await s.doc.getPermission().setEditable(latest.current.editable);s.last=JSON.stringify(s.doc.save());latest.current.onSelection('')}catch(error){if(previous){if(s.doc)s.api.disposeUnit(s.doc.getId());s.doc=s.api.createDocument(previous);await s.doc.getPermission().setEditable(latest.current.editable);s.last=JSON.stringify(s.doc.save())}throw error}finally{s.loading=false}}
 useEffect(()=>{
 const locale=interfaceLocale().startsWith('en')?LocaleType.EN_US:LocaleType.ZH_CN;
 const {univer,univerAPI}=createUniver({locale,locales:{[LocaleType.ZH_CN]:{...zhCN,...drawingZh},[LocaleType.EN_US]:{...enUS,...drawingEn}},presets:[UniverDocsCorePreset({container:host.current!,header:true,toolbar:true,footer:false,disableAutoFocus:true}),UniverDocsDrawingPreset()]});
 const injector=univer.__getInjector(),s:any={univer,api:univerAPI,injector,doc:null,loading:true,last:''};state.current=s;void load(pending.current.html,pending.current.native).catch(e=>latest.current.onError(e.message));
 const command=injector.get(ICommandService).onCommandExecuted(()=>{if(s.loading||!s.doc)return;const next=JSON.stringify(s.doc.save());if(next!==s.last){s.last=next;latest.current.onChange()}});
 const selection=injector.get(DocSelectionManagerService).textSelection$.subscribe(()=>{const r=injector.get(DocSelectionManagerService).getActiveTextRange();if(r)s.lastRange={...r};latest.current.onSelection(r?s.doc.getBody().dataStream.slice(Math.min(r.startOffset,r.endOffset),Math.max(r.startOffset,r.endOffset)):'')});
 const observer=new ResizeObserver(()=>window.dispatchEvent(new Event('resize')));observer.observe(host.current!);
 return()=>{observer.disconnect();command.dispose();selection.unsubscribe();state.current=null;univer.dispose()};
 },[]);
 useEffect(()=>{const s=state.current;if(s?.doc){s.loading=true;void s.doc.getPermission().setEditable(props.editable).finally(()=>{s.last=JSON.stringify(s.doc.save());s.loading=false})}},[props.editable]);
 useEffect(()=>{const s=state.current;if(!s?.doc||!props.editable)return;const mm=96/25.4,p=props.page;for(const section of s.doc.getSections())section.setPageSetup({pageSize:{width:(p.orientation==='portrait'?210:297)*mm,height:(p.orientation==='portrait'?297:210)*mm},marginTop:p.margin*mm,marginBottom:p.margin*mm,marginLeft:p.margin*mm,marginRight:p.margin*mm})},[props.page.orientation,props.page.margin]);
 const getText=()=>state.current?.doc?.getBody().dataStream||'';
 const size=()=>Math.max(0,getText().length-2);
 async function insert(html:string,from?:number,to?:number){
 const s=state.current;if(!s?.doc||!latest.current.editable)throw Error('Document is not editable');
 const manager=s.injector.get(DocSelectionManagerService),selected=manager.getActiveTextRange(),start=from??selected?.startOffset??size(),end=to??from??selected?.endOffset??start;
 const range={startOffset:start,endOffset:end,collapsed:start===end,isActive:true,segmentId:'',segmentPage:0},unitId=s.doc.getId(),before=JSON.stringify(s.doc.save().body);
 const fragment=convertClipboardHtmlToDocumentData(prepareUniverHtml(html),unitId);if(!fragment.body)throw Error('Empty document fragment');fragment.body=normalizeBody(fragment.body);
 manager.replaceSelectionInfoWithoutRefresh({textRanges:[range],rectRanges:[],segmentId:'',isEditing:true,style:{strokeWidth:1,stroke:'#008572',strokeActive:'#008572',fill:'#00857222'},segmentPage:0},{unitId,subUnitId:unitId});
 const cursor=start+fragment.body.dataStream.length,ok=s.injector.get(ICommandService).syncExecuteCommand(InnerPasteCommand.id,{unitId,segmentId:'',doc:fragment,selections:[range],textRanges:[{startOffset:cursor,endOffset:cursor,collapsed:true,segmentId:''}]});
 if(!ok||JSON.stringify(s.doc.save().body)===before)throw Error('\u672c\u6b21\u91c7\u7528\u672a\u6539\u53d8\u6b63\u6587\uff0c\u9884\u89c8\u5df2\u4fdd\u7559\uff0c\u8bf7\u6838\u5bf9\u5185\u5bb9\u540e\u91cd\u8bd5');
 }

 useImperativeHandle(ref,()=>({load,getText,getSize:size,reveal:(offset)=>{const s=state.current;if(s?.doc)s.doc.setSelection(Math.max(0,Math.min(offset,size())),Math.max(0,Math.min(offset,size())))},getNative:()=>state.current?.doc?.save(),getHTML:()=>{const s=state.current;if(!s?.doc)return pending.current.html;return exportUniverImages(s.injector.get(DocHtmlExportService).transformDocumentForHtmlExport(s.doc.save()),convertBodyToHtml)},textBetween:(a,b)=>getText().slice(a,b),target:(operation)=>{
 const s=state.current,r=s?.injector.get(DocSelectionManagerService).getActiveTextRange()||s?.lastRange,start=Math.min(r?.startOffset??size(),r?.endOffset??size()),end=Math.max(r?.startOffset??size(),r?.endOffset??size()),whole=selectionOperations.includes(operation)&&start===end;
 if(localWritingOperations.includes(operation)&&start===end)throw Error('请先选中需要修改的文字');
 let from=whole?0:start,to=whole?size():end,html:string|undefined;
 if(operation==='table_edit'){
 const body=s.doc.getBody(),table=(body.tables||[]).filter((t:any)=>t.startIndex<=start&&start<t.endIndex).sort((a:any,b:any)=>(a.endIndex-a.startIndex)-(b.endIndex-b.startIndex))[0]||((body.tables||[]).length===1?body.tables[0]:null);
 if(!table)throw Error('\u8bf7\u5148\u5c06\u5149\u6807\u70b9\u5165\u9700\u8981\u4fee\u6539\u7684\u8868\u683c');from=table.startIndex;to=table.endIndex;
 if((body.customBlocks||[]).some((block:any)=>block.startIndex>=from&&block.startIndex<to))throw Error('\u542b\u56fe\u7247\u6216\u5bf9\u8c61\u7684\u8868\u683c\u8bf7\u5148\u624b\u52a8\u7f16\u8f91\uff0c\u907f\u514d\u8986\u76d6\u5bf9\u8c61');
 const fragment=s.doc.getDocumentDataModel().sliceBody(from,to);html=exportUniverImages({...s.doc.save(),body:fragment},convertBodyToHtml);
 }
 const text=getText().slice(from,to);if(selectionOperations.includes(operation)){if(!text.trim())throw Error('\u8bf7\u5148\u8f93\u5165\u6b63\u6587');if(text.length>12000)throw Error('\u6b63\u6587\u8d85\u8fc712000\u5b57\u7b26\uff0c\u8bf7\u5148\u9009\u62e9\u8303\u56f4');if(operation!=='table_edit'&&/[\x00-\x09\x0b-\x0c\x0e-\x1f]/.test(text))throw Error('\u8bf7\u4ec5\u9009\u62e9\u6587\u5b57\uff0c\u4e0d\u5305\u542b\u8868\u683c\u6216\u56fe\u7247')}
 return {from,to,text,html,operation,point:operation==='continue'?end:from,whole};
 },insert,replace:(html)=>insert(html,0,size())}));
 return <div ref={host} className="studio-univer-docs" aria-label="Univer Docs"/>;
});
