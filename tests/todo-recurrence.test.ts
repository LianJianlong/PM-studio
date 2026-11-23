import test from "node:test";
import assert from "node:assert/strict";
import { nextTodoDate } from "../shared/todo-recurrence.ts";
test("monthly todos clamp month ends while retaining the original anchor", () => {
  assert.equal(nextTodoDate("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextTodoDate("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextTodoDate("2024-01-31", "monthly", 31), "2024-02-29");
  assert.equal(nextTodoDate("2026-12-31", "monthly", 31), "2027-01-31");
  assert.equal(nextTodoDate("2026-01-30", "monthly", 30), "2026-02-28");
});
test("daily and weekly recurrence cross year boundaries and reject impossible dates", () => {
  assert.equal(nextTodoDate("2026-12-31", "daily"), "2027-01-01");
  assert.equal(nextTodoDate("2026-12-28", "weekly"), "2027-01-04");
  assert.equal(nextTodoDate("2026-10-04", "none"), null);
  assert.throws(() => nextTodoDate("2026-02-30", "monthly"));
  assert.throws(() => nextTodoDate("2026-01-31", "monthly", 32));
});
