import test from "node:test";
import assert from "node:assert/strict";
import { moveReportBlock, nudgeReportBlock } from "../shared/report-layout.ts";

test("report blocks move between bands and reorder within a band without duplication", () => {
  const initial = { header: [{ id: "a" }], detail: [{ id: "b" }, { id: "c" }, { id: "d" }], summary: [], footer: [] };
  const moved = moveReportBlock(initial, "d", "detail", "b");
  assert.deepEqual(moved.detail.map((block) => block.id), ["d", "b", "c"]);
  assert.deepEqual(initial.detail.map((block) => block.id), ["b", "c", "d"]);
  const crossBand = moveReportBlock(moved, "b", "summary");
  assert.deepEqual(crossBand.detail.map((block) => block.id), ["d", "c"]);
  assert.deepEqual(crossBand.summary.map((block) => block.id), ["b"]);
  assert.deepEqual(nudgeReportBlock(crossBand, "c", -1).detail.map((block) => block.id), ["c", "d"]);
  assert.equal(moveReportBlock(crossBand, "c", "detail", "c"), crossBand);
  assert.equal(nudgeReportBlock(crossBand, "d", -1), crossBand);
});
