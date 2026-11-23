import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {requestBudget} from '../server/request-budget.ts';import {installWorkTracking} from '../server/work-tracking.ts';
const response=()=>Object.assign(new EventEmitter(),{code:200,status(n:number){this.code=n;return this},json(){return this}});
test('promise-returning route wrappers retain admission after disconnect until work ends',async()=>{
 let done!:()=>void;const pending=new Promise<void>(r=>done=r);const layer={handle:(..._args:any[])=>pending};installWorkTracking({router:{stack:[{route:{stack:[layer]}}]}});
 const budget=requestBudget(1,1),req:any={user:{id:'test-user'}},res:any=response();budget(req,res,()=>{});const running=layer.handle(req,res,()=>{});res.emit('close');
 const other:any=response();budget({user:{id:'test-user'}} as any,other,()=>{});try{assert.equal(other.code,429)}finally{done();await running}
 const after:any=response();let accepted=false;budget({user:{id:'test-user'}} as any,after,()=>{accepted=true});assert(accepted);after.emit('finish');
});
