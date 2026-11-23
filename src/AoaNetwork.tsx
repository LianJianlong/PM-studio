import {swimlaneBands,type NetworkSwimlane} from '../shared/network-swimlanes';
import {planDurationLabels} from './plan-duration';
import { createPortal } from "react-dom";
import { useMemo, useRef, useState, useId, useEffect } from "react";
import { bridgedRoute, timeScaledTaskRoute, networkNumber, type NetworkRoute } from "../shared/network-routing";
import { buildAoaNetwork } from "../shared/aoa-network";
import {
  calendarDate,
  workingDateMinutes,
  naturalCalendar,
} from "../shared/project-calendar";
import { usePlanDrag, type PlanAnchor } from "./PlanDrag";
import { translateUiValue as t, formatUiTemplate as tf } from "./i18n";
export type NetworkDraw = {
  duration: number;
  offset: number;
  lane: number;
  finishLane: number;
  startTime: number;
  finishTime: number;
  source?: any;
  target?: any;
  type: "task" | "event" | "random";
};
export default function AoaNetwork({
  data,
  scale = 28,
  canWrite,
  onSelect,
  onDelete,
  onLink,
  onRelation,
  onLayout,
  onCreate,
  onDecision,
  onSaveAs,
  onOpen,
  onNew,
  onSwimlanesSave,
}: {
  data: any;
  scale?: number;
  canWrite: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onLink: (a: PlanAnchor, b: PlanAnchor) => void;
  onRelation: (a: any, d: any) => void;
  onLayout: (layout: Record<string, number>) => Promise<void>;
  onCreate?: (v: NetworkDraw) => Promise<void>;
  onDecision?: (id: string) => void;
  onSaveAs?: () => void;
  onOpen?: () => void;
  onNew?: () => void;
  onSwimlanesSave?:(lanes:NetworkSwimlane[])=>Promise<void>;
}) {
  const uid = useId().replace(/:/g, ""),
    svg = useRef<SVGSVGElement>(null),
    scrollbarDrag = useRef<{
      axis: "x" | "y";
      client: number;
      value: number;
      range: number;
      travel: number;
    } | null>(null),
    frame = useRef<HTMLDivElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    drag = usePlanDrag(onLink);
  const [failure, setFailure] = useState(""),
    [mode, setMode] = useState<"task" | "event" | "random" | "select" | "pan">(
      "task",
    ),
    [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 }),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<any>(null),
    [context, setContext] = useState<{
      task: any;
      x: number;
      y: number;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const [laneEditor,setLaneEditor]=useState<{id:string;name:string;isNew?:boolean}|null>(null),[laneOverride,setLaneOverride]=useState<NetworkSwimlane[]|null>(null),[laneResize,setLaneResize]=useState<any>(null);
  const resizeRef=useRef<any>(null),savedLanes:NetworkSwimlane[]=data.plan?.swimlanes||[],effectiveLanes=laneOverride||savedLanes;
  const displayLanes=laneResize?effectiveLanes.map(row=>row.id===laneResize.id?{...row,height:laneResize.height}:row):effectiveLanes;
  const bands=swimlaneBands(displayLanes),swimlaneBottom=bands.at(-1)?.bottom||70;
  useEffect(()=>{if(laneOverride&&JSON.stringify(savedLanes)===JSON.stringify(laneOverride))setLaneOverride(null)},[data.plan?.version]);
  async function commitLanes(rows:NetworkSwimlane[]){if(!canWrite||!onSwimlanesSave||busy)return;setBusy(true);setLaneOverride(rows);setFailure('');try{await onSwimlanesSave(rows);setLaneEditor(null)}catch(error){setLaneOverride(null);setFailure((error as Error).message)}finally{setBusy(false)}}
  function resizeStart(event:React.PointerEvent<SVGLineElement>,band:any){event.stopPropagation();event.preventDefault();if(!canWrite||busy)return;event.currentTarget.setPointerCapture(event.pointerId);resizeRef.current={id:band.id,y:coords(event).y,original:band.height,height:band.height};setLaneResize({...resizeRef.current})}
  function resizeMove(event:React.PointerEvent<SVGLineElement>){const drag=resizeRef.current;if(!drag)return;event.stopPropagation();drag.height=Math.max(86,Math.min(1720,Math.round(drag.original+coords(event).y-drag.y)));setLaneResize({...drag})}
  function resizeEnd(event:React.PointerEvent<SVGLineElement>,cancel=false){const drag=resizeRef.current;if(!drag)return;event.stopPropagation();resizeRef.current=null;setLaneResize(null);if(!cancel&&drag.height!==drag.original)void commitLanes(effectiveLanes.map(row=>row.id===drag.id?{...row,height:drag.height}:row))}
  const contextRef = useRef<HTMLDivElement>(null);
  function taskMenu(task: any, clientX: number, clientY: number) {
    setSelected(task.id);
    setContext({
      task,
      x: Math.max(8, Math.min(clientX, window.innerWidth - 244)),
      y: Math.max(8, Math.min(clientY, window.innerHeight - 240)),
    });
  }
  useEffect(() => {
    if (!context) return;
    contextRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const outside = (e: Event) => {
      if (!(e.target instanceof Node)||!contextRef.current?.contains(e.target)) setContext(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setContext(null);
        (
          svg.current?.querySelector(
            '[data-task="' + context.task.id + '"]',
          ) as SVGElement | null
        )?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", outside);
    };
  }, [context]);
  const [viewport, setViewport] = useState({ width: 1200, height: 620 });
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: el.clientWidth - 14, height: el.clientHeight - 14 }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft - camera.x * camera.zoom) > 0.5)
      el.scrollLeft = camera.x * camera.zoom;
    if (Math.abs(el.scrollTop - camera.y * camera.zoom) > 0.5)
      el.scrollTop = camera.y * camera.zoom;
  }, [camera, viewport]);
  const [gesture, setGesture] = useState<any>(null);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      setCamera((v) =>
        e.ctrlKey
          ? {
              ...v,
              zoom: Math.max(
                0.1,
                Math.min(4, v.zoom * (e.deltaY < 0 ? 1.1 : 0.9)),
              ),
            }
          : {
              ...v,
              x: Math.max(0, v.x + e.deltaX / v.zoom),
              y: Math.max(0, v.y + e.deltaY / v.zoom),
            },
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const graph = useMemo(
    () =>
      buildAoaNetwork(
        data.activities,
        data.duration,
        data.plan?.diagram_layout || {},
      ),
    [data],
  );
  const events = new Map(graph.events.map((e) => [e.id, e])),
    x = (v: number) => 100 + v * scale,
    y = (v: number) => 110 + v * 86;
  const start = String(data.plan?.start_date || data.start_date).slice(0, 10),
    decisions = data.plan?.decisions || [];
  const width = viewport.width / camera.zoom,
    height = viewport.height / camera.zoom;
  const bottomLane = Math.max(
    ...data.activities.map(
      (a: any, i: number) => data.plan?.diagram_layout?.["task:" + a.id] ?? i,
    ),
    Math.max(0,(swimlaneBottom-110)/86),
    ...graph.events.map((e) => e.lane),
    ...Object.entries(data.plan?.diagram_layout || {})
      .filter(([k]) => k.startsWith("task:"))
      .map(([, v]) => Number(v)),
  );

  const bandLeft=Math.min(0,camera.x),bandRight=Math.max(1000,camera.x+width,...graph.events.map(e=>x(e.time)+380));
  function coords(e: { clientX: number; clientY: number }) {
    const point = svg.current!.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    return point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  }
  function graphSvg() {
    if (!svg.current) return null;
    const clone = svg.current.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll("[data-editor-only]").forEach((n) => n.remove());
    const w = Math.max(1000, ...graph.events.map((e) => x(e.time) + 380)),
      h = Math.max(
        350,
        ...graph.events.map((e) => y(e.lane) + 160),
        y(bottomLane + 1) + 120,
      );
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    const bg = clone.querySelector("rect");
    if (bg) {
      bg.setAttribute("x", "0");
      bg.setAttribute("y", "0");
      bg.setAttribute("width", String(w));
      bg.setAttribute("height", String(h));
    }
    clone.querySelector('[data-network-legend]')?.setAttribute('transform',`translate(${w-690},${h-65})`);
    clone.querySelectorAll('[data-swimlane-label]').forEach(node=>node.setAttribute('transform','translate(0,0)'));
    clone.setAttribute("font-family", "Arial, sans-serif");
    clone
      .querySelectorAll('[stroke="#dbeafe"]')
      .forEach((n) => n.setAttribute("stroke", "transparent"));
    clone.style.position = "static";
    clone.style.left = "";
    clone.style.top = "";
    clone.style.width = "100%";
    clone.style.height = "auto";
    return { clone, w, h };
  }
  function completeAxis(clone: SVGSVGElement) {
    const axis = clone.querySelector("[data-time-axis]");
    if (axis) {
      axis.innerHTML = "";
      const ns = "http://www.w3.org/2000/svg",
        extent = Math.max(data.duration, ...graph.events.map((e) => e.time)),
        step = Math.max(1, Math.ceil(100 / scale), Math.ceil(extent / 80));
      for (let day = 0; day <= extent; day += step) {
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", String(x(day)));
        line.setAttribute("x2", String(x(day)));
        line.setAttribute("y1", "70");
        line.setAttribute(
          "y2",
          String(Number(clone.getAttribute("height")) - 100),
        );
        line.setAttribute("stroke", "#e5edf3");
        axis.append(line);
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", String(x(day)));
        text.setAttribute("y", "55");
        text.setAttribute("font-size", "11");
        text.setAttribute("text-anchor", "middle");
        text.textContent = calendarDate(start, day);
        axis.append(text);
      }
    }
  }
  function print() {
    const v = graphSvg();
    if (!v) return;
    const win = window.open("", "_blank");
    if (!win) {
      setFailure("请允许打印窗口弹出");
      return;
    }
    win.document.title = data.plan?.name || t("双代号时标网络图");
    const style = win.document.createElement("style");
    style.textContent =
      "@page{size:A3 landscape;margin:8mm}body{margin:0}svg:not(.aoa-print-legend){display:block;width:100%;height:auto;max-height:245mm}.aoa-print-legend{position:fixed;right:0;bottom:0;width:180mm;height:auto;max-height:none;display:block}";
    win.document.head.append(style);
    const printable = v.clone; // Generate the complete time axis, independent of the current viewport.
    completeAxis(printable);
    const legend=printable.querySelector('[data-network-legend]');
    if(legend){const box=win.document.createElementNS('http://www.w3.org/2000/svg','svg');box.setAttribute('class','aoa-print-legend');box.setAttribute('viewBox','-12 -38 680 86');box.setAttribute('aria-label',t('\u56fe\u4f8b'));legend.setAttribute('transform','translate(0,0)');box.append(win.document.importNode(legend,true));legend.remove();win.document.body.append(box)}
    win.document.body.append(win.document.importNode(printable, true));
    win.focus();
    setTimeout(() => win.print(), 250);
  }
  async function complete(e: React.PointerEvent<SVGSVGElement>) {
    drag.bindings.onPointerUp(e);
    const g = gesture;
    setGesture(null);
    if (!g) return;
    if (g.move) {
      const p = coords(e),
        layout = {
          ...data.plan?.diagram_layout,
          [g.move]: Math.max(0, (p.y - 110) / 86),
        };
      try {
        await onLayout(layout);
      } catch (err) {
        setFailure((err as Error).message);
      }
      return;
    }
    if (g.pan || !onCreate || busy) return;
    const p = coords(e);
    if (p.x - g.x < 12) return;
    const targetEvent = graph.events.find(
      (v) => Math.hypot(x(v.time) - p.x, y(v.lane) - p.y) < 24,
    );
    const from = g.source ? events.get(g.source) : undefined;
    const fromDay = Math.max(0, from?.time ?? (g.x - 100) / scale),
      until = Math.max(
        fromDay + 1 / 24,
        targetEvent?.time ?? (p.x - 100) / scale,
      );
    const calendar = data.calendar_config || naturalCalendar;
    const units =
      workingDateMinutes(calendar, start, fromDay, until).reduce(
        (n, d) => n + d.minutes,
        0,
      ) /
      (calendar.hours_per_day * 60);
    const offset =
      workingDateMinutes(calendar, start, 0, fromDay).reduce(
        (n, d) => n + d.minutes,
        0,
      ) /
      (calendar.hours_per_day * 60);
    try {
      setBusy(true);
      await onCreate({
        duration: Math.max(1,Math.round(units*calendar.hours_per_day))/calendar.hours_per_day,
        offset,
        lane: Math.max(0, (g.y - 110) / 86),
        finishLane: Math.max(0, (p.y - 110) / 86),
        startTime: fromDay,
        finishTime: until,
        source: from,
        target: targetEvent,
        type: mode === "event" || mode === "random" ? mode : "task",
      });
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const { geometry, allRoutes, routes } = useMemo(() => {
    const geometry = graph.arrows.map(
      ({ activity: a, start, finish }, index) => {
        const s = events.get(start)!,
          f = events.get(finish)!,
          sx = x(s.time),
          ex = x(f.time),
          sy = y(s.lane),
          fy = y(f.lane),
          parallel = graph.arrows.filter(v=>v.start===start&&v.finish===finish).length>1,
          barY = parallel ? y(data.plan?.diagram_layout?.["task:" + a.id] ?? index) : fy;
        const shape=timeScaledTaskRoute({x:sx,y:sy},{x:ex,y:fy},x(a.ef),barY);
        return { id: a.id, ...shape, activity: a };
      },
    );
    const constraints = graph.constraints.map((c: any) => {
      const s = events.get(c.start)!,
        f = events.get(c.finish)!,
        a = x(s.time),
        b = x(f.time),
        sy = y(s.lane),
        fy = y(f.lane),
        mid = (a + b) / 2;
      return {
        id: "constraint:" + c.id,
        points: timeScaledTaskRoute({x:a,y:sy},{x:b,y:fy},b).points,
      };
    });
    const allRoutes: NetworkRoute[] = [...geometry, ...constraints],
      routes = new Map(
        allRoutes.map((route) => [route.id, bridgedRoute({...route,points:geometry.find(g=>g.id===route.id)?.workPoints||route.points}, allRoutes)]),
      );
    return { geometry, allRoutes, routes };
  }, [graph, scale, data.plan?.diagram_layout]);
  const extentX = Math.max(
      4000,
      ...graph.events.map((e) => x(e.time) + 500),
      camera.x + width * 3,
    ),
    extentY = Math.max(2000, y(bottomLane + 2) + 200, camera.y + height * 3);
  function scrollbar(axis: "x" | "y") {
    const horizontal = axis === "x",
      extent = horizontal ? extentX : extentY,
      view = horizontal ? width : height,
      track = horizontal ? viewport.width : viewport.height,
      thumb = Math.min(track, Math.max(32, (track * view) / extent)),
      range = Math.max(1, extent - view),
      travel = Math.max(1, track - thumb),
      offset = Math.min(travel, (camera[axis] / range) * travel);
    return (
      <div
        className={
          "aoa-scrollbar aoa-scrollbar-" +
          (horizontal ? "horizontal" : "vertical")
        }
        role="scrollbar"
        aria-label={t(horizontal ? "横向滚动条" : "纵向滚动条")}
        aria-orientation={horizontal ? "horizontal" : "vertical"}
        aria-valuemin={0}
        aria-valuemax={Math.ceil(range)}
        aria-valuenow={Math.round(camera[axis])}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const client = horizontal ? e.clientX : e.clientY,
            rect = e.currentTarget.getBoundingClientRect(),
            pos = client - (horizontal ? rect.left : rect.top),
            value = (e.target as HTMLElement).hasAttribute("data-scroll-thumb")
              ? camera[axis]
              : Math.max(
                  0,
                  Math.min(range, ((pos - thumb / 2) / travel) * range),
                );
          setCamera((v) => ({ ...v, [axis]: value }));
          scrollbarDrag.current = { axis, client, value, range, travel };
        }}
        onPointerMove={(e) => {
          const drag = scrollbarDrag.current;
          if (drag?.axis !== axis) return;
          const client = horizontal ? e.clientX : e.clientY;
          setCamera((v) => ({
            ...v,
            [axis]: Math.max(
              0,
              drag.value + ((client - drag.client) / drag.travel) * drag.range,
            ),
          }));
        }}
        onPointerUp={() => {
          scrollbarDrag.current = null;
        }}
        onPointerCancel={() => {
          scrollbarDrag.current = null;
        }}
        onKeyDown={(e) => {
          const delta =
            e.key === "Home"
              ? -camera[axis]
              : e.key === "End"
                ? range - camera[axis]
                : ["ArrowLeft", "ArrowUp"].includes(e.key)
                  ? -60
                  : ["ArrowRight", "ArrowDown"].includes(e.key)
                    ? 60
                    : e.key === "PageUp"
                      ? -view
                      : e.key === "PageDown"
                        ? view
                        : 0;
          if (delta) {
            e.preventDefault();
            setCamera((v) => ({ ...v, [axis]: Math.max(0, v[axis] + delta) }));
          }
        }}
      >
        <div
          data-scroll-thumb="true"
          style={
            horizontal
              ? { left: offset, width: thumb }
              : { top: offset, height: thumb }
          }
        />
      </div>
    );
  }
  const first = Math.max(0, Math.floor((camera.x - 100) / scale)),
    last = Math.max(first + 1, Math.ceil((camera.x + width - 100) / scale)),
    step = Math.max(1, Math.ceil(90 / (scale * camera.zoom)));
  return (
    <div className="aoa-workbench" aria-busy={busy}>
      <div className="network-plan-toolbar">
        {canWrite &&
          onCreate &&
          (onDecision
            ? (["task", "event", "random", "select"] as const)
            : (["task", "select"] as const)
          ).map((id) => (
            <button
              key={id}
              className={mode === id ? "primary" : ""}
              onClick={() => setMode(id)}
            >
              {t(
                {
                  task: "拖拽新建任务",
                  event: "事件决策",
                  random: "随机决策",
                  select: "选择与移动",
                }[id],
              )}
            </button>
          ))}
        <button
          className={mode === "pan" ? "primary" : ""}
          onClick={() => setMode("pan")}
        >
          {t("平移画布")}
        </button>
        <button
          onClick={() =>
            setCamera((v) => ({ ...v, zoom: Math.min(4, v.zoom * 1.25) }))
          }
        >
          ＋
        </button>
        <button
          onClick={() =>
            setCamera((v) => ({ ...v, zoom: Math.max(0.1, v.zoom / 1.25) }))
          }
        >
          −
        </button>
        <button onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}>
          {t("回到起点")}
        </button>
        {onNew && canWrite && <button onClick={onNew}>{t("新建")}</button>}
        {onOpen && canWrite && <button onClick={onOpen}>{t("打开")}</button>}
        {onSaveAs && <button onClick={onSaveAs}>{t("另存为 .dm")}</button>}
        <button onClick={print}>{t("打印 / 保存PDF")}</button>
      </div>
      <p className="help">
        {t(
          "在空白处或事件节点向右拖拽创建任务；决策工具一次创建两个互斥任务。选择模式移动节点，右键查看任务详情；滚轮平移，Ctrl＋滚轮缩放。",
        )}
      </p>
      {busy && <p role="status">{t("正在保存")}</p>}
      {failure && <p role="alert">{t(failure)}</p>}
      <div className="aoa-canvas-shell" ref={frame}>
        <div
          className="aoa-scrollbars"
          ref={scroller}
          aria-label={t("画布滚动条")}
          onScroll={(e) => {
            const el = e.currentTarget,
              nx = el.scrollLeft / camera.zoom,
              ny = el.scrollTop / camera.zoom;
            if (Math.abs(nx - camera.x) > 0.5 || Math.abs(ny - camera.y) > 0.5)
              setCamera((v) => ({ ...v, x: nx, y: ny }));
          }}
        >
          <div
            style={{
              width: extentX * camera.zoom,
              height: extentY * camera.zoom,
            }}
          />
        </div>
        <svg
          ref={svg}
          role="img"
          aria-label={t("双代号时标网络图")}
          className="aoa-infinite-canvas"
          width="1200"
          height="620"
          viewBox={`${camera.x} ${camera.y} ${width} ${height}`}
          style={{
            touchAction: "none",
            position: "absolute",
            left: 0,
            top: 0,
            width: "calc(100% - 14px)",
            height: "calc(100% - 14px)",
            cursor:
              mode === "pan"
                ? "grab"
                : mode === "select"
                  ? "default"
                  : "crosshair",
          }}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (e.button !== 0 && e.button !== 1) return;
            const p = coords(e);
            if (e.button === 1 || mode === "pan") {
              e.currentTarget.setPointerCapture(e.pointerId);
              setGesture({ pan: true, cx: e.clientX, cy: e.clientY, camera });
            } else if (
              canWrite &&
              onCreate &&
              mode !== "select" &&
              !(e.target as Element).closest("[data-task]")
            ) {
              const node = (e.target as Element).closest(
                "[data-event]",
              ) as SVGElement | null;
              (node || e.currentTarget).setPointerCapture(e.pointerId);
              setGesture({
                x: p.x,
                y: p.y,
                to: p.x,
                source: node?.getAttribute("data-event"),
              });
            }
          }}
          onPointerMove={(e) => {
            drag.bindings.onPointerMove(e);
            if (gesture?.pan) {
              const b = e.currentTarget.getBoundingClientRect();
              setCamera({
                ...gesture.camera,
                x: Math.max(
                  0,
                  gesture.camera.x -
                    ((e.clientX - gesture.cx) * width) / b.width,
                ),
                y: Math.max(
                  0,
                  gesture.camera.y -
                    ((e.clientY - gesture.cy) * height) / b.height,
                ),
              });
            } else if (gesture && !gesture.move)
              setGesture({ ...gesture, to: coords(e).x, toY: coords(e).y });
          }}
          onPointerUp={complete}
          onPointerCancel={() => {
            setGesture(null);
            drag.bindings.onPointerCancel();
          }}
        >
          <defs>
            <marker
              id={uid + "arrow"}
              markerUnits="userSpaceOnUse"
              markerWidth="9"
              markerHeight="8"
              refX="8"
              refY="4"
              orient="auto"
            >
              <path d="M0 0L8 4L0 8Z" fill="context-stroke" />
            </marker>
            <pattern
              id={uid + "grid"}
              width="28"
              height="28"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r=".8" fill="#d7e1eb" />
            </pattern>
          </defs>
          <rect
            x={camera.x}
            y={camera.y}
            width={width}
            height={height}
            fill="white"
          />
          <g data-swimlanes="true">{bands.map(band=><g key={band.id} data-swimlane={band.id}>
            <rect pointerEvents="none" x={bandLeft} y={band.top} width={bandRight-bandLeft} height={band.height} fill={band.index%2?'#f3f7fc':'#edf8f4'}/>
            <line pointerEvents="none" x1={bandLeft} x2={bandRight} y1={band.bottom} y2={band.bottom} stroke="#b3cbd0" strokeDasharray="6 4"/>
            <g data-swimlane-label="true" transform={`translate(${Math.max(0,camera.x)},0)`} role={canWrite?'button':undefined} tabIndex={canWrite?0:undefined} aria-label={t('\u7f16\u8f91\u6cf3\u9053')+' '+band.name} style={{cursor:canWrite?'pointer':'default'}} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();if(canWrite&&!busy)setLaneEditor({id:band.id,name:band.name})}} onKeyDown={e=>{if(e.key==='Enter'&&canWrite&&!busy)setLaneEditor({id:band.id,name:band.name})}}><rect x={0} y={band.top+4} width={98} height={30} fill="transparent"/><text x={10} y={band.top+22} fill="#36576b" fontSize={12} fontWeight="bold"><title>{band.name}</title>{band.name.length>12?band.name.slice(0,11)+'...':band.name}</text></g>
            {canWrite&&onSwimlanesSave&&<line data-editor-only="true" data-swimlane-boundary={band.id} role="separator" aria-label={t('\u8c03\u6574\u6cf3\u9053\u9ad8\u5ea6')+' '+band.name} x1={bandLeft} x2={bandRight} y1={band.bottom} y2={band.bottom} stroke="transparent" strokeWidth={12/camera.zoom} style={{cursor:'row-resize'}} onPointerDown={e=>resizeStart(e,band)} onPointerMove={resizeMove} onPointerUp={e=>resizeEnd(e)} onPointerCancel={e=>resizeEnd(e,true)}/>}
          </g>)}</g>
          <rect
            data-editor-only="true"
            pointerEvents="none"
            x={camera.x}
            y={camera.y}
            width={width}
            height={height}
            fill={`url(#${uid}grid)`}
          />
          <g data-time-axis="true" pointerEvents="none">
            {Array.from(
              { length: Math.min(180, Math.ceil((last - first) / step) + 1) },
              (_, i) => first + i * step,
            ).map((day) => (
              <g key={day}>
                <line
                  x1={x(day)}
                  x2={x(day)}
                  y1={Math.min(70, camera.y)}
                  y2={camera.y + height}
                  stroke="#e5edf3"
                />
                <text
                  x={x(day)}
                  y="55"
                  fontSize="11"
                  textAnchor="middle"
                  fill="#60788d"
                >
                  {calendarDate(start, day)}
                </text>
              </g>
            ))}
          </g>
          {graph.constraints.map((c: any) => {
            const s = events.get(c.start)!,
              f = events.get(c.finish)!,
              a = x(s.time),
              b = x(f.time),
              sy = y(s.lane),
              fy = y(f.lane),
              mid = (a + b) / 2;
            return (
              <g
                key={c.id}
                onClick={() =>
                  canWrite && onRelation(c.successor, c.dependency)
                }
              >
                <path
                  d={routes.get("constraint:" + c.id)!.path}
                  fill="none"
                  stroke="#899baa"
                  strokeDasharray="6 4"
                  markerEnd={`url(#${uid}arrow)`}
                />
                {!c.dummy && (
                  <text
                    x={mid + 5}
                    y={(sy + fy) / 2 - 8}
                    fontSize="10"
                    fill="#75428c"
                  >
                    {c.dependency.type} {c.dependency.lag > 0 ? "+" : ""}
                    {c.dependency.lag}
                  </text>
                )}
              </g>
            );
          })}
          {graph.arrows.map(({ activity: a, start, finish }, index) => {
            const s = events.get(start)!,
              f = events.get(finish)!,
              sx = x(s.time),
              ex = x(f.time),
              sy = y(s.lane),
              fy = y(f.lane),
              shape = geometry.find(g=>g.id===a.id)!,
              barY = shape.labelY,
              end = Math.min(ex, x(a.ef)),
              color = a.critical ? "#ef4444" : a.near_critical?"#c47810":"#2563eb";
            const path = routes.get(a.id)!.path;
            return (
              <g
                key={a.id}
                data-task={a.id}
                role="button"
                tabIndex={0}
                aria-label={`${a.code} ${a.name}`}
                opacity={a.inactive ? 0.42 : 1}
                onPointerDown={(e) => {
                  if (mode !== "pan") e.stopPropagation();
                }}
                onClick={() => {
                  setSelected(a.id);
                }}
                onDoubleClick={() => onSelect(a.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  taskMenu(a, e.clientX, e.clientY);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "ContextMenu" ||
                    (e.shiftKey && e.key === "F10")
                  ) {
                    e.preventDefault();
                    const box = e.currentTarget.getBoundingClientRect();
                    taskMenu(a, box.left + 20, box.top + 20);
                    return;
                  }
                  if (e.key === "Enter") {
                    setSelected(a.id);
                    setDetail(a);
                  }
                }}
              >
                <path
                  d={bridgedRoute(shape,allRoutes).path}
                  fill="none"
                  stroke={selected === a.id ? "#dbeafe" : "transparent"}
                  strokeWidth="16"
                />
                <path
                  data-work-path="true"
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={a.critical ? 3 : 2}
                  strokeDasharray={a.inactive || a.is_dummy ? "6 4" : undefined}
                  markerEnd={shape.floatPath ? undefined : `url(#${uid}arrow)`}
                />
                {shape.floatPath && <path data-free-float="true" d={shape.floatPath} fill="none" stroke={color} strokeWidth="2" markerEnd={`url(#${uid}arrow)`}/>}
                <text textAnchor="middle" x={shape.labelX} y={barY - 15} fontSize="12" fill={a.critical&&!a.inactive?"#dc2626":a.near_critical&&!a.inactive?"#a65a00":"#17324d"}>
                  {a.code} · {a.name}
                  {a.inactive ? " " + t("未选分支") : ""}
                </text>
                <text textAnchor="middle" x={shape.labelX} y={barY + 19} fontSize="10" fill="#60788d">
                  {networkNumber(a.duration)} {t("工作日")} · TF {Number(a.float).toFixed(2)} · FF {Number(a.free_float||0).toFixed(2)}
                </text>
              </g>
            );
          })}
          <g data-crossing-bridges="true" pointerEvents="none">
            {allRoutes.flatMap((route) =>
              routes.get(route.id)!.bridges.map((d, i) => {
                const activity = geometry.find(
                    (a) => a.id === route.id,
                  )?.activity,
                  color = activity
                    ? activity.critical
                      ? "#ef4444"
                      : activity.near_critical ? "#c47810" : "#2563eb"
                    : "#899baa";
                return (
                  <g
                    key={route.id + ":" + i}
                    opacity={activity?.inactive ? 0.42 : 1}
                  >
                    <path d={d} fill="none" stroke="white" strokeWidth="8" />
                    <path
                      data-jump="true"
                      pointerEvents={activity ? "stroke" : "none"}
                      onPointerDown={(e) => activity && e.stopPropagation()}
                      onContextMenu={(e) => {
                        if (activity) {
                          e.preventDefault();
                          e.stopPropagation();
                          taskMenu(activity, e.clientX, e.clientY);
                        }
                      }}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth={activity?.critical ? 3 : 2}
                    />
                  </g>
                );
              }),
            )}
          </g>
          {graph.events.map((e) => {
            const decision = decisions.find(
              (d: any) => "event:" + d.id === e.id,
            );
            return (
              <g
                key={e.id}
                data-event={e.id}
                role="button"
                tabIndex={0}
                aria-label={
                  decision ? decision.label : tf("移动事件 {0}", [e.number])
                }
                onDoubleClick={() => decision && onDecision?.(decision.id)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && decision) onDecision?.(decision.id);
                }}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  if (decision) onDecision?.(decision.id);
                }}
                onPointerDown={(ev) => {
                  if (canWrite && mode === "select") {
                    ev.stopPropagation();
                    ev.currentTarget.setPointerCapture(ev.pointerId);
                    setGesture({ move: e.id });
                  }
                }}
              >
                {decision ? (
                  <path
                    d={`M${x(e.time) - 20},${y(e.lane)}l20,-20l20,20l-20,20Z`}
                    fill="white"
                    stroke={decision.type === "random" ? "#8b5cf6" : "#2563eb"}
                    strokeWidth="2"
                  />
                ) : (
                  <circle
                    cx={x(e.time)}
                    cy={y(e.lane)}
                    r="17"
                    fill="white"
                    stroke="#2563eb"
                    strokeWidth="2"
                  />
                )}
                <text
                  x={x(e.time)}
                  y={y(e.lane) + 4}
                  textAnchor="middle"
                  fill="#17324d"
                  fontSize="11"
                >
                  {decision
                    ? decision.type === "random"
                      ? "R"
                      : "E"
                    : e.number.slice(0, 6)}
                </text>
                {decision && (
                  <text
                    x={x(e.time) + 24}
                    y={y(e.lane) - 38}
                    fontSize="11"
                    fill="#75428c"
                  >
                    {decision.label}
                  </text>
                )}
                <title>{`${e.number} · ET ${e.time.toFixed(3)} LT ${e.latest.toFixed(3)}`}</title>
              </g>
            );
          })}
          <g data-editor-only="true">
            {mode === "select" &&
              data.activities.flatMap((a: any, index: number) => [
                drag.handle(
                  a,
                  "S",
                  x(a.es),
                  geometry.find(g=>g.id===a.id)!.labelY + 32,
                  canWrite,
                ),
                drag.handle(
                  a,
                  "F",
                  x(a.ef),
                  geometry.find(g=>g.id===a.id)!.labelY + 32,
                  canWrite,
                ),
              ])}
            {drag.preview}
            {gesture && !gesture.pan && !gesture.move && (
              <path
                d={`M${gesture.x},${gesture.y}V${gesture.toY ?? gesture.y}H${gesture.to ?? gesture.x}`}
                fill="none"
                stroke="#2563eb"
                strokeWidth="3"
                strokeDasharray="5 3"
              />
            )}
          </g>
          <g data-network-legend="true" pointerEvents="none" transform={`translate(${camera.x+width-(668*Math.min(1,(viewport.width-40)/680)+18)/camera.zoom},${camera.y+height-(48*Math.min(1,(viewport.width-40)/680)+18)/camera.zoom}) scale(${Math.min(1,(viewport.width-40)/680)/camera.zoom})`}>
            <rect x={-12} y={-38} width={680} height={86} rx={4} fill="white" fillOpacity={.96} stroke="#c3d5dc"/>
            <text x="0" y="-22" fontSize="12" fontWeight="bold">
              {(data.project_name||data.plan?.name||'').length>24?(data.project_name||data.plan?.name).slice(0,23)+'...':(data.project_name||data.plan?.name)} · {t("总工期")}：
              {planDurationLabels(data,24).both}
            </text>
            <path d="M0 0H28" stroke="#ef4444" strokeWidth="3" />
            <text x="35" y="4" fontSize="11">
              {t("关键路线")}
            </text>
            <path d="M140 0H168" stroke="#2563eb" strokeWidth="2" />
            <text x="175" y="4" fontSize="11">
              {t("普通任务")}
            </text>
            <path d="M280 0H308" stroke="#c47810" strokeWidth="2" />
            <text x="315" y="4" fontSize="11">{t("近关键作业")}</text>
            <text x="0" y="28" fontSize="11">
              ◇ E {t("事件决策")} / R {t("随机决策")} · {t("二选一")}
            </text>
          </g>
          {canWrite&&onSwimlanesSave&&<g data-editor-only="true" role="button" tabIndex={0} aria-label={t('\u65b0\u589e\u6cf3\u9053')} transform={`translate(${Math.max(18,camera.x+18)},${swimlaneBottom+24})`} style={{cursor:busy?'wait':'pointer'}} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();if(!busy&&effectiveLanes.length<100)setLaneEditor({id:crypto.randomUUID(),name:'',isNew:true})}} onKeyDown={e=>{if(e.key==='Enter'&&!busy&&effectiveLanes.length<100)setLaneEditor({id:crypto.randomUUID(),name:'',isNew:true})}}><circle r={13} fill="white" stroke="#00967d"/><text textAnchor="middle" y={5} fill="#008572" fontSize={20}>+</text></g>}
          {laneEditor&&<foreignObject data-editor-only="true" x={Math.max(10,camera.x+10)} y={laneEditor.isNew?swimlaneBottom+45:(bands.find(b=>b.id===laneEditor.id)?.top||70)+34} width={300} height={115} onPointerDown={e=>e.stopPropagation()}><form className="network-lane-popover" onSubmit={e=>{e.preventDefault();if(!laneEditor.name.trim()||busy)return;void commitLanes(laneEditor.isNew?[...effectiveLanes,{id:laneEditor.id,name:laneEditor.name.trim(),height:258}]:effectiveLanes.map(row=>row.id===laneEditor.id?{...row,name:laneEditor.name.trim()}:row))}}><input autoFocus aria-label={t('\u6cf3\u9053\u540d\u79f0')} value={laneEditor.name} maxLength={120} disabled={busy} placeholder={t('\u6cf3\u9053\u540d\u79f0')} onChange={e=>setLaneEditor({...laneEditor,name:e.target.value})} onKeyDown={e=>{if(e.key==='Escape')setLaneEditor(null)}}/><button className="primary" disabled={busy||!laneEditor.name.trim()}>{t('\u4fdd\u5b58')}</button>{!laneEditor.isNew&&<button type="button" disabled={busy} onClick={()=>void commitLanes(effectiveLanes.filter(row=>row.id!==laneEditor.id))}>{t('\u5220\u9664\u6cf3\u9053')}</button>}<button type="button" disabled={busy} onClick={()=>setLaneEditor(null)}>{t('\u53d6\u6d88')}</button></form></foreignObject>}
        </svg>
        {scrollbar("x")}
        {scrollbar("y")}
        <div className="aoa-scrollbar-corner" />
      </div>
      {context &&
        createPortal(
          <div
            ref={contextRef}
            role="menu"
            aria-label={t("任务操作")}
            className="aoa-context-menu"
            style={{ left: context.x, top: context.y }}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              const buttons = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]',
                  ),
                ],
                index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ]?.focus();
              }
              if (e.key === "Tab") setContext(null);
            }}
          >
            <div
              className="aoa-context-title"
              title={context.task.code + " · " + context.task.name}
            >
              {context.task.code} · {context.task.name}
            </div>
            <button
              role="menuitem"
              onClick={() => {
                setDetail(context.task);
                setContext(null);
              }}
            >
              {t("任务详情")}
            </button>
            {canWrite && (
              <button
                role="menuitem"
                onClick={() => {
                  onSelect(context.task.id);
                  setContext(null);
                }}
              >
                {t("编辑任务")}
              </button>
            )}
            {canWrite &&
              onDecision &&
              decisions.some((d: any) =>
                d.branches.includes(context.task.id),
              ) && (
                <button
                  role="menuitem"
                  onClick={() => {
                    const decision = decisions.find((d: any) =>
                      d.branches.includes(context.task.id),
                    );
                    onDecision(decision.id);
                    setContext(null);
                  }}
                >
                  {t("决策节点设置")}
                </button>
              )}
            {canWrite && onDelete && (
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  onDelete(context.task.id);
                  setContext(null);
                }}
              >
                {t("删除任务")}
              </button>
            )}
          </div>,
          document.body,
        )}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("任务详情")}
            className="panel aoa-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>{t("任务详情")}</h3>
            <p>
              {detail.code} · {detail.name}
            </p>
            <p>
              {t("工期")}：{networkNumber(detail.duration)} {t("工作日")}
            </p>
            <p>
              ES {detail.work_es ?? detail.es} · EF{" "}
              {detail.work_ef ?? detail.ef} · LS {detail.work_ls ?? detail.ls} ·
              LF {detail.work_lf ?? detail.lf} · {t("总浮时")} TF {detail.float} · {t("自由浮时")} FF {detail.free_float??0}
            </p>
            <p>
              {detail.inactive
                ? t("未选分支")
                : detail.critical
                  ? t("关键路线")
                  : detail.near_critical ? t("近关键作业") : t("普通任务")}
            </p>
            <p>
              {t("前置关系")}：
              {detail.predecessors
                .map(
                  (d: any) =>
                    `${data.activities.find((a: any) => a.id === d.id)?.code || d.id} ${d.type} ${d.lag}`,
                )
                .join("；") || "—"}
            </p>
            {canWrite && (
              <button
                onClick={() => {
                  setDetail(null);
                  onSelect(detail.id);
                }}
              >
                {t("编辑任务")}
              </button>
            )}
            <button onClick={() => setDetail(null)}>{t("关闭")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
