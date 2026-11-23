import test from "node:test";
import assert from "node:assert/strict";
import { schedule, type Activity } from "../server/schedule.ts";
import {
  hashPassword,
  verifyPassword,
  encrypt,
  decrypt,
} from "../server/security.ts";
const a = (
  id: string,
  duration: number,
  predecessors: any[] = [],
): Activity => ({
  id,
  code: id,
  name: id,
  duration,
  progress: 0,
  predecessors,
});
test("CPM diamond calculates float, critical path and duration", () => {
  const s = schedule([
    a("A", 3),
    a("B", 5, [{ id: "A", type: "FS", lag: 0 }]),
    a("C", 2, [{ id: "A", type: "FS", lag: 0 }]),
    a("D", 4, [
      { id: "B", type: "FS", lag: 0 },
      { id: "C", type: "FS", lag: 0 },
    ]),
  ]);
  assert.equal(s.duration, 12);
  assert.deepEqual(
    s.activities.map((a) => [a.es, a.ef, a.float, a.critical]),
    [
      [0, 3, 0, true],
      [3, 8, 0, true],
      [3, 5, 3, false],
      [8, 12, 0, true],
    ],
  );
});
test('progress weighting excludes zero-duration milestones unless equal weighting is selected',()=>{
 const rows=[{...a('work',10),progress:100},a('milestone',0)];
 assert.equal(schedule(rows).progress,100);
 assert.equal(schedule(rows,undefined,undefined,'equal').progress,50);
 assert.equal(schedule([{...a('m1',0),progress:100},a('m2',0)]).progress,50);
 assert.equal(schedule([]).progress,0);
});
test("SS FF SF and lag produce valid start constraints", () => {
  const s = schedule([
    a("A", 10),
    a("B", 4, [{ id: "A", type: "SS", lag: 3 }]),
    a("C", 4, [{ id: "A", type: "FF", lag: 2 }]),
    a("D", 2, [{ id: "B", type: "SF", lag: 1 }]),
  ]);
  assert.deepEqual(
    s.activities.map((a) => a.es),
    [0, 3, 8, 2],
  );
  assert.equal(s.duration, 12);
});
test("cycles and foreign predecessors fail", () => {
  assert.throws(
    () =>
      schedule([
        a("A", 1, [{ id: "B", type: "FS", lag: 0 }]),
        a("B", 1, [{ id: "A", type: "FS", lag: 0 }]),
      ]),
    /循环/,
  );
  assert.throws(
    () => schedule([a("A", 1, [{ id: "outside", type: "FS", lag: 0 }])]),
    /不存在/,
  );
});
test("empty project and zero-duration milestone work", () => {
  assert.equal(schedule([]).duration, 0);
  const s = schedule([a("A", 4), a("M", 0, [{ id: "A", type: "FS", lag: 0 }])]);
  assert.equal(s.activities[1].es, 4);
});
test("password hashing is salted and constant length", () => {
  const p = "a sufficiently long pass";
  const hash = hashPassword(p);
  assert.notEqual(hash, hashPassword(p));
  assert.equal(verifyPassword(p, hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
});
test("connection encryption roundtrips and rejects tampering", () => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  const value = { password: "sensitive-value" };
  const encrypted = encrypt(value);
  assert.ok(!encrypted.includes(value.password));
  assert.deepEqual(decrypt(encrypted), value);
  const parts = encrypted.split(".");
  parts[1] = Buffer.alloc(16).toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
});
