/** Print only the report; preserve canvas charts as images in the print document. */
export async function printReport(paper:HTMLElement,page:{paper?:string;orientation?:string;margin?:number;pageNumbers?:boolean;header?:string;footer?:string}={}){
 const copy=paper.cloneNode(true) as HTMLElement;
 const canvases=paper.querySelectorAll('canvas');copy.querySelectorAll('canvas').forEach((canvas,i)=>{const image=document.createElement('img');image.src=canvases[i].toDataURL('image/png');image.style.width=canvases[i].style.width||canvases[i].getBoundingClientRect().width+'px';image.style.maxWidth='100%';canvas.replaceWith(image)});
 copy.querySelectorAll('.rd-grip,.rd-section-label,.rd-drop').forEach(el=>el.remove());
 copy.querySelectorAll('.selected').forEach(el=>el.classList.remove('selected'));
 const frame=document.createElement('iframe');frame.title='Report print';frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;border:0';document.body.append(frame);
 const doc=frame.contentDocument!;doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Report</title></head><body></body></html>');doc.close();
 for(const node of document.querySelectorAll('style,link[rel="stylesheet"]'))doc.head.appendChild(node.cloneNode(true));
 const css=doc.createElement('style');css.textContent=`@page{size:${page.paper||'A4'} ${page.orientation||'portrait'};margin:${page.margin??12}mm;@top-center{content:${JSON.stringify(page.header||'')};font-size:9pt}@bottom-left{content:${JSON.stringify(page.footer||'')};font-size:9pt}${page.pageNumbers!==false?'@bottom-right{content:counter(page) " / " counter(pages);font-size:9pt}':''}} html,body{margin:0!important;padding:0!important;background:#fff!important;min-height:0!important;height:auto!important;display:block!important}.rd-paper{background:#fff!important;box-shadow:none!important;width:100%!important;max-width:none!important;padding:0!important;min-height:0!important}.rd-block{cursor:default;border:0}.rd-section-label,.rd-grip,.rd-drop{display:none!important}`;doc.head.append(css);doc.body.append(copy);
 await Promise.all(Array.from(doc.querySelectorAll('img')).map(img=>img.decode().catch(()=>{})));await doc.fonts.ready;
 await new Promise(r=>setTimeout(r,300));frame.contentWindow!.addEventListener('afterprint',()=>frame.remove(),{once:true});frame.contentWindow!.focus();frame.contentWindow!.print();setTimeout(()=>frame.remove(),600000);
}
