// Activity-on-arrow adapter. Durations and times are supplied by the existing
// calendar-aware CPM; this module only builds event identities and the drawing.
export type AoaEvent = {
  id: string;
  number: string;
  time: number;
  lane: number;
  latest: number;
};
export type AoaArrow = {
  id: string;
  activity: any;
  start: string;
  finish: string;
  freeFloat: number;
};
export function buildAoaNetwork(
  activities: any[],
  duration: number,
  layout: Record<string, number> = {},
) {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const successors = new Map<string, any[]>();
  activities.forEach((a) =>
    a.predecessors.forEach((d: any) =>
      successors.set(d.id, [
        ...(successors.get(d.id) || []),
        { activity: a, dependency: d },
      ]),
    ),
  );
  const endpoint = (a: any, edge: string) =>
    a[edge === "S" ? "event_start_id" : "event_finish_id"]
      ? "event:" + a[edge === "S" ? "event_start_id" : "event_finish_id"]
      : a.id + ":" + edge;
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id);
    return next ? find(next) : id;
  };
  const join = (a: string, b: string) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent.set(b, a);
  };
  // Only one-to-one zero-lag FS boundaries can be merged without inventing dependencies.
  for (const a of activities) {
    if (a.predecessors.length === 1) {
      const d = a.predecessors[0];
      if (
        d.type === "FS" &&
        d.lag === 0 &&
        (successors.get(d.id) || []).length === 1
      )
        join(endpoint(byId.get(d.id), "F"), endpoint(a, "S"));
    }
  }
  const roots = activities.filter(
    (a) => !a.event_start_id && !a.predecessors.length && a.es === 0,
  );
  for (const a of roots) join("project:start", endpoint(a, "S"));
  const terminals = activities.filter(
    (a) => !a.event_finish_id && !(successors.get(a.id) || []).length,
  );
  for (const a of terminals) join("project:finish", endpoint(a, "F"));
  const events = new Map<string, AoaEvent>();
  const activeEvents = new Set<string>();
  let count = 0;
  for (const [index, a] of activities.entries())
    for (const edge of ["S", "F"]) {
      const id = find(endpoint(a, edge)),
        time = edge === "S" ? a.es : a.ef,
        latest = edge === "S" ? a.ls : a.lf;
      if (events.has(id)) {
        const e = events.get(id)!;
        if (!a.inactive) {
          e.time = activeEvents.has(id) ? Math.max(e.time, time) : time;
          e.latest = activeEvents.has(id) ? Math.min(e.latest, latest) : latest;
        }
      }
      if (!a.inactive) activeEvents.add(id);
      if (!events.has(id))
        events.set(id, {
          id,
          number:
            a[edge === "S" ? "event_start_id" : "event_finish_id"] ||
            String(++count),
          time,
          lane: layout[id] ?? index,
          latest,
        });
    }
  // Display compact event numbers while retaining opaque persistent identities.
  const used = new Set(
    [...events.values()]
      .filter((e) => /^\d+$/.test(e.number))
      .map((e) => Number(e.number)),
  );
  let next = 1;
  for (const event of events.values())
    if (
      /^[0-9a-f]{8}-/i.test(event.number) ||
      event.number.startsWith("project:")
    ) {
      while (used.has(next)) next++;
      event.number = String(next);
      used.add(next++);
    }
  const arrows: AoaArrow[] = activities.map((a) => {
    let free = duration - a.ef;
    for (const { activity: n, dependency: d } of successors.get(a.id) || []) {
      const from = d.type[0] === "S" ? a.es : a.ef,
        to = d.type[1] === "S" ? n.es : n.ef;
      free = Math.min(free, to - from - (d.elapsed_lag ?? d.lag));
    }
    return {
      id: a.id,
      activity: a,
      start: find(endpoint(a, "S")),
      finish: find(endpoint(a, "F")),
      freeFloat: a.free_float ?? Math.max(0, free),
    };
  });
  const constraints = activities.flatMap((a) =>
    a.predecessors
      .map((d: any) => {
        const p = byId.get(d.id);
        if (!p) return null;
        const start = find(endpoint(p, d.type[0])),
          finish = find(endpoint(a, d.type[1]));
        return start === finish
          ? null
          : {
              id: d.id + ":" + a.id,
              start,
              finish,
              predecessor: p,
              successor: a,
              dependency: d,
              dummy: d.type === "FS" && d.lag === 0,
            };
      })
      .filter(Boolean),
  );
  return { events: [...events.values()], arrows, constraints };
}
