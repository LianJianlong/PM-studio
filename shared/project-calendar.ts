export type Period = [string, string];
export type ProjectCalendar = {
  name: string;
  week: Period[][];
  exceptions: Record<string, Period[]>;
  hours_per_day: number;
  hours_per_week: number;
  hours_per_month: number;
  hours_per_year: number;
};
export const naturalCalendar: ProjectCalendar = {
  name: "自然日",
  week: Array.from({ length: 7 }, () => [["00:00", "24:00"]]),
  exceptions: {},
  hours_per_day: 24,
  hours_per_week: 168,
  hours_per_month: 730,
  hours_per_year: 8760,
};
export function minute(v: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v) && v !== "24:00")
    throw Error("时间须为HH:mm，结束可用24:00");
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
}
export function validateCalendar(c: ProjectCalendar, wholeHours = true) {
  if (!c.name?.trim() || c.name.length > 120 || c.week.length !== 7)
    throw Error("日历名称及七天工作周不能为空");
  for (const n of [
    c.hours_per_day,
    c.hours_per_week,
    c.hours_per_month,
    c.hours_per_year,
  ])
    if (!Number.isFinite(n) || n < (wholeHours?1:1/60) || wholeHours&&!Number.isInteger(n)) throw Error("时间单位换算必须为正整数小时");
  if (
    c.hours_per_day > 24 ||
    c.hours_per_week > 168 ||
    c.hours_per_month > 744 ||
    c.hours_per_year > 8784
  )
    throw Error("时间单位换算超过允许范围");
  const validate = (ps: Period[]) => {
    let end = 0;
    if (ps.length > 8) throw Error("每天最多8段工时");
    for (const [s, e] of ps) {
      const a = minute(s),
        b = minute(e);
      if(wholeHours&&(a%60!==0||b%60!==0))throw Error("工作时段只支持整小时，不支持分钟");
      if (a < end || b <= a) throw Error("工时必须按先后排列且不能重叠");
      end = b;
    }
  };
  c.week.forEach(validate);
  if (!c.week.some((p) => p.length))
    throw Error("标准工作周至少包含一个工作日");
  if (Object.keys(c.exceptions).length > 1000)
    throw Error("最多1000个例外日期");
  for (const [date, ps] of Object.entries(c.exceptions)) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
    )
      throw Error("例外日期无效");
    validate(ps);
  }
  return c;
}
export function calendarPeriods(c: ProjectCalendar, date: string) {
  return (
    c.exceptions[date] ?? c.week[new Date(date + "T00:00:00Z").getUTCDay()]
  );
}
export function calendarDate(start: string, offset: number) {
  return new Date(
    new Date(start + "T00:00:00Z").getTime() + Math.floor(offset) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
}
export function calendarTemplate(
  kind: "natural" | "five" | "six",
): ProjectCalendar {
  const c = structuredClone(naturalCalendar);
  if (kind === "natural") return c;
  c.name = kind === "five" ? "标准五天工作周" : "标准六天工作周";
  c.week = c.week.map((_, day) =>
    day === 0 || (kind === "five" && day === 6)
      ? []
      : [
          ["08:00", "12:00"],
          ["13:00", "17:00"],
        ],
  );
  c.hours_per_day = 8;
  c.hours_per_week = kind === "five" ? 40 : 48;
  c.hours_per_year = c.hours_per_week * 52;
  c.hours_per_month = Math.round(c.hours_per_year / 12);
  return c;
}
export const defaultProjectCalendar=calendarTemplate('five');
export function calendarHours(c: ProjectCalendar, from: string, until: string) {
  if (from >= until) return 0;
  let minutes = 0;
  for (
    let date = from, days = 0;
    date < until;
    date = calendarDate(date, 1), days++
  ) {
    if (days > 40000) throw Error("统计范围超过100年");
    for (const [s, e] of calendarPeriods(c, date))
      minutes += minute(e) - minute(s);
  }
  return minutes / 60;
}
export function workingDateMinutes(
  c: ProjectCalendar,
  start: string,
  es: number,
  ef: number,
) {
  const result: { date: string; minutes: number }[] = [];
  for (let d = Math.floor(es); d < Math.ceil(ef); d++) {
    const date = calendarDate(start, d);
    const minutes = calendarPeriods(c, date).reduce(
      (total, [s, e]) =>
        total +
        Math.max(
          0,
          Math.min(ef * 1440, d * 1440 + minute(e)) -
            Math.max(es * 1440, d * 1440 + minute(s)),
        ),
      0,
    );
    if (minutes > 1e-7) result.push({ date, minutes: Math.round(minutes) });
  }
  return result;
}
export function workMoment(
  c: ProjectCalendar,
  start: string,
  units: number,
  edge: "start" | "finish",
) {
  let remaining = units * c.hours_per_day * 60;
  if (!Number.isFinite(remaining) || remaining < 0) throw Error("工作时间无效");
  for (let day = 0; day < 40000; day++)
    for (const [s, e] of calendarPeriods(c, calendarDate(start, day))) {
      const from = minute(s),
        to = minute(e),
        span = to - from;
      if (
        remaining < span - 1e-7 ||
        (edge === "finish" && Math.abs(remaining - span) < 1e-7)
      )
        return day + (from + remaining) / 1440;
      remaining -= span;
      if (Math.abs(remaining) < 1e-7) remaining = 0;
    }
  throw Error("日历工作时间不足或排程超过100年");
}
export function workingDates(
  c: ProjectCalendar,
  start: string,
  es: number,
  ef: number,
) {
  const dates: string[] = [];
  for (let d = Math.floor(es); d < Math.ceil(ef); d++) {
    const date = calendarDate(start, d);
    if (
      calendarPeriods(c, date).some(
        ([s, e]) =>
          Math.min(ef, d + minute(e) / 1440) >
          Math.max(es, d + minute(s) / 1440) + 1e-9,
      )
    )
      dates.push(date);
  }
  return dates.length ? dates : [calendarDate(start, es)];
}
