import {useMemo} from 'react';
import {documentTextDiff} from '../shared/document-diff';
import {translateUiValue as ui} from './i18n';
export default function DocumentRewriteReview({before,html}:{before:string;html:string}){
 const review=useMemo(()=>{const tree=new DOMParser().parseFromString(html,'text/html');tree.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));tree.querySelectorAll('p,div,h1,h2,h3,h4,li').forEach(n=>n.append('\n'));const after=(tree.body.textContent||'').replace(/\n+$/,'');return {after,changes:documentTextDiff(before.replace(/\r/g,'\n').replace(/\n+$/,''),after)}},[before,html]);
 const added=review.changes.filter(c=>c.kind==='insert').reduce((n,c)=>n+Array.from(c.text).length,0),removed=review.changes.filter(c=>c.kind==='delete').reduce((n,c)=>n+Array.from(c.text).length,0);
 return <section className="word-rewrite-review" aria-label={ui('修改前后对照')}>
  <strong>{ui('修改前后对照')}</strong><p className="help">{ui('仅替换本次选中文字，其余正文保持原样。')}</p>
  <div className="word-rewrite-columns"><div><h4>{ui('修改前')}</h4><pre>{before}</pre></div><div><h4>{ui('修改后')}</h4><div className="word-rewrite-result" dangerouslySetInnerHTML={{__html:html}}/></div></div>
  <details open><summary>{ui('文字变化')} · +{added} / −{removed}</summary><div className="word-rewrite-diff">{review.changes.map((c,i)=>c.kind==='delete'?<del key={i}>{c.text}</del>:c.kind==='insert'?<ins key={i}>{c.text}</ins>:<span key={i}>{c.text}</span>)}</div><p className="help">{ui('绿色下划线为新增，红色删除线为删除；格式以修改后预览为准。')}</p></details>
 </section>;
}
