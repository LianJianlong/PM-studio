import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState } from "react";
export type PlanAnchor = {
    id: string;
    edge: "S" | "F";
    x: number;
    y: number;
};
export function usePlanDrag(onLink: (source: PlanAnchor, target: PlanAnchor) => void) {
    const [source, setSource] = useState<PlanAnchor | null>(null), [point, setPoint] = useState<{
        x: number;
        y: number;
    } | null>(null);
    function coords(svg: SVGSVGElement, x: number, y: number) {
        const p = svg.createSVGPoint();
        p.x = x;
        p.y = y;
        return p.matrixTransform(svg.getScreenCTM()!.inverse());
    }
    const bindings = {
        onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
            if (source)
                setPoint(coords(e.currentTarget, e.clientX, e.clientY));
        },
        onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => {
            if (!source)
                return;
            const t = document
                .elementFromPoint(e.clientX, e.clientY)
                ?.closest("[data-plan-anchor]") as SVGCircleElement | null;
            if (t) {
                const target = {
                    id: t.dataset.activity!,
                    edge: t.dataset.boundary as "S" | "F",
                    x: Number(t.getAttribute("cx")),
                    y: Number(t.getAttribute("cy")),
                };
                if (target.id !== source.id)
                    onLink(source, target);
            }
            setSource(null);
            setPoint(null);
        },
        onPointerCancel: () => {
            setSource(null);
            setPoint(null);
        },
    };
    function handle(a: any, edge: "S" | "F", x: number, y: number, enabled: boolean) {
        return enabled ? (<circle key={a.id + edge} role="button" tabIndex={0} aria-label={__uiFormat("拖拽 {0} {1}", [a.code, edge === "S" ? __ui("开始") : __ui("完成")])} data-plan-anchor="true" data-activity={a.id} data-boundary={edge} cx={x} cy={y} r="8" className="plan-anchor" onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setSource({ id: a.id, edge, x, y });
                setPoint({ x, y });
            }} onKeyDown={(e) => {
                if (e.key === "Escape") {
                    setSource(null);
                    setPoint(null);
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    const target = { id: a.id, edge, x, y };
                    if (source && source.id !== a.id) {
                        onLink(source, target);
                        setSource(null);
                        setPoint(null);
                    }
                    else {
                        setSource(target);
                        setPoint({ x, y });
                    }
                }
            }}>
        <title>{__ui("拖至另一作业端点建立")}{__ui(edge === "S" ? "开始" : "完成")}{__ui("关系；也可依次选端点按Enter")}</title>
      </circle>) : null;
    }
    return {
        bindings,
        handle,
        preview: source && point ? (<path d={`M${source.x},${source.y}H${(source.x+point.x)/2}V${point.y}H${point.x}`} fill="none" stroke="#008b72" strokeWidth="2" strokeDasharray="5 3" pointerEvents="none"/>) : null,
    };
}
export function EventNetwork({ data, onLink, canWrite, onSelect, onRelation, scale = 14, }: {
    data: any;
    onLink: (s: PlanAnchor, t: PlanAnchor) => void;
    canWrite: boolean;
    onSelect: (id: string) => void;
    onRelation: (a: any, d: any) => void;
    scale?: number;
}) {
    const drag = usePlanDrag(onLink), width = Math.max(900, data.duration * scale + 180), height = Math.max(300, data.activities.length * 78 + 110), x = (offset: number) => 90 + offset * scale, positions = new Map<string, number>(data.activities.map((a: any, i: number) => [a.id, 90 + i * 78]));
    return (<>
      <p className="help">{__ui("每项作业以起点、终点事件及工作箭线表示；虚线为事件间约束，标签标明关系及工作日间隔。拖拽端点建立关系，点击虚线编辑或解除；SS/FF/SF为广义约束，不作为零工期虚工作。")}</p>
      <div className="network-scroll">
        <svg aria-label={__ui("双代号时标网络图")} role="img" width={width} height={height} {...drag.bindings}>
          <defs>
            <marker id="event-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8" fill="#008b72"/>
            </marker>
          </defs>
          {__ui(Array.from({ length: Math.ceil((width - 90) / 98) }, (_, i) => (<g key={i}>
              <line x1={x(i * 7)} x2={x(i * 7)} y1="40" y2={height} stroke="#e5edf3"/>
              <text x={x(i * 7)} y="28" className="svg-caption">{__ui("第")}{__ui(i * 7)}{__ui("天")}</text>
            </g>)))}
          {__ui(data.activities.map((a: any, i: number) => {
            const y = positions.get(a.id)!;
            return (<g key={a.id} onClick={() => onSelect(a.id)}>
                <text x="10" y={y - 25}>
                  {__ui(a.code)}
                </text>
                <text x={x(a.es)} y={y - 22}>
                  {a.name} · {__ui(a.duration)}{__ui("工作日")}</text>
                <line x1={x(a.es)} x2={x(a.ef)} y1={y} y2={y} stroke={a.critical ? "#ef888d" : "#008b72"} strokeWidth="3" markerEnd="url(#event-arrow)"/>
                {__ui([
                    ["S", a.es, i * 2 + 1],
                    ["F", a.ef, i * 2 + 2],
                ].map(([edge, offset, num]) => (<g key={edge}>
                    <circle cx={x(Number(offset)) +
                        (a.duration === 0 ? (edge === "S" ? -10 : 10) : 0)} cy={y} r="15" fill="white" stroke="#008b72"/>
                    <text x={x(Number(offset)) +
                        (a.duration === 0 ? (edge === "S" ? -10 : 10) : 0)} y={y + 4} textAnchor="middle">
                      {__ui(num)}
                    </text>
                  </g>)))}
              </g>);
        }))}
          {__ui(data.activities.flatMap((a: any) => a.predecessors.map((d: any) => {
            const p = data.activities.find((n: any) => n.id === d.id);
            if (!p)
                return null;
            const from = x(d.type[0] === "S" ? p.es : p.ef), to = x(d.type[1] === "S" ? a.es : a.ef), y1 = positions.get(p.id)!, y2 = positions.get(a.id)!;
            return (<g key={a.id + d.id} role={canWrite ? "button" : undefined} tabIndex={canWrite ? 0 : undefined} aria-label={__uiFormat("逻辑关系 {0} 到 {1}", [p.code, a.code])} onClick={() => canWrite && onRelation(a, d)} onKeyDown={(e) => {
                    if (canWrite && e.key === "Enter")
                        onRelation(a, d);
                }} className="plan-dependency">
                  <path d={`M${from},${y1} H${from + 24} V${y2 - 18} H${to} V${y2}`} fill="none" stroke="transparent" strokeWidth="12"/>
                  <path d={`M${from},${y1} H${from + 24} V${y2 - 18} H${to} V${y2}`} fill="none" stroke="#8ba0b1" strokeDasharray="5 3" markerEnd="url(#event-arrow)"/>
                  <text x={from + 28} y={(y1 + y2) / 2} className="svg-caption">
                    {__ui(d.type)}
                    {__ui(d.lag ? ` ${d.lag > 0 ? "+" : ""}${d.lag}工作日` : "")}
                  </text>
                </g>);
        })))}
          {__ui(data.activities.flatMap((a: any) => {
            const y = positions.get(a.id)!;
            return [
                drag.handle(a, "S", x(a.es) + (a.duration === 0 ? -10 : 0), y + 21, canWrite),
                drag.handle(a, "F", x(a.ef) + (a.duration === 0 ? 10 : 0), y + 21, canWrite),
            ];
        }))}
          {__ui(drag.preview)}
        </svg>
      </div>
    </>);
}
