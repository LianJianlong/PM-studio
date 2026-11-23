import {AIReferenceLabels} from '../shared/ai-reference-labels';
import {
  planningTableLabel,
  ambiguousPlanningName,
} from "../shared/planning-table-identity";
import { useEffect, useRef, useState, useMemo } from "react";
import { api } from "./lib";
import { translateUiValue as ui } from "./i18n";
type Node = {
  id: string;
  name: string;
  kind: string;
  path?: string;
  children?: Node[];
  page?: number;
  readonly?: boolean;
};
export default function AIMentionInput({
  project,
  value,
  onChange,
  disabled,
  onSend,
}: {
  project: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  onSend: () => void;
}) {
  const references=useMemo(()=>new AIReferenceLabels(),[project]);
  const displayValue=references.display(value);
  function updateValue(text:string){
    const expanded=references.expand(text);
    if(expanded.length>12000){setError(ui("引用后内容超过12000字符"));return;}
    onChange(expanded);
  }
  const input = useRef<HTMLTextAreaElement>(null),
    composing = useRef(false),
    sequence = useRef(0);
  const [start, setStart] = useState<number | null>(null),
    [end, setEnd] = useState(0),
    [trail, setTrail] = useState<Node[]>([]),
    [items, setItems] = useState<Node[]>([]),
    [selected, setSelected] = useState(0),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const root = (): Node[] => [
    { id: "data", name: ui("数据录入"), kind: "data" },
    { id: "departments", name: ui("部门工作台"), kind: "data" },
    {
      id: "plan",
      name: ui("计划管理"),
      kind: "planning",
    },
  ];
  useEffect(() => {
    sequence.current++;
    setStart(null);
    setTrail([]);
    setItems([]);
  }, [project]);
  async function load(node?: Node) {
    const token = ++sequence.current;
    setLoading(true);
    setError("");
    setQuery("");
    setSelected(0);
    try {
      let list: Node[] = [];
      const base = `/projects/${project}`;
      if (!node) {
        setItems(root());
        const results = await Promise.allSettled([
          api(base + "/tables"),
          api(base + "/public"),
        ]);
        const ordinary =
          results[0].status === "fulfilled" ? results[0].value : [];
        const publicTables =
          results[1].status === "fulfilled" ? results[1].value.tables : [];
        const unique = new Map(
          [...publicTables, ...ordinary].map((t: any) => [t.id, t]),
        );
        list = [...root(), ...Array.from(unique.values()).map(tableNode)];
      } else if (node.kind === "planning") {
        list = await api(base + "/ai/planning-catalog");
      } else if (node.children) list = node.children;
      else if (node.kind === "data") {
        const [tables, context, pub] = await Promise.all([
          api(base + "/tables"),
          api(base + "/context"),
          api(base + "/public"),
        ]);
        const all: any[] = Array.from(
          new Map(
            [...pub.tables, ...tables].map((t: any) => [t.id, t]),
          ).values(),
        );
        list = [
          ...context.departments.map((d: any) => ({
            id: d.id,
            name: d.name,
            kind: "group",
            children: all
              .filter((t: any) => t.department_id === d.id)
              .map(tableNode),
          })),
          {
            id: "public",
            name: "public",
            kind: "group",
            children: all.filter((t: any) => !t.department_id).map(tableNode),
          },
        ].filter((n) => n.children.length);
      } else if (node.kind === "dataset") {
        const r = await api(node.path!);
        list = r.rows.map((row:any)=>({id:row.id,name:rowName(row),kind:"native_row",path:node.path}));
      } else if (node.kind === "table" || node.kind === "page") {
        const page = node.page || 1,
          r = await api(`${node.path}?page=${page}`);
        list = r.rows.map((r: any) => ({
          id: r.id,
          name: rowName(r),
          kind: "leaf",
          path: node.path,
        }));
        if (page * (r.pageSize || 50) < Number(r.total))
          list.push({
            ...node,
            id: `page-${page + 1}`,
            name: ui("下一页"),
            kind: "page",
            page: page + 1,
          });
      }
      if (token === sequence.current) setItems(list);
    } catch (e) {
      if (token === sequence.current) {
        setItems([]);
        setError((e as Error).message);
      }
    } finally {
      if (token === sequence.current) setLoading(false);
    }
  }
  function tableNode(t: any): Node {
    return {
      id: t.id,
      name: t.planning_kind
        ? `${t.name}（${ui(planningTableLabel(t.planning_kind))}）`
        : ambiguousPlanningName(t.name)
          ? `${t.name}（${ui("普通表，非计划绑定")}）`
          : t.name,
      kind: "table",
      path: `/tables/${t.id}/records`,
    };
  }
  function rowName(r: any) {
    const cells = r.values || r.data || {};
    return `${
      (cells.name ? [cells.name] : Object.entries(cells).filter(([k])=>!/(?:^id$|_id$|^version$|^code$)/i.test(k)).map(([,v])=>v))
        .filter((v) => typeof v === "string" || typeof v === "number")
        .slice(0, 2)
        .join(" · ")
        .slice(0, 100) || ui("记录")
    }`;
  }
  const visible = items.filter((n) =>
    n.name.toLowerCase().includes(query.toLowerCase()),
  );
  function insert(node?: Node) {
    if (start === null) return;
    const nodes = [...trail, ...(node ? [node] : [])];
    if (!nodes.length) return;
    const rawRef = `@[${nodes.map((n) => n.name).join(" / ")}](project:${project};${nodes.map((n) => `${n.kind}:${n.id}`).join(";")})`;
    const ref = references.display(rawRef)+" ";
    const next = displayValue.slice(0, start) + ref + displayValue.slice(end);
    if (next.length > 12000) {
      setError(ui("引用后内容超过12000字符"));
      return;
    }
    updateValue(next);
    setStart(null);
    sequence.current++;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + ref.length, start + ref.length);
    });
  }
  function resetFilter() {
    let position = end;
    if (start !== null && query) {
      updateValue(displayValue.slice(0, start + 1) + displayValue.slice(end));
      position = start + 1;
      setEnd(position);
      setQuery("");
    }
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(position, position);
    });
  }
  useEffect(() => {
    if (start !== null)
      document
        .getElementById(`ai-mention-${selected}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [selected, start]);
  function choose(n: Node, finish = false) {
    if (n.kind === "planning_table") {
      const token = ++sequence.current;
      setLoading(true);
      void api(`/projects/${project}/planning-tables/${n.id}`)
        .then((r) => {
          if (token !== sequence.current) return;
          if (!r.table) throw Error(ui("计划管理尚未绑定该表"));
          setLoading(false);
          choose(tableNode({ ...r.table, planning_kind: n.id }), finish);
        })
        .catch((e) => {
          if (token === sequence.current) {
            setLoading(false);
            setError(e.message);
          }
        });
      return;
    }
    if (n.page) {
      resetFilter();
      void load(n);
      return;
    }
    if (finish || n.kind === "leaf" || n.kind === "native_row") {
      insert(n);
      return;
    }
    resetFilter();
    setTrail((v) => [...v, n]);
    void load(n);
  }
  return (
    <div className="ai-mention-compose">
      <textarea
        ref={input}
        aria-label={ui("AI指令")}
        aria-expanded={start !== null}
        aria-controls={start !== null ? "ai-mention-list" : undefined}
        aria-activedescendant={
          start !== null && visible[selected]
            ? `ai-mention-${selected}`
            : undefined
        }
        value={displayValue}
        disabled={disabled}
        maxLength={12000}
        rows={3}
        placeholder={ui("输入 @ 选择模块、表或行")}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onChange={(e) => {
          const text = e.target.value,
            pos = e.target.selectionStart;
          updateValue(text);
          if (start !== null) {
            if (pos <= start || text[start] !== "@") {
              setStart(null);
              sequence.current++;
              return;
            }
            setEnd(pos);
            setQuery(text.slice(start + 1, pos));
            setSelected(0);
          } else if (pos > 0 && text[pos - 1] === "@") {
            setStart(pos - 1);
            setEnd(pos);
            setTrail([]);
            void load();
          }
        }}
        onKeyDown={(e) => {
          if (
            composing.current ||
            e.nativeEvent.isComposing ||
            e.nativeEvent.keyCode === 229
          )
            return;
          if (start !== null) {
            if (e.key === "Escape") {
              e.preventDefault();
              setStart(null);
              sequence.current++;
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) =>
                Math.max(
                  0,
                  Math.min(
                    visible.length - 1,
                    i + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (!e.repeat && !loading) {
                if (visible[selected]) choose(visible[selected], e.shiftKey);
                else if (e.shiftKey) insert();
              }
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!e.repeat) onSend();
          }
        }}
      />
      {start !== null && (
        <div className="ai-mention-picker">
          <div className="heading-actions">
            <button
              type="button"
              onClick={() => {
                resetFilter();
                const next = trail.slice(0, -1);
                setTrail(next);
                void load(next.at(-1));
              }}
              disabled={!trail.length || loading}
            >
              {ui("上一级")}
            </button>
            <strong>
              {[ui("选择引用"), ...trail.map((n) => n.name)].join(" / ")}
            </strong>
            <button
              type="button"
              onClick={() => {
                setStart(null);
                sequence.current++;
              }}
            >
              {ui("关闭")}
            </button>
          </div>
          <p className="help">
            {ui("Enter 进入下一级 · Shift+Enter 插入引用 · ↑↓ 选择 · Esc 关闭")}
          </p>
          {error && <p role="alert">{error}</p>}
          {loading ? (
            <p>{ui("加载中…")}</p>
          ) : (
            <div
              id="ai-mention-list"
              role="listbox"
              aria-label={ui("选择引用")}
            >
              {visible.map((n, i) => (
                <button
                  id={`ai-mention-${i}`}
                  key={`${n.kind}:${n.id}`}
                  role="option"
                  aria-selected={i === selected}
                  type="button"
                  className={i === selected ? "active" : ""}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => choose(n)}
                >
                  {n.name}{n.readonly ? `（${ui("只读")}）` : ""}
                  {!["leaf","native_row"].includes(n.kind) ? " ›" : ""}
                </button>
              ))}
              {!visible.length && (
                <p>
                  {ui("没有可选项，可返回上一级或 Shift+Enter 引用当前层级")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
