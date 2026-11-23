import type {RequestHandler} from 'express';
type State={work:number;ended:boolean;releases:(()=>void)[];complete?:()=>Promise<void>;fail?:(error:unknown)=>Promise<void>};
const states=new WeakMap<object,State>();
export function workState(req:object){let state=states.get(req);if(!state){state={work:0,ended:false,releases:[]};states.set(req,state);}return state;}
export function releaseFinished(req:object){const state=workState(req);if(state.ended&&state.work===0)for(const fn of state.releases.splice(0))fn();}
export function trackHandler(handler:RequestHandler):RequestHandler{return async(req,res,next)=>{const state=workState(req);state.work++;try{await handler(req,res,next);}catch(error){await state.fail?.(error);throw error;}finally{state.work--;if(state.work===0&&state.complete){state.work++;try{await state.complete();}finally{state.work--;}}releaseFinished(req);}};}
export function installWorkTracking(app:any){
 const seen=new Set<any>();
 function walk(stack:any[],routeHandler=false){
  for(const layer of stack||[]){
   if(seen.has(layer))continue;
   seen.add(layer);
   if(layer.route)walk(layer.route.stack,true);
   else if(layer.handle?.stack)walk(layer.handle.stack);
   else if(typeof layer.handle==='function'&&layer.handle.length<4&&(routeHandler||layer.handle.constructor?.name==='AsyncFunction'))layer.handle=trackHandler(layer.handle);
  }
 }
 walk(app.router.stack);
}
