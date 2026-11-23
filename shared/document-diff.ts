export type TextChange={kind:'equal'|'delete'|'insert';text:string};
/** Bounded character comparison; offsets stay in the editor's UTF-16 coordinate space. */
export function documentTextDiff(before:string,after:string):TextChange[]{
 const a=Array.from(before),b=Array.from(after);let first=0,last=0;
 while(first<a.length&&first<b.length&&a[first]===b[first])first++;
 while(last<a.length-first&&last<b.length-first&&a[a.length-1-last]===b[b.length-1-last])last++;
 const x=a.slice(first,a.length-last),y=b.slice(first,b.length-last),out:TextChange[]=[];
 const push=(kind:TextChange['kind'],text:string)=>{if(!text)return;const prev=out.at(-1);if(prev?.kind===kind)prev.text+=text;else out.push({kind,text})};
 push('equal',a.slice(0,first).join(''));
 if(x.length*y.length>250000){push('delete',x.join(''));push('insert',y.join(''))}
 else{const width=y.length+1,grid=new Uint16Array((x.length+1)*width);
  for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)grid[i*width+j]=x[i]===y[j]?grid[(i+1)*width+j+1]+1:Math.max(grid[(i+1)*width+j],grid[i*width+j+1]);
  let i=0,j=0;while(i<x.length||j<y.length){if(i<x.length&&j<y.length&&x[i]===y[j]){push('equal',x[i++]);j++}else if(i<x.length&&(j===y.length||grid[(i+1)*width+j]>=grid[i*width+j+1]))push('delete',x[i++]);else push('insert',y[j++])}
 }
 push('equal',last?a.slice(a.length-last).join(''):'');return out;
}
export const localWritingOperations=['polish','rewrite','expand','shorten','translate'];
