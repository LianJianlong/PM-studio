import {test} from 'node:test';import assert from 'node:assert/strict';
import {progressCosts,progressMoment} from '../shared/plan-progress.ts';
import {calendarTemplate,workMoment} from '../shared/project-calendar.ts';
test('progress costs keep total budget and actual separate; earned plus remaining conserve budget',()=>{
 assert.deepEqual(progressCosts('1200.0000',30),{earned_cost:'360.0000',remaining_cost:'840.0000'});
 assert.deepEqual(progressCosts('0.0001',50),{earned_cost:'0.0001',remaining_cost:'0.0000'});
 assert.deepEqual(progressCosts('1200.0000',0),{earned_cost:'0.0000',remaining_cost:'1200.0000'});
 assert.deepEqual(progressCosts('1200.0000',100),{earned_cost:'1200.0000',remaining_cost:'0.0000'});
 assert.throws(()=>progressCosts('1200.0000',101));
});
test('front line locates 30 percent in working shifts and skips the weekend',()=>{
 const c=calendarTemplate('five'),start='2026-11-13',es=workMoment(c,start,0,'start'),ef=workMoment(c,start,5,'finish');
 const point=progressMoment(c,start,es,ef,30);
 assert(Math.abs(point-workMoment(c,start,1.5,'finish'))<1e-7);
 assert(point>=3&&point<4); // Monday, after a Friday start.
 assert.equal(progressMoment(c,start,es,ef,0),es);assert.equal(progressMoment(c,start,es,ef,100),ef);
});

test('progress costing accepts fractional and scientific-notation percentages without a four-digit percent restriction',()=>{
 assert.equal(progressCosts('1200.0000',100/3).earned_cost,'400.0000');
 assert.equal(progressCosts('1000000.0000',1e-7).earned_cost,'0.0010');
});
