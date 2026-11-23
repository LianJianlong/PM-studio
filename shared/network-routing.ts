export type Point = { x: number; y: number };
export type NetworkRoute = { id: string; points: Point[] };
export type TaskBox = { start: number; finish: number; lane: number };
// Preserve the pointer's exact row; only overlapping task footprints justify a nudge.
export function nearestTaskLane(
  intended: number,
  start: number,
  finish: number,
  occupied: TaskBox[],
  spacing = 52 / 86,
) {
  const clear = (lane: number) =>
    lane >= 0 &&
    !occupied.some(
      (b) =>
        Math.min(finish, b.finish) - Math.max(start, b.start) > 1e-7 &&
        Math.abs(lane - b.lane) < spacing - 1e-7,
    );
  if (clear(intended)) return intended;
  const candidates = occupied
    .flatMap((b) => [b.lane + spacing, b.lane - spacing])
    .filter(clear);
  candidates.sort((a, b) => {
    const distance = Math.abs(a - intended) - Math.abs(b - intended);
    return Math.abs(distance) > 1e-7 ? distance : b - a;
  });
  return (
    candidates[0] ??
    Math.max(intended, ...occupied.map((b) => b.lane)) + spacing
  );
}
// Only horizontal segments jump vertical crossings. Endpoints and corners stay joined.
export function bridgedRoute(
  route: NetworkRoute,
  all: NetworkRoute[],
  radius = 5,
) {
  const points = route.points.filter(
    (p, i) =>
      !i || p.x !== route.points[i - 1].x || p.y !== route.points[i - 1].y,
  );
  if (!points.length) return { path: "", bridges: [] as string[] };
  let path = `M${points[0].x},${points[0].y}`;
  const bridges: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    if (a.y === b.y) {
      const direction = Math.sign(b.x - a.x) || 1,
        low = Math.min(a.x, b.x),
        high = Math.max(a.x, b.x),
        crossings: number[] = [];
      for (const other of all) {
        if (other.id === route.id) continue;
        for (let k = 1; k < other.points.length; k++) {
          const c = other.points[k - 1],
            d = other.points[k];
          if (
            c.x !== d.x ||
            c.y === d.y ||
            c.x <= low + radius * 2 ||
            c.x >= high - radius * 2 ||
            a.y <= Math.min(c.y, d.y) + radius ||
            a.y >= Math.max(c.y, d.y) - radius
          )
            continue;
          if (!crossings.some((x) => Math.abs(x - c.x) < radius * 2 + 2))
            crossings.push(c.x);
        }
      }
      crossings.sort((x, y) => (x - y) * direction);
      for (const cx of crossings) {
        const before = cx - direction * radius,
          after = cx + direction * radius,
          arc = `M${before},${a.y}A${radius},${radius} 0 0 ${direction > 0 ? 1 : 0} ${after},${a.y}`;
        path += `H${before}A${radius},${radius} 0 0 ${direction > 0 ? 1 : 0} ${after},${a.y}`;
        bridges.push(arc);
      }
      path += `H${b.x}`;
    } else if (a.x === b.x) path += `V${b.y}`;
    else throw Error("Network routes must be orthogonal");
  }
  return { path, bridges };
}

/** Reference diagram convention: leave the source vertically, work horizontally
 * on the destination row, and attach the arrow to the destination boundary. */
export function timeScaledTaskRoute(start:Point,finish:Point,workFinishX:number,taskY=finish.y,radius=18){
 if(Math.abs(finish.x-start.x)<0.001 && Math.abs(finish.y-start.y)>0.001 && Math.abs(taskY-finish.y)<0.001){
  const sign=Math.sign(finish.y-start.y);const points=[{x:start.x,y:start.y+sign*radius},{x:finish.x,y:finish.y-sign*radius}];
  return {points,workPoints:points,floatPath:'',labelX:start.x+24,labelY:(start.y+finish.y)/2};
 }
 const direction=finish.x>=start.x?1:-1;
 const vertical=Math.abs(start.y-taskY)>0.001;
 const endVertical=Math.abs(taskY-finish.y)>0.001;
 const entry={x:finish.x-(endVertical?0:direction*radius),y:finish.y+(endVertical?Math.sign(taskY-finish.y)*radius:0)};
 const begin={x:start.x+(vertical?0:direction*radius),y:start.y+(vertical?Math.sign(taskY-start.y)*radius:0)};
 const tailX=endVertical?finish.x:entry.x;
 const workX=direction>0?Math.min(tailX,Math.max(start.x,workFinishX)):Math.max(tailX,Math.min(start.x,workFinishX));
 const prefix=[begin,...(vertical?[{x:start.x,y:taskY}]:[])];
 const points=[...prefix,{x:tailX,y:taskY},entry];
 const hasFloat=direction*(tailX-workX)>3;
 const workPoints=hasFloat?[...prefix,{x:workX,y:taskY}]:points;
 let floatPath='';
 if(hasFloat){floatPath=`M${workX},${taskY}`;const length=Math.abs(tailX-workX),count=Math.max(1,Math.ceil(length/12));for(let i=0;i<count;i++){const a=workX+direction*length*i/count,b=workX+direction*length*(i+1)/count;floatPath+=`Q${(a+b)/2},${taskY+(i%2?-4:4)} ${b},${taskY}`;}if(endVertical)floatPath+=`V${entry.y}`;}
 return {points,workPoints,floatPath,labelX:(start.x+workX)/2,labelY:taskY};
}
export function networkNumber(value:number){return Number.isFinite(value)?String(Number(value.toFixed(3))):'—'}
