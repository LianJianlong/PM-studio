import {markdownRichField,richMarkdown,saveMarkdown} from './markdown-rich-widgets';
import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {basicSetup} from 'codemirror';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {oneDark} from '@codemirror/theme-one-dark';
import {openSearchPanel} from '@codemirror/search';

export type MarkdownEditorAction='bold'|'italic'|'heading'|'link'|'bullet'|'number'|'quote'|'code'|'table';
export type MarkdownEditorHandle={apply:(action:MarkdownEditorAction)=>void;find:()=>void;focus:()=>void;revealLine:(line:number)=>void;insert:(text:string)=>void};
const visualMode=new Compartment(),readonly=new Compartment(),editorTheme=new Compartment();
function transform(view:EditorView,action:MarkdownEditorAction){
 const selection=view.state.selection.main;
 const from=selection.from,to=selection.to,text=view.state.doc.sliceString(from,to);
 const line=view.state.doc.lineAt(from),lineEnd=view.state.doc.lineAt(to).to;
 const wrap=(left:string,right:string,fallback:string)=>{
  const value=text||fallback;view.dispatch({changes:{from,to,insert:left+value+right},selection:{anchor:from+left.length,head:from+left.length+value.length}});
 };
 if(action==='bold')wrap('**','**','加粗文字');
 else if(action==='italic')wrap('*','*','斜体文字');
 else if(action==='link')wrap('[','](https://)','链接文字');
 else if(action==='code')text.includes('\n')?wrap('```\n','\n```','代码'):wrap('`','`','代码');
 else if(action==='table'){const block='| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n';view.dispatch({changes:{from,to,insert:block},selection:{anchor:from+2}})}
 else {
  const prefix=action==='heading'?'## ':action==='bullet'?'- ':action==='number'?'1. ':'> ';
  const content=view.state.doc.sliceString(line.from,lineEnd);
  const updated=content.split('\n').map((row,i)=>row?`${action==='number'?`${i+1}. `:prefix}${row}`:row).join('\n');
  view.dispatch({changes:{from:line.from,to:lineEnd,insert:updated},selection:{anchor:line.from+prefix.length}});
 }
 view.focus();
}
const MarkdownCodeEditor=forwardRef<MarkdownEditorHandle,{value:string;readOnly:boolean;visual?:boolean;onChange:(value:string)=>void;onStatus:(status:{line:number;column:number})=>void;onSave:()=>void}>((props,ref)=>{
 const host=useRef<HTMLDivElement>(null),editor=useRef<EditorView|null>(null),syncing=useRef(false),callbacks=useRef(props);
 callbacks.current=props;
 useEffect(()=>{
  if(!host.current)return;
  const view=new EditorView({state:EditorState.create({doc:callbacks.current.value,extensions:[
   basicSetup,visualMode.of(richMarkdown.of(callbacks.current.visual!==false)),markdownRichField,saveMarkdown.of(()=>callbacks.current.onSave()),markdown({base:markdownLanguage}),editorTheme.of(document.documentElement.dataset.theme==='dark'?oneDark:[]),
   readonly.of(EditorState.readOnly.of(callbacks.current.readOnly)),
   EditorState.changeFilter.of(tr=>tr.newDoc.length<=200000),
   EditorView.contentAttributes.of({'aria-label':'Markdown编辑'}),
   EditorView.updateListener.of(update=>{
    if(update.docChanged&&!syncing.current)callbacks.current.onChange(update.state.doc.toString());
    if(update.docChanged||update.selectionSet){const s=update.state.selection.main,ln=update.state.doc.lineAt(s.head);callbacks.current.onStatus({line:ln.number,column:s.head-ln.from+1})}
   }),
   keymap.of([{key:'Mod-s',run:()=>{callbacks.current.onSave();return true}},{key:'Mod-b',run:v=>{transform(v,'bold');return true}},{key:'Mod-i',run:v=>{transform(v,'italic');return true}}]),
   EditorView.theme({'&':{height:'100%',fontSize:'13px'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'},'.cm-content':{minHeight:'100%'},'.cm-gutters':{minHeight:'100%'}}),
  ]}),parent:host.current});
  editor.current=view;
  const themeObserver=new MutationObserver(()=>view.dispatch({effects:editorTheme.reconfigure(document.documentElement.dataset.theme==='dark'?oneDark:[])}));
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  return()=>{themeObserver.disconnect();editor.current=null;view.destroy()};
 },[]);
 useEffect(()=>{const view=editor.current;if(!view||view.state.doc.toString()===props.value)return;syncing.current=true;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:props.value},selection:{anchor:0}});syncing.current=false},[props.value]);
 useEffect(()=>{editor.current?.dispatch({effects:visualMode.reconfigure(richMarkdown.of(props.visual!==false))})},[props.visual]);
 useEffect(()=>{editor.current?.dispatch({effects:readonly.reconfigure(EditorState.readOnly.of(props.readOnly))})},[props.readOnly]);
 useImperativeHandle(ref,()=>({insert:text=>{const view=editor.current;if(!view||callbacks.current.readOnly)return;const {from,to}=view.state.selection.main;view.dispatch({changes:{from,to,insert:text},selection:{anchor:from+text.length},scrollIntoView:true});view.focus()},apply:action=>{if(editor.current&&!callbacks.current.readOnly)transform(editor.current,action)},find:()=>{if(editor.current){openSearchPanel(editor.current);editor.current.focus()}},focus:()=>editor.current?.focus(),revealLine:line=>{const view=editor.current;if(!view)return;const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},scrollIntoView:true});view.focus()}}),[]);
 return <div ref={host} className="md-code-editor"/>;
});
export default MarkdownCodeEditor;
