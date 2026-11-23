import {test} from 'node:test';import assert from 'node:assert/strict';import {durationLink} from '../shared/duration-types.ts';import {resourceCost} from '../shared/resource-values.ts';import {validateDurationHours} from '../shared/p6-planning.ts';
const base={duration:5,hoursPerDay:8,target:'a',allocations:[{id:'a',quantity:'3.0000',rate:'100.0000'},{id:'b',quantity:'2.0000',rate:'50.0000'}]};
test('fixed duration and rate changes work, while fixed duration and units recomputes all rates',()=>{
 const p=durationLink({...base,type:'固定工期和投入率',driver:'duration',value:'80'});assert.equal(p.duration,10);assert.equal(p.rows[0].quantity,'3.0000');assert.equal(p.rows[0].units,'30.0000');assert.equal(p.rows[0].planned_cost,'3000.0000');
 const q=durationLink({...base,type:'固定工期和工作量',driver:'duration',value:'80'});assert.equal(q.rows[0].quantity,'1.5000');assert.equal(q.rows[1].quantity,'1.0000');assert.equal(q.rows[0].units,'15.0000');assert.equal(q.rows[0].planned_cost,'1500.0000');
});
test('fixed units and fixed rate derive whole working hours, preserving different resource units independently',()=>{
 const p=durationLink({...base,type:'固定工作量',driver:'rate',value:'6'});assert.equal(p.duration,2.5);assert.equal(p.working_hours,20);assert.equal(p.rows[0].quantity,'6.0000');assert.equal(p.rows[1].quantity,'4.0000');assert.equal(p.rows[0].units,'15.0000');
 const q=durationLink({...base,type:'固定投入率',driver:'units',value:'30'});assert.equal(q.duration,10);assert.equal(q.rows[0].quantity,'3.0000');assert.equal(q.rows[1].quantity,'2.0000');
});
test('hour ceiling, exact decimal money, invalid and out-of-range proposals',()=>{
 const p=durationLink({...base,type:'固定工作量',driver:'rate',value:'7'});assert.equal(p.working_hours,18);assert(p.rounded);assert.equal(p.rows[0].quantity,'6.6667');
 assert.equal(resourceCost('1000000000000','1','0.125'),'125000000000.0000');
 assert.throws(()=>durationLink({...base,type:'固定工期和工作量',driver:'rate',value:'2'}));assert.throws(()=>durationLink({...base,type:'固定工作量',driver:'duration',value:'8.5'}));assert.throws(()=>durationLink({...base,type:'固定工作量',driver:'duration',value:'0'}));assert.throws(()=>durationLink({...base,type:'固定工作量',driver:'duration',value:'87601'}));
 assert.doesNotThrow(()=>validateDurationHours(0.125,8));assert.throws(()=>validateDurationHours(0.1,8));
});

test('numeric database durations retain weighted progress and working-hour precision',async()=>{
 const {schedule}=await import('../server/schedule.ts');const p=schedule([{id:'a',code:'a',name:'a',duration:'2.50000000',progress:40,predecessors:[]},{id:'b',code:'b',name:'b',duration:'5.00000000',progress:100,predecessors:[]}] as any);assert.equal(p.progress,80);assert.equal(p.activities[0].duration,2.5);
});
