import {relationshipTiming} from './cpm-report.ts';
type Candidate={serial:number;node:string;parent:Candidate|null;gap:number;length:number};
export function criticalPaths(activities:any[],ordered:string[],count=5,endId?:string){
 const byId=new Map(activities.map(a=>[a.id,a])),paths=new Map<string,Candidate[]>(),successors=new Map<string,string[]>();let serial=0;
 const limit=Math.max(1,Math.min(20,Math.floor(count)||5));
 for(const a of activities)for(const d of a.predecessors){if(!successors.has(d.id))successors.set(d.id,[]);successors.get(d.id)!.push(a.id);}
 const resultWarnings:string[]=[];
 if(endId&&!byId.has(endId))return {paths:[],warnings:['选定路径终点不在当前可计算作业中']};
 const finish=endId?byId.get(endId)!.ef:activities.length?Math.max(...activities.map(a=>a.ef)):0;
 for(const id of ordered){const a=byId.get(id)!;const options:Candidate[]=[];const signatures=new Set<string>();let usable=0,minGap=Infinity;
  for(const d of a.predecessors){const p=byId.get(d.id);if(!p)continue;const timing=relationshipTiming(p,a,d),gap=timing.gap_work_days;
   if(timing.fixed||timing.non_driving)continue;
   if(gap< -1e-7)continue;usable++;minGap=Math.min(minGap,gap);
   for(const previous of paths.get(p.id)||[]){const key=String(previous.serial);if(signatures.has(key))continue;signatures.add(key);options.push({serial:++serial,node:id,parent:previous,gap:previous.gap+Math.max(0,gap),length:previous.length+1});}
  }
  if(!usable||(minGap>1e-7&&(a.start_not_before||a.constraint_type&&a.constraint_type!=='尽早开始'||a.actual_start||a.forecast_anchor)))options.push({serial:++serial,node:id,parent:null,gap:0,length:1});
  options.sort((a,b)=>a.gap-b.gap||b.length-a.length||a.serial-b.serial);paths.set(id,options.slice(0,limit));
 }
 const ends=endId?[byId.get(endId)!]:activities.filter(a=>!successors.get(a.id)?.length||Math.abs(a.ef-finish)<1e-7);
 const candidates=ends.flatMap(a=>(paths.get(a.id)||[]).map(path=>({path,gap:path.gap+Math.max(0,finish-a.ef)}))).sort((a,b)=>a.gap-b.gap||b.path.length-a.path.length||a.path.serial-b.path.serial);
 const selected:Array<{rank:number;activity_ids:string[];codes:string[];names:string[];gap_work_days:number;total_float:number}>=[];
 for(const candidate of candidates){const ids:string[]=[];let node:Candidate|null=candidate.path;while(node){ids.push(node.node);node=node.parent;}ids.reverse();
  if(selected.some(existing=>Math.abs(existing.gap_work_days-candidate.gap)<1e-7&&ids.length<=existing.activity_ids.length&&existing.activity_ids.some((id,i)=>id===ids[0]&&ids.every((v,j)=>existing.activity_ids[i+j]===v))))continue;
  selected.push({rank:selected.length+1,activity_ids:ids,codes:ids.map(id=>byId.get(id)!.code),names:ids.map(id=>byId.get(id)!.name),gap_work_days:candidate.gap,total_float:Math.min(...ids.map(id=>byId.get(id)!.float))});
  if(selected.length>=limit)break;
 }
 return {paths:selected,warnings:resultWarnings};
}
