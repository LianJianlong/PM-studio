import test from "node:test";
import assert from "node:assert/strict";
import { nearestTaskLane, bridgedRoute } from "../shared/network-routing.ts";
test("new tasks retain exact dragged row, including fractional positions and disjoint intervals", () => {
  assert.equal(nearestTaskLane(2.345, 0, 2, []), 2.345);
  assert.equal(
    nearestTaskLane(2.345, 3, 5, [{ start: 0, finish: 2, lane: 2.345 }]),
    2.345,
  );
});
test("only collisions move a task to the closest available row", () => {
  assert.equal(
    nearestTaskLane(2.1, 1, 3, [{ start: 0, finish: 2, lane: 2 }]),
    2 + 52 / 86,
  );
  const lane = nearestTaskLane(2, 1, 3, [{ start: 0, finish: 2, lane: 2 }]);
  assert.equal(lane, 2 + 52 / 86);
  assert.equal(
    nearestTaskLane(2, 1, 3, [
      { start: 0, finish: 2, lane: 2 },
      { start: 1, finish: 2, lane: 2 + 52 / 86 },
    ]),
    2 - 52 / 86,
  );
});
test("horizontal crossings get a small arc, without diagonal segments or endpoint bridges", () => {
  const h = {
      id: "h",
      points: [
        { x: 0, y: 30 },
        { x: 100, y: 30 },
      ],
    },
    v = {
      id: "v",
      points: [
        { x: 50, y: 0 },
        { x: 50, y: 80 },
      ],
    };
  const result = bridgedRoute(h, [h, v]);
  assert.equal(result.bridges.length, 1);
  assert.match(result.path, /A5,5/);
  assert.doesNotMatch(result.path, /[Ll]/);
  assert.equal(
    bridgedRoute(
      {
        ...h,
        points: [
          { x: 50, y: 30 },
          { x: 100, y: 30 },
        ],
      },
      [h, v],
    ).bridges.length,
    0,
  );
  assert.equal(bridgedRoute(v, [h, v]).bridges.length, 0);
});

import {timeScaledTaskRoute,networkNumber} from '../shared/network-routing.ts';
test('time-scaled task uses destination row with one source turn and a boundary arrow',()=>{
 const shape=timeScaledTaskRoute({x:100,y:110},{x:400,y:196},400);
 assert.deepEqual(shape.points,[{x:100,y:128},{x:100,y:196},{x:382,y:196},{x:382,y:196}]);
 assert.equal(shape.labelY,196);assert.equal(shape.floatPath,'');
 const path=bridgedRoute({id:'task',points:shape.points},[]).path;
 assert.equal(path,'M100,128V196H382');assert(!path.includes('L'));
});
test('same-row tasks have no artificial elbows and same-time dummy arrows remain vertical',()=>{
 const same=timeScaledTaskRoute({x:100,y:110},{x:400,y:110},400);
 assert.equal(bridgedRoute({id:'task',points:same.points},[]).path,'M118,110H382');
 const dummy=timeScaledTaskRoute({x:100,y:110},{x:100,y:250},100);
 assert.equal(bridgedRoute({id:'dummy',points:dummy.points},[]).path,'M100,128V232');
});
test('waiting time is a wave after actual work, and parallel decisions can retain independent rows',()=>{
 const wait=timeScaledTaskRoute({x:100,y:110},{x:400,y:196},300);
 assert.equal(wait.workPoints.at(-1)?.x,300);assert.match(wait.floatPath,/^M300,196Q/);assert.match(wait.floatPath,/382,196$/);
 const branch=timeScaledTaskRoute({x:100,y:110},{x:400,y:196},400,282);
 assert.equal(branch.labelY,282);assert.deepEqual(branch.points.at(-1),{x:400,y:214});
 for(let i=1;i<branch.points.length;i++)assert(branch.points[i-1].x===branch.points[i].x||branch.points[i-1].y===branch.points[i].y);
 assert.equal(networkNumber(7.5979166666666),'7.598');assert.equal(networkNumber(3),'3');
});
