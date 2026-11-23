import {test} from 'node:test';import assert from 'node:assert/strict';
import {activityResourceRows} from '../shared/activity-resources.ts';import {naturalCalendar} from '../shared/project-calendar.ts';
import {requireRemoteDatabase} from '../shared/database-target.ts';
test('allocation summary conserves effort, computes per-activity peaks and converts only explicit human units',()=>{
 const planned={activities:[{id:'a',code:'A',name:'A',duration:2,es:0,ef:2}]};const r={id:'r',name:'workers',kind:'human',unit:'人日',allocations:[{id:'x',activity_id:'a',quantity:'43.5000'}]};const [row]=activityResourceRows([r],planned,'2026-10-19',naturalCalendar) as any[];assert.equal(row.person_months,'4.0000');assert.equal(row.peak_daily_quantity,'43.5000');assert.equal(row.working_days,2);assert.equal(activityResourceRows([{...r,kind:'material'}],planned,'2026-10-19',naturalCalendar)[0]?.person_months,null);assert.equal(activityResourceRows([{...r,unit:'未知单位'}],planned,'2026-10-19',naturalCalendar)[0]?.person_months,null);
});
test('external SQL connectors cannot access loopback or system accounts',()=>{for(const ip of ['127.0.0.1','127.0.1.2','::1','::ffff:127.0.0.1'])assert.throws(()=>requireRemoteDatabase(ip,'reader'));assert.throws(()=>requireRemoteDatabase('10.0.0.1','mac'));assert.doesNotThrow(()=>requireRemoteDatabase('10.0.0.1','project_reader'));});
