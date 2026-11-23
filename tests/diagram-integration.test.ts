import test from "node:test";
import assert from "node:assert/strict";
import { convertDiagram } from "../server/diagram-import.ts";
import { schedule } from "../server/schedule.ts";
import { buildAoaNetwork } from "../shared/aoa-network.ts";
import { buildResourceCurves } from "../server/resources.ts";
import { resourceTicks } from "../shared/resource-values.ts";
import { calendarTemplate } from "../shared/project-calendar.ts";
const source = () => ({
  projectName: "保留的业务名称",
  projectStartDate: "2026-10-19",
  nodes: [
    { id: "1", y: 1 },
    { id: "2", y: 1 },
    { id: "3", y: 2 },
    { id: "4", y: 1 },
  ],
  tasks: [
    {
      id: "A",
      name: "准备",
      duration: 2,
      startNodeId: "1",
      endNodeId: "2",
      taskResources: [{ resourceId: "R", quantityPerDay: 2 }],
    },
    { id: "B", name: "施工", duration: 3, startNodeId: "2", endNodeId: "4" },
    { id: "C", name: "并行", duration: 1, startNodeId: "1", endNodeId: "4" },
  ],
  resources: [
    { id: "R", name: "人工班组", type: "人工", cost: 10, unit: "工日" },
  ],
});
test("diagram import reconstructs event-derived precedence, retains names and event identities", () => {
  const { document } = convertDiagram(source(), "2026-10-01");
  assert.equal(document.name, "保留的业务名称");
  const scheduled = schedule(document.activities);
  assert.equal(scheduled.duration, 5);
  assert.equal(
    document.activities[1].predecessors[0].id,
    document.activities[0].id,
  );
  const graph = buildAoaNetwork(
    scheduled.activities,
    5,
    document.diagram_layout,
  );
  assert.equal(graph.events.length, 3);
  assert.equal(graph.events.find((e) => e.number === "4")?.time, 5);
  assert.equal(document.activities[2].name, "并行");
  assert.equal(graph.arrows[2].freeFloat, 4);
});
test("diagram decisions select active scenario and reject broken nodes / circular networks", () => {
  const input: any = source();
  input.nodes[0] = { id: "1", type: "decision", selectedBranchId: "A" };
  assert.equal(
    convertDiagram(input, "2026-10-01").document.activities.length,
    3,
  );
  assert.equal(
    convertDiagram(input, "2026-10-01").document.decisions.length,
    1,
  );
  const broken = source();
  broken.tasks[0].endNodeId = "absent";
  assert.throws(() => convertDiagram(broken, "2026-10-01"));
  const cycle = source();
  cycle.tasks[0].startNodeId = "4";
  assert.throws(() => convertDiagram(cycle, "2026-10-01"), /循环/);
});
test("shared exact curves conserve quantities and both costs across partial workdays, excluding holidays", () => {
  const calendar = calendarTemplate("five"),
    start = "2026-10-23";
  const activities = [
    {
      id: "A",
      code: "A",
      name: "work",
      duration: 1.5,
      progress: 0,
      predecessors: [],
    },
  ];
  const planned = schedule(activities, calendar, start);
  const [r] = buildResourceCurves(
    [
      {
        id: "R",
        capacity: "1.0000",
        allocations: [
          {
            activity_id: "A",
            quantity: "3.0001",
            planned_cost: "10.0001",
            actual_cost: "8.0001",
          },
        ],
      },
    ],
    planned,
    start,
    calendar,
  );
  assert.deepEqual(
    r.curve.map((v: any) => v.date),
    ["2026-10-23", "2026-10-26"],
  );
  for (const key of ["quantity", "planned_cost", "actual_cost"])
    assert.equal(
      r.curve.reduce((sum: bigint, v: any) => sum + resourceTicks(v[key]), 0n),
      resourceTicks(
        (
          {
            quantity: "4.5002",
            planned_cost: "10.0001",
            actual_cost: "8.0001",
          } as any
        )[key],
      ),
    );
  assert.equal(r.overloaded_days, 2);
});
test("native logical imports retain dates, calendar and codes while ignoring resource and currency payloads", () => {
  const native = {
    format: "project-studio-network-plan",
    version: 1,
    name: "EUR方案",
    currency: "EUR",
    granularity: "详细计划",
    start_date: "2026-09-01",
    calendar_config: calendarTemplate("five"),
    diagram_layout: {},
    activities: [
      {
        id: "1c00bf90-e4df-45d5-ace8-ff98403c6082",
        code: "WBS-001",
        name: "保留名字",
        duration: 1,
        progress: 50,
        predecessors: [],
      },
    ],
    resources: [
      {
        id: "d9aa9e5e-a245-4dda-8e5d-6db391adf92f",
        kind: "human",
        name: "Resource",
        unit: "h",
        rate: "12.5000",
        capacity: "8.0000",
        currency: "EUR",
        allocations: [
          {
            activity_id: "1c00bf90-e4df-45d5-ace8-ff98403c6082",
            quantity: "1.0001",
            planned_cost: "12.5013",
            actual_cost: "11.0001",
          },
        ],
      },
    ],
  };
  const converted = convertDiagram(native, "2026-01-01");
  assert.equal("currency" in converted.document, false);
  assert.equal("resources" in converted.file, false);
  assert.equal(converted.document.start_date, "2026-09-01");
  assert.equal(converted.document.activities[0].code, "WBS-001");
  assert.equal(converted.document.calendar_config?.hours_per_day, 8);
  assert.equal("taskResources" in converted.active[0], false);
});
