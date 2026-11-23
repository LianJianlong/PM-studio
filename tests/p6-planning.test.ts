import {test} from 'node:test';import assert from 'node:assert/strict';
import {schedule,type Activity} from '../server/schedule.ts';
import {calendarTemplate} from '../shared/project-calendar.ts';
import {validateActivityPlanning,planningProgress} from '../shared/p6-planning.ts';
import {inspectSchedule,baselineComparison,wbsSummaries} from '../shared/plan-inspection.ts';
const a=(id:string,duration:number,extra:Partial<Activity>={}):Activity=>({id,code:id,name:id,duration,progress:0,predecessors:[],...extra});
const c=calendarTemplate('five'),start='2026-11-09';
test('P6 soft deadline reports negative float without shortening duration',()=>{
 const plan=schedule([a('A',5),a('B',5,{predecessors:[{id:'A',type:'FS',lag:0}]})],c,start,'duration',{must_finish_by:'2026-11-13'});
 assert.equal(plan.work_duration,10);assert.equal(plan.activities[0].float,-5);assert.equal(plan.activities[1].float,-5);assert(plan.activities.every(a=>a.critical));assert.equal(inspectSchedule(plan).negative,2);
});
test('P6 start/finish constraints affect the appropriate forward/backward pass',()=>{
 const after=schedule([a('A',2,{constraint_type:'开始不早于',constraint_date:'2026-11-16'})],c,start);assert.equal(after.activities[0].work_es,5);
 const before=schedule([a('A',5,{constraint_type:'完成不晚于',constraint_date:'2026-11-11'})],c,start);assert.equal(before.activities[0].float,-2);
 const finishAfter=schedule([a('A',2,{constraint_type:'完成不早于',constraint_date:'2026-11-13'})],c,start);assert.equal(finishAfter.activities[0].work_ef,5);
});
test('critical threshold and driving longest path are separate definitions',()=>{
 const tasks=[a('A',5),a('B',3),a('C',1,{predecessors:[{id:'A',type:'FS',lag:0}]})];
 assert.equal(schedule(tasks,c,start,'duration',{critical_threshold:3}).activities.find(a=>a.id==='B')!.critical,true);
 assert.equal(schedule(tasks,c,start,'duration',{critical_method:'longest',critical_threshold:3}).activities.find(a=>a.id==='B')!.critical,false);
});
test('remaining reforecast retains actual starts and predecessor logic while anchoring unfinished work after data date',()=>{
 const s=schedule([a('A',10,{progress:30,actual_start:'2026-11-09',remaining_duration:7}),a('B',2,{predecessors:[{id:'A',type:'FS',lag:0}]})],c,start,'duration',{data_date:'2026-11-16',forecast_remaining:true});
 assert.equal(s.activities[0].work_es,0);assert.equal(s.activities[0].work_ef,12);assert.equal(s.activities[1].work_es,12);assert.equal(s.work_duration,14);
 const completed=schedule([a('A',5,{progress:100,actual_start:'2026-11-09',actual_finish:'2026-11-10'})],c,start,'duration',{data_date:'2026-11-16',forecast_remaining:true});assert.equal(completed.activities[0].work_ef,2);assert.equal(completed.activities[0].remaining_duration,0);
});
test('duration- and weighted-step completion preserve physical-percent default and validate actuals/milestones',()=>{
 assert.equal(planningProgress({percent_complete_type:'工期',duration:10,remaining_duration:7},0),30);
 assert.equal(planningProgress({percent_complete_type:'步骤',activity_steps:[{name:'A',weight:2,progress:100},{name:'B',weight:1,progress:0},{name:'C',weight:1,progress:0}]},0),50);
 assert.equal(planningProgress({percent_complete_type:'实物'},30),30);
 assert.throws(()=>validateActivityPlanning({actual_finish:'2026-11-10',progress:100}));
 assert.throws(()=>validateActivityPlanning({activity_type:'开始里程碑',duration:1}));
 assert.throws(()=>validateActivityPlanning({activity_steps:[{name:'A',weight:0,progress:5}]}));
 assert.throws(()=>validateActivityPlanning({constraint_type:'开始不早于'}));
});
test('baseline comparisons normalize different project origin dates; WBS summaries include descendants',()=>{
 const tasks=[{...a('A',2,{progress:30}),es:5,ef:7,custom_data:{wbs:['child']}}];
 const comparison=baselineComparison({start_date:'2026-11-09',activities:tasks,baselines:[{snapshot:{start_date:'2026-11-11',activities:[{id:'A',es:1,ef:3}]}}]});assert.equal(comparison[0].start_variance,2);assert.equal(comparison[0].finish_variance,2);
 const sums=wbsSummaries([{id:'root',parent_id:null},{id:'child',parent_id:'root'}],tasks);assert.equal(sums.get('root').count,1);assert.equal(sums.get('root').progress,30);assert.equal(sums.get('root').es,5);
});
