import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseHourPeriods,hourPeriodText} from '../shared/calendar-input.ts';
import {calendarTemplate,validateCalendar} from '../shared/project-calendar.ts';
test('calendar settings accept only whole-hour factors and whole-hour intervals',()=>{
 assert.deepEqual(parseHourPeriods('8-12; 13-17'),[['08:00','12:00'],['13:00','17:00']]);
 assert.equal(hourPeriodText(parseHourPeriods('0-24')),'0-24');
 assert.throws(()=>parseHourPeriods('8:30-12'));assert.throws(()=>parseHourPeriods('8.5-12'));assert.throws(()=>parseHourPeriods('8-25'));
 for(const field of ['hours_per_day','hours_per_week','hours_per_month','hours_per_year'])assert.throws(()=>validateCalendar({...calendarTemplate('five'),[field]:8.5}));
 const c=calendarTemplate('five');c.week[1]=[['08:30','12:00']];assert.throws(()=>validateCalendar(c));
 assert.doesNotThrow(()=>validateCalendar(c,false)); // Historical read-only snapshots remain calculable.
 assert.equal(calendarTemplate('five').hours_per_month,173);
});
