import test from "node:test";
import assert from "node:assert/strict";
import {
  naturalCalendar,
  validateCalendar,
  workingDates,
  workMoment,
  calendarTemplate,
  calendarHours,
  workingDateMinutes,
  type ProjectCalendar,
} from "../shared/project-calendar.ts";
import { schedule } from "../server/schedule.ts";
const five = (): ProjectCalendar => ({
  name: "五天八小时",
  week: [
    [],
    ...Array.from(
      { length: 5 },
      () =>
        [
          ["08:00", "12:00"],
          ["13:00", "17:00"],
        ] as [string, string][],
    ),
    [],
  ],
  exceptions: {},
  hours_per_day: 8,
  hours_per_week: 40,
  hours_per_month: 172,
  hours_per_year: 2080,
});
test('all three templates have consistent conversion factors, actual periods include leap years and exceptions',()=>{
 for (const kind of ['natural','five','six'] as const) {
  const c=calendarTemplate(kind);
  assert.equal(c.hours_per_month,Math.round(c.hours_per_year/12));
  assert(Number.isInteger(c.hours_per_month));
 }
 assert.equal(calendarTemplate('six').hours_per_year,2496);
 assert.equal(calendarTemplate('six').hours_per_month,208);
 const c=calendarTemplate('natural');
 assert.equal(calendarHours(c,'2024-02-01','2024-03-01'),696);
 assert.equal(calendarHours(c,'2024-01-01','2025-01-01'),8784);
 assert.equal(calendarHours(c,'2026-02-01','2026-03-01'),672);
 const f=calendarTemplate('five');
 assert.equal(calendarHours(f,'2026-10-01','2026-11-01'),176);
 f.exceptions['2026-10-05']=[];
 f.exceptions['2026-10-06']=[['08:00','12:00']];
 assert.equal(calendarHours(f,'2026-10-01','2026-11-01'),164);
 assert.deepEqual(workingDateMinutes(f,'2026-10-06',8/24,1+17/24),[{date:'2026-10-06',minutes:240},{date:'2026-10-07',minutes:480}]);
});
test('finish milestones remain on Friday while successor working activity starts Monday',()=>{
 const s=schedule([a('A',1),a('M',0,[{id:'A',type:'FS',lag:0}]),a('B',1,[{id:'A',type:'FS',lag:0}])],five(),'2026-10-09');
 assert.equal(s.activities[0].ef,17/24);
 assert.equal(s.activities[1].es,17/24);
 assert.equal(s.activities[1].ef,17/24);
 assert.equal(s.activities[2].es,3+8/24);
});
const a = (id: string, duration: number, predecessors: any[] = []) => ({
  id,
  code: id,
  name: id,
  duration,
  progress: 0,
  predecessors,
});
test("default natural calendar preserves legacy CPM including milestones", () => {
  const rows = [
    a("A", 2),
    a("B", 3, [{ id: "A", type: "FS", lag: 1 }]),
    a("M", 0, [{ id: "B", type: "FS", lag: 0 }]),
  ];
  assert.deepEqual(
    schedule(rows, naturalCalendar, "2026-10-05").activities,
    schedule(rows).activities,
  );
});
test("holidays, split shifts, weekends and partial exceptions drive actual scheduling dates", () => {
  const c = five();
  c.exceptions["2026-10-05"] = [];
  c.exceptions["2026-10-07"] = [["08:00", "12:00"]];
  const s = schedule(
    [a("A", 2), a("B", 3, [{ id: "A", type: "FS", lag: 0 }])],
    c,
    "2026-10-05",
  );
  assert.equal(s.work_duration, 5);
  assert.equal(s.activities[0].es, 1 + 8 / 24);
  assert.equal(s.activities[0].ef, 3 + 12 / 24);
  assert.deepEqual(
    workingDates(c, "2026-10-05", s.activities[1].es, s.activities[1].ef),
    ["2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"],
  );
  assert.equal(s.activities[1].ef, 8 + 12 / 24);
});
test("FS SS FF SF constraints and positive/negative lag retain work-day semantics", () => {
  for (const type of ["FS", "SS", "FF", "SF"] as const)
    for (const lag of [-1, 0, 3]) {
      const rows = [a("A", 4), a("B", 2, [{ id: "A", type, lag }])],
        logical = schedule(rows),
        mapped = schedule(rows, five(), "2026-10-09");
      for (let i = 0; i < 2; i++) {
        assert.equal(
          mapped.activities[i].es,
          workMoment(five(), "2026-10-09", logical.activities[i].es, "start"),
        );
        assert.equal(mapped.activities[i].float, logical.activities[i].float);
      }
    }
});
test("calendar validation rejects overlaps, invalid dates and a wholly closed work week", () => {
  let c = five();
  c.week[1] = [
    ["08:00", "12:00"],
    ["11:00", "17:00"],
  ];
  assert.throws(() => validateCalendar(c), /重叠/);
  c = five();
  c.exceptions["2026-02-30"] = [];
  assert.throws(() => validateCalendar(c), /日期/);
  c = five();
  c.week = Array.from({ length: 7 }, () => []);
  assert.throws(() => validateCalendar(c), /工作日/);
  assert.throws(() => workMoment(five(), "2026-10-05", -1, "start"), /无效/);
});
