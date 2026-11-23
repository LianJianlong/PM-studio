import test from "node:test";
import assert from "node:assert/strict";
import { scheduleNetwork } from "../server/network-schedule.ts";
import { networkDocument } from "../server/network-plan-model.ts";
import { convertDiagram } from "../server/diagram-import.ts";
import { buildAoaNetwork } from "../shared/aoa-network.ts";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
function document() {
  return networkDocument.parse({
    name: "Decision",
    granularity: "详细计划",
    start_date: "2026-10-19",
    activities: ids.map((id, i) => ({
      id,
      code: "A" + i,
      name: "Task " + i,
      duration: [2, 10, 3][i],
      progress: 0,
      event_start_id: i === 2 ? "join" : "choice",
      event_finish_id: i === 2 ? "end" : "join",
      predecessors:
        i === 2
          ? ids.slice(0, 2).map((id) => ({ id, type: "FS", lag: 0 }))
          : [],
    })),
    decisions: [
      {
        id: "choice",
        label: "Choose",
        type: "random",
        branches: ids.slice(0, 2),
        selected: ids[0],
        probability: 30,
      },
    ],
  });
}
test("exclusive choice changes total and critical path, retains dormant alternative and OR join", () => {
  const doc = document();
  let result = scheduleNetwork(
    doc.activities,
    doc.decisions,
    null,
    doc.start_date,
  );
  assert.equal(result.duration, 5);
  assert.equal(result.activities[1].inactive, true);
  assert.equal(result.activities[1].critical, false);
  assert.equal(result.activities[2].es, 2);
  const graph = buildAoaNetwork(result.activities, result.duration);
  assert.equal(graph.events.find((e) => e.number === "join")?.time, 2);
  doc.decisions[0].selected = ids[1];
  result = scheduleNetwork(doc.activities, doc.decisions, null, doc.start_date);
  assert.equal(result.duration, 13);
  assert.equal(result.activities[0].inactive, true);
  assert.equal(result.activities[1].critical, true);
});
test("native import preserves both alternatives, type, probability and saved selection", () => {
  const doc = document();
  doc.diagram_layout["task:" + ids[0]] = 9;
  const converted = convertDiagram(
    { format: "project-studio-network-plan", ...doc },
    doc.start_date,
  );
  assert.equal(converted.document.activities.length, 3);
  assert.equal(
    converted.document.diagram_layout[
      "task:" + converted.document.activities[0].id
    ],
    9,
  );
  assert.equal(converted.document.decisions[0].type, "random");
  assert.equal(converted.document.decisions[0].probability, 30);
  assert.equal(
    scheduleNetwork(
      converted.document.activities,
      converted.document.decisions,
      null,
      doc.start_date,
    ).duration,
    5,
  );
});
test("decision validation rejects a third outgoing task and invalid selection", () => {
  const doc = document();
  assert.throws(() =>
    networkDocument.parse({
      ...doc,
      decisions: [{ ...doc.decisions[0], selected: ids[2] }],
    }),
  );
  assert.throws(() =>
    networkDocument.parse({
      ...doc,
      activities: doc.activities.map((a) => ({
        ...a,
        event_start_id: "choice",
      })),
    }),
  );
});
test("drawing start offset survives calendar scheduling and logical import", () => {
  const doc = document();
  doc.activities = doc.activities
    .slice(0, 1)
    .map((a) => ({ ...a, start_offset: 3 }));
  doc.decisions = [];
  assert.equal(
    scheduleNetwork(doc.activities, [], null, doc.start_date).duration,
    5,
  );
  const imported = convertDiagram(
    { format: "project-studio-network-plan", ...doc },
    doc.start_date,
  );
  assert.equal(imported.document.activities[0].start_offset, 3);
});
