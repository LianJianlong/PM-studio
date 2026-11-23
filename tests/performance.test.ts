import {test} from 'node:test';import assert from 'node:assert/strict';
import {budgetPerformance,performanceMetrics,periodDelta,selectBaseline} from '../shared/performance.ts';
import {periodBounds} from '../shared/period-bounds.ts';import {calendarTemplate} from '../shared/project-calendar.ts';import {schedule} from '../server/schedule.ts';
test('PV follows baseline working shifts; EV uses frozen budget, not revised current costs',()=>{
 const calendar=calendarTemplate('five'),start='2026-11-13';
 const planned=schedule([{id:'A',code:'A',name:'A',duration:2,progress:0,predecessors:[]}],calendar,start);
 const v=budgetPerformance(planned.activities,{A:'1000.0000'},[{id:'A',progress:30,planned_cost:'2000'}],calendar,start,'2026-11-13');
 assert.deepEqual(v,{bac:'1000.0000',pv:'500.0000',ev:'300.0000',missing_activities:0});
 assert.equal(budgetPerformance(planned.activities,{A:'1000.0000'},[],calendar,start,'2026-11-15').missing_activities,1);
});
test('earned value forecasts use exact formulas, handle missing denominators, and preserve actual cost',()=>{
 const v=performanceMetrics('1000.0000','500.0000','300.0000','600.0000');assert.equal(v.cpi,'0.500000');assert.equal(v.spi,'0.600000');assert.equal(v.eac,'2000.0000');assert.equal(v.etc,'1400.0000');assert.equal(v.vac,'-1000.0000');assert.equal(v.cv,'-300.0000');assert.equal(v.sv,'-200.0000');assert.equal(v.tcpi,'1.750000');assert.equal(v.ac,'600.0000');
 assert.equal(performanceMetrics('1000.0000','500.0000','300.0000','600.0000','remaining_budget').eac,'1300.0000');
 assert.equal(performanceMetrics('1000.0000','500.0000','300.0000','600.0000','cpi_spi').eac,'2933.3333');
 assert.equal(performanceMetrics('1000.0000','0.0000','0.0000','0.0000').eac,null);
 assert.equal(performanceMetrics('1000.0000','0.0000','0.0000','0.0000').spi,null);
 assert.deepEqual(periodDelta({pv:'20.0000',ev:'10.0000',ac:'5.0000'},{pv:'15.0000',ev:'10.0000',ac:'6.0000'}),{pv:'5.0000',ev:'0.0000',ac:'-1.0000'});
});
test('multiple baseline selections use stable IDs and support legacy saved indexes',()=>{
 const a={id:'A'},b={id:'B'};assert.equal(selectBaseline([b,a],'A'),a);assert.equal(selectBaseline([b,a],'latest'),b);assert.equal(selectBaseline([b,a],'1'),a);assert.equal(selectBaseline([b,a],'none'),undefined);
});
test('weekly and monthly performance periods use civil calendar boundaries',()=>{
 assert.deepEqual(periodBounds('2026-11-12','weekly'),{start:'2026-11-09',end:'2026-11-15'});
 assert.deepEqual(periodBounds('2024-02-12','monthly'),{start:'2024-02-01',end:'2024-02-29'});
});
test('TCPI targets distinguish budget and estimate; overruns and zero-denominator forecasts remain unavailable',()=>{
 const v=performanceMetrics('1000.0000','500.0000','300.0000','600.0000');assert.equal(v.tcpi,'1.750000');assert.equal(v.tcpi_eac,'0.500000');const over=performanceMetrics('1000','500','300','1200');assert.equal(over.tcpi,null);assert.equal(over.tcpi_eac,'0.250000');const zero=performanceMetrics('1000','500','0','100');assert.equal(zero.cpi,'0.000000');assert.equal(zero.eac,null);assert.equal(performanceMetrics('1000','0','300','100','cpi_spi').eac,null);
});
test('unknown PV preserves cost-only forecasts but not schedule indices, and invalid bounds never yield negative ETC',()=>{
 const p=performanceMetrics('1000',null,'300','600');assert.equal(p.cpi,'0.500000');assert.equal(p.spi,null);assert.equal(p.sv,null);assert.equal(p.eac,'2000.0000');assert.equal(performanceMetrics('1000',null,'300','600','cpi_spi').eac,null);const bad=performanceMetrics('100','100','101','50');assert.equal(bad.inputs_valid,false);assert.equal(bad.eac,null);assert.equal(bad.etc,null);
});
test('fully earned budget work uses actual costs and zero ETC even without usable CPI/SPI; TCPI is inapplicable',()=>{
 for(const method of ['cpi','remaining_budget','cpi_spi']){const p=performanceMetrics('1000','0','1000','1200',method);assert.equal(p.eac,'1200.0000');assert.equal(p.etc,'0.0000');assert.equal(p.vac,'-200.0000');assert.equal(p.tcpi,null);assert.equal(p.tcpi_eac,null);}
});
test('budgeted milestone PV becomes due on its event date; missing budget is never silently zero',()=>{
 const c=calendarTemplate('five'),a={id:'M',duration:0,es:1,ef:1,progress:100};assert.equal(budgetPerformance([a],{M:'10.0000'},[a],c,'2026-11-09','2026-11-09').pv,'0.0000');assert.equal(budgetPerformance([a],{M:'10.0000'},[a],c,'2026-11-09','2026-11-10').pv,'10.0000');assert.throws(()=>budgetPerformance([a],{},[a],c,'2026-11-09','2026-11-10'),/不能默认为零/);
});
