import test from 'node:test';import assert from 'node:assert/strict';
import {schedule} from '../server/schedule.ts';import {delayEvidence} from '../shared/delay-evidence.ts';import {defaultProjectCalendar as c} from '../shared/project-calendar.ts';
const start='2026-11-02';const item=(id:string,duration:number,predecessors:any[]=[])=>({id,code:id,name:id,duration,predecessors,progress:0});
const base=(p:any,calendar:any=c)=>({id:'base',snapshot:{...p,start_date:start,calendar_config:calendar}});
test('delay evidence follows multiple current drivers, shows historical critical changes and preserves identity',()=>{
 const original=schedule([item('A',2),item('B',4),item('C',1,[{id:'A',type:'FS',lag:0},{id:'B',type:'FS',lag:0}])],c,start);
 const current=schedule([item('A',5),item('B',4),{...item('C',1,[{id:'A',type:'FS',lag:0},{id:'B',type:'FS',lag:0}]),code:'C-NEW',name:'Renamed'}],c,start);
 const before=JSON.stringify({current,original}),r=delayEvidence(current,base(original),start,c,'C');
 assert.equal(r.summary.became_critical,1);assert.equal(r.summary.left_critical,1);assert.equal(r.rows.find(x=>x.id==='C')?.baseline_code,'C');assert(r.trace.candidates.some(x=>x.id==='A'));assert(!r.trace.nodes.some(x=>x.id==='B'));assert.equal(r.trace.edges.find(x=>x.predecessor==='A').driving,true);assert.equal(r.trace.edges.find(x=>x.predecessor==='A').baseline_driving,false);assert.equal(r.trace.edges.find(x=>x.predecessor==='B').reason,'存在逻辑余量，不继续追踪');assert.equal(JSON.stringify({current,original}),before);
 const tied=schedule([item('A',4),item('B',4),item('C',1,[{id:'A',type:'FS',lag:0},{id:'B',type:'FS',lag:0}])],c,start);assert.equal(delayEvidence(tied,base(original),start,c,'C').trace.nodes.length,3);
});
test('frozen calendar converts original work duration; legacy criticality and driver values remain unknown',()=>{
 const old=schedule([item('A',2)],c,start),current=schedule([item('A',2)],c,start),six={...c,hours_per_day:6};const r=delayEvidence(current,base(old,six),start,c);assert.equal(r.rows[0].baseline_duration_hours,12);assert.equal(r.rows[0].current_duration_hours,16);assert(r.context.some(x=>x.kind==='项目工作日历变化'));assert(r.rows[0].candidate);
 const legacy={snapshot:{activities:[{id:'A',code:'OLD',name:'Old',duration:2,es:0,ef:1}]}};const l=delayEvidence(current,legacy,start,c);assert.equal(l.rows[0].critical_before,null);assert.equal(l.summary.criticality_comparable,false);assert.equal(l.rows[0].baseline_float_hours,null);assert.equal(l.rows[0].baseline_duration_hours,null);assert.equal(l.trace.candidates.length,0);
 const none=delayEvidence(current,null,start,c);assert.equal(none.summary.added,0);assert.equal(none.summary.finish_delay_days,null);assert.equal(none.rows[0].change,'无基线');
});
test('fixed actual or mandatory date stops current predecessor trace instead of blaming upstream',()=>{
 const raw=[item('A',2),{...item('B',2,[{id:'A',type:'FS',lag:0}]),actual_start:'2026-11-05',progress:20}];const plan=schedule(raw,c,start);const r=delayEvidence(plan,base(schedule([item('A',2),item('B',2,[{id:'A',type:'FS',lag:0}])],c,start)),start,c,'B');assert.equal(r.trace.nodes.length,1);assert.equal(r.trace.edges[0].driving,false);assert.equal(r.trace.edges[0].reason,'实际日期或强制约束固定事件');assert(r.trace.candidates.some(x=>x.id==='B'));
 const hard=schedule([item('A',2),{...item('B',2,[{id:'A',type:'FS',lag:0}]),constraint_type:'强制开始',constraint_date:'2026-11-05'}],c,start);assert.equal(delayEvidence(hard,base(plan),start,c,'B').trace.nodes.length,1);
});
test('trace includes exact relation additions/removals/lags and reports bounded truncation for long chains',()=>{
 const chain=Array.from({length:230},(_,i)=>item(String(i).padStart(3,'0'),1,i?[{id:String(i-1).padStart(3,'0'),type:'FS',lag:0}]:[]));const p=schedule(chain,c,start);const r=delayEvidence(p,base(p),start,c,'229');assert.equal(r.trace.truncated,true);assert.equal(r.trace.nodes.length,200);assert(r.trace.edges.length<=500);
 const old=schedule([item('A',1),item('B',1,[{id:'A',type:'FS',lag:0}])],c,start);const current=schedule([item('A',1),item('B',1,[{id:'A',type:'SS',lag:1}])],c,start);const changed=delayEvidence(current,base(old),start,c,'B').rows.find(r=>r.id==='B');assert(changed?.evidence.some(x=>x.kind==='增加前置关系'));assert(changed?.evidence.some(x=>x.kind==='移除前置关系'));
});
test('baseline-only rows never silently disappear or enter current trace; scope empty is safe',()=>{
 const original=schedule([item('A',1),item('B',2)],c,start),current=schedule([item('A',1)],c,start);const r=delayEvidence(current,base(original),start,c);assert.equal(r.summary.baseline_only,1);assert.equal(r.rows.find(x=>x.id==='B')?.change,'仅基线存在');assert(!r.trace.nodes.some(x=>x.id==='B'));const empty=delayEvidence({activities:[]},null,start,c);assert.equal(empty.trace.targets.length,0);assert.equal(empty.summary.current_finish,null);
});
test('retained logic traces remaining-start drivers without hiding historical actual-date conflicts',()=>{
 const raw=[item('A',4),{...item('B',2,[{id:'A',type:'FS',lag:0}]),actual_start:'2026-11-03',progress:25,remaining_duration:1}];const p=schedule(raw,c,start,'duration',{forecast_remaining:true,data_date:'2026-11-04'});const r=delayEvidence(p,base(schedule([item('A',4),item('B',2,[{id:'A',type:'FS',lag:0}])],c,start)),start,c,'B');assert.equal(r.trace.edges[0].remaining_start,true);assert.equal(r.trace.edges[0].historical_conflict,true);assert.equal(r.trace.edges[0].driving,true);assert(r.trace.nodes.some(x=>x.id==='A'));
});
