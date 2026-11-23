import NetworkTaskDialog from './NetworkTaskDialog';
import {scheduleNetwork} from '../server/network-schedule';
import { formatUiTemplate as __uiFormat } from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useState, useEffect, useRef } from "react";
import { Plus, Settings } from "lucide-react";
import {
  api,
  useApi,
  useApp,
  Modal,
  Form,
  Field,
  Loading,
  ErrorBox,
  Empty,
  Confirm,
} from "./lib";
import { type PlanAnchor } from "./PlanDrag";
import AoaNetwork, { type NetworkDraw } from "./AoaNetwork";
import { nearestTaskLane, type TaskBox } from "../shared/network-routing";
import { buildAoaNetwork } from "../shared/aoa-network";
import { relationInterval } from "../shared/plan-relations";
import "./network-editor.css";
const levels = ["总控计划", "阶段计划", "分部计划", "详细计划"];
export default function NetworkEditor() {
  const { project, tick, reload, notify } = useApp(),
    base = `/projects/${project.id}/network-plans`;
  const { data: list, error: listError } = useApi<any>(base, tick);
  const [selected, setSelected] = useState(
      () => localStorage.getItem("studio-network:" + project.id) || "",
    ),
    [node, setNode] = useState(""),
    [dialog, setDialog] = useState<any>(null),
    [zoom, setZoom] = useState(28),
    [importError, setImportError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null),
    initializing = useRef(false);
  const planId = list?.plans?.some((p: any) => p.id === selected)
    ? selected
    : list?.plans?.[0]?.id;
  useEffect(() => {
    if (selected)
      localStorage.setItem("studio-network:" + project.id, selected);
  }, [selected, project.id]);
  useEffect(() => {
    if (!list?.can_manage || list.plans.length || initializing.current) return;
    initializing.current = true;
    api(base, "POST", {
      name: project.name.slice(0, 110) + "网络图",
      granularity: "详细计划",
      start_date:
        project.start_date?.slice(0, 10) ||
        new Date().toISOString().slice(0, 10),
      source: "gantt",
    })
      .then((result) => {
        setSelected(result.id);
        reload();
      })
      .catch((error) => {
        setImportError(error.message);
      });
  }, [list, base, project.name, project.start_date, reload]);
  const { data, error, loading } = useApi<any>(
    planId ? `${base}/${planId}` : null,
    tick,
  );
  const plan = data?.plan,
    raw = plan?.activities || [],
    current = raw.find((a: any) => a.id === node);
  async function save(activities: any[], metadata: any = {}) {
    await api(`${base}/${plan.id}`, "PUT", {
      version: plan.version,
      document: {
        name: plan.name,
        decisions: (plan.decisions || []).filter((d: any) =>
          d.branches.every((id: string) => activities.some((a) => a.id === id)),
        ),
        granularity: plan.granularity,
        start_date: plan.start_date,
        swimlanes:plan.swimlanes||[],
        diagram_layout: plan.diagram_layout || {},
        calendar_config: plan.calendar_config,
        activities,
        ...metadata,
      },
    });
    setDialog(null);
    reload();
    notify("网络图已保存");
  }
  function relation(source: PlanAnchor, target: PlanAnchor) {
    const successor = raw.find((a: any) => a.id === target.id);
    const existing = successor?.predecessors.find(
      (d: any) => d.id === source.id,
    );
    setDialog({
      kind: "relation",
      predecessor: source.id,
      successor: target.id,
      type: existing?.type || source.edge + target.edge,
      lag: existing?.lag || 0,
    });
  }
  function exportPlan() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "project-studio-network-plan",
              version: 1,
              name: plan.name,
              decisions: plan.decisions || [],
              granularity: plan.granularity,
              start_date: plan.start_date,
              swimlanes:plan.swimlanes||[],
              diagram_layout: plan.diagram_layout,
              calendar_config: data.calendar_config,
              activities: raw,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${plan.name.replace(/[\\/:*?"<>|]/g, "_")}.dm`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function drawTask(v: NetworkDraw) {
    const graph = buildAoaNetwork(
        data.activities,
        data.duration,
        plan.diagram_layout,
      ),
      byId = new Map(graph.arrows.map((a) => [a.id, a]));
    const eventId = (id: string) =>
      id.startsWith("event:") ? id.slice(6) : id;
    const normalized = raw.map((a: any) => ({
      ...a,
      event_start_id: eventId(byId.get(a.id)!.start),
      event_finish_id: eventId(byId.get(a.id)!.finish),
    }));
    const source = v.source ? eventId(v.source.id) : crypto.randomUUID(),
      target = v.target ? eventId(v.target.id) : crypto.randomUUID();
    if (
      v.type !== "task" &&
      normalized.some((a: any) => a.event_start_id === source)
    )
      throw Error("请选择没有后续任务的事件，或在空白处新建决策");
    if ((plan.decisions || []).some((d: any) => d.id === source))
      throw Error("决策节点只能有两个任务，请编辑现有分支");
    const predecessors = normalized
      .filter((a: any) => a.event_finish_id === source)
      .map((a: any) => ({ id: a.id, type: "FS", lag: 0 }));
    const count = v.type === "task" ? 1 : 2,
      created = Array.from({ length: count }, (_, i) => {
        let n = raw.length + i + 1;
        while (raw.some((a: any) => a.code === "N" + n)) n += count;
        return {
          id: crypto.randomUUID(),
          code: "N" + n,
          name: __ui(
            v.type === "task" ? "新任务" : i === 0 ? "分支一" : "分支二",
          ),
          duration: v.duration,
          progress: 0,
          start_offset: v.type==='task'?0:predecessors.length ? 0 : v.offset,
          event_start_id: source,
          event_finish_id: target,
          predecessors,
        };
      });
    const targetWork = normalized.map((a: any) =>
      a.event_start_id !== target
        ? a
        : {
            ...a,
            predecessors: [
              ...a.predecessors,
              ...created.map((b) => ({ id: b.id, type: "FS", lag: 0 })),
            ],
          },
    );
    const decisions = [
      ...(plan.decisions || []),
      ...(v.type === "task"
        ? []
        : [
            {
              id: source,
              type: v.type,
              label: __ui(v.type === "event" ? "事件决策" : "随机决策"),
              branches: created.map((a) => a.id),
              selected:
                created[
                  v.type === "random" &&
                  crypto.getRandomValues(new Uint32Array(1))[0] % 2
                    ? 1
                    : 0
                ].id,
              probability: 50,
            },
          ]),
    ];
    const occupied: TaskBox[] = data.activities.map(
      (a: any, index: number) => ({
        start: a.es,
        finish: a.ef,
        lane: (()=>{const arrow=byId.get(a.id)!;const parallel=graph.arrows.filter(v=>v.start===arrow.start&&v.finish===arrow.finish).length>1;
          return parallel ? plan.diagram_layout?.["task:"+a.id]??index : graph.events.find(e=>e.id===arrow.finish)!.lane;})(),
      }),
    );
    const lanes = created.map(() => {
      const lane = nearestTaskLane(v.finishLane, v.startTime, v.finishTime, occupied);
      occupied.push({ start: v.startTime, finish: v.finishTime, lane });
      return lane;
    });
    const shift = lanes[0] - v.finishLane;
    const metadata={
      decisions,
      diagram_layout: {
        ...plan.diagram_layout,
        ...Object.fromEntries(
          graph.events.map((e) => [
            "event:" + eventId(e.id),
            plan.diagram_layout?.[e.id] ?? e.lane,
          ]),
        ),
        ...(!v.source ? { ["event:" + source]: v.lane + shift } : {}),
        ...(!v.target ? { ["event:" + target]: v.finishLane + shift } : {}),
        ...Object.fromEntries(
          created.map((a, i) => ["task:" + a.id, lanes[i]]),
        ),
      },
    };
    if(v.type==='task'){setDialog({kind:'node',value:created[0],isNew:true,base_version:plan.version,draw:{activities:targetWork,metadata,desiredLane:v.finishLane,sourceNew:!v.source,targetNew:!v.target,sourceLane:v.lane,source,target,occupied}});return;}
    await save([...targetWork,...created],metadata);
  }
  async function openFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setImportError("");
      if (file.size > 2000000) throw Error("图纸文件不得超过2MB");
      const result = await api(
        `/projects/${project.id}/network-import`,
        "POST",
        JSON.parse(await file.text()),
      );
      setSelected(result.id);
      reload();
      notify("网络图已打开");
    } catch (error) {
      setImportError((error as Error).message);
    }
    e.target.value = "";
  }

  return (
    <section
      className="network-editor"
      aria-label={__ui("双代号时标网络图编辑器")}
    >
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".dm,.dgm,.json"
        aria-label={__ui("打开网络图文件")}
        onChange={openFile}
      />
      <div className="network-plan-toolbar network-file-toolbar">
        <strong>{project.name}</strong>
        {!!list?.plans.length && (
          <label>
            {__ui("图纸")}
            <select
              aria-label={__ui("选择网络图")}
              value={planId || ""}
              onChange={(e) => {
                setSelected(e.target.value);
                setNode("");
              }}
            >
              {list.plans.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {list?.can_manage && (
          <button
            onClick={() => setDialog({ kind: "settings" })}
            disabled={!plan}
          >
            <Settings size={16} />
            {__ui("图纸设置")}
          </button>
        )}
      </div>
      {importError && <ErrorBox message={importError} />}
      {__ui(
        listError || error ? (
          <ErrorBox message={__ui(listError || error)} />
        ) : !list || (!data && loading) ? (
          <Loading />
        ) : !plan ? (
          <Empty text={__ui("暂无可编辑网络图")} />
        ) : (
          <>
            {
              <AoaNetwork
                key={plan.id}
                data={{ ...data, project_name: project.name }}
                onSwimlanesSave={lanes=>save(raw,{swimlanes:lanes})}
                onSaveAs={exportPlan}
                onOpen={
                  data.can_manage ? () => fileInput.current?.click() : undefined
                }
                onNew={
                  data.can_manage
                    ? () => setDialog({ kind: "create", source: "blank" })
                    : undefined
                }
                scale={zoom}
                canWrite={data.can_write}
                onSelect={(id) => {
                  setNode(id);
                  if (data.can_write)
                    setDialog({
                      kind: "node",
                      base_version:plan.version,
                      value: raw.find((a: any) => a.id === id),
                    });
                }}
                onDelete={(id) => {
                  const task = raw.find((a: any) => a.id === id);
                  if (data.can_write && task)
                    setDialog({ kind: "delete-node", value: task });
                }}
                onCreate={drawTask}
                onDecision={(id) =>
                  setDialog({
                    kind: "decision",
                    value: (plan.decisions || []).find((d: any) => d.id === id),
                  })
                }
                onLink={relation}
                onRelation={(a: any, d: any) =>
                  setDialog({
                    kind: "relation",
                    predecessor: d.id,
                    successor: a.id,
                    type: d.type,
                    lag: d.lag,
                    existing: true,
                  })
                }
                onLayout={(layout) => save(raw, { diagram_layout: layout })}
              />
            }

            <details className="panel network-work-list">
              <summary>
                {__ui("网络计划作业与逻辑关系（")}
                {__ui(raw.length)}）
              </summary>
              <div className="grid-scroll">
                <table className="data-grid">
                  <thead>
                    <tr>
                      <th>{__ui("作业编码")}</th>
                      <th>{__ui("作业名称")}</th>
                      <th>{__ui("工期（工作日）")}</th>
                      <th>{__ui("前置关系")}</th>
                      <th>{__ui("操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {__ui(
                      raw.map((a: any) => (
                        <tr key={a.id} onClick={() => setNode(a.id)}>
                          <td>{__ui(a.code)}</td>
                          <td>{a.name}</td>
                          <td>{__ui(a.duration)}</td>
                          <td>
                            {__ui(
                              a.predecessors
                                .map(
                                  (d: any) =>
                                    `${raw.find((p: any) => p.id === d.id)?.code} ${d.type} ${d.lag >= 0 ? "+" : ""}${d.lag}`,
                                )
                                .join("；") || "—",
                            )}
                          </td>
                          <td>
                            {__ui(
                              data.can_write && (
                                <>
                                  <button
                                    onClick={() =>
                                      setDialog({ kind: "node", value: a })
                                    }
                                  >
                                    {__ui("编辑")}
                                  </button>
                                  <button
                                    className="danger"
                                    onClick={() =>
                                      setDialog({
                                        kind: "delete-node",
                                        value: a,
                                      })
                                    }
                                  >
                                    {__ui("删除")}
                                  </button>
                                </>
                              ),
                            )}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ),
      )}
      {__ui(
        dialog?.kind === "create" && (
          <Modal title={__ui("新建网络图")} onClose={() => setDialog(null)}>
            <Form
              onClose={() => setDialog(null)}
              onSubmit={async (d) => {
                const result = await api(base, "POST", {
                  name: d.get("name"),
                  granularity: d.get("granularity"),
                  start_date: d.get("start_date"),
                  source: dialog.source,
                  ...(dialog.source === "network"
                    ? { source_id: plan.id }
                    : {}),
                });
                setSelected(result.id);
                setNode("");
                setDialog(null);
                reload();
                notify("网络图已创建");
              }}
            >
              <MetadataFields
                name={
                  dialog.source === "blank"
                    ? ""
                    : `${dialog.source === "gantt" ? "横道图" : plan?.name}副本`
                }
                start={plan?.start_date || project.start_date?.slice(0, 10)}
                level="总控计划"
              />
              <p className="help">
                {__ui("来源：")}
                {__ui(
                  dialog.source === "blank"
                    ? "空白计划"
                    : dialog.source === "gantt"
                      ? "横道图的一次性副本"
                      : "当前网络图副本",
                )}
                {__ui("。复制后各自维护。")}
              </p>
            </Form>
          </Modal>
        ),
      )}
      {__ui(
        dialog?.kind === "settings" && plan && (
          <Modal title={__ui("网络图设置")} onClose={() => setDialog(null)}>
            <Form
              onClose={() => setDialog(null)}
              onSubmit={async (d) =>
                save(raw, {
                  name: d.get("name"),
                  granularity: d.get("granularity"),
                  start_date: d.get("start_date"),
                })
              }
            >
              <MetadataFields
                name={plan.name}
                start={plan.start_date}
                level={plan.granularity}
              />
            </Form>
          </Modal>
        ),
      )}
      {dialog?.kind==='node'&&plan&&<NetworkTaskDialog key={dialog.value?.id||'new-task'} value={dialog.value||{id:crypto.randomUUID(),code:'N'+(raw.length+1),name:'',duration:1,progress:0,predecessors:[]}} activities={dialog.draw?.activities||raw} calendar={data.calendar_config} start={plan.start_date} decisions={dialog.draw?.metadata.decisions||plan.decisions||[]} isNew={!!dialog.isNew||!dialog.value} onClose={()=>setDialog(null)} onSave={async value=>{
        if(dialog.base_version&&dialog.base_version!==plan.version)throw Error(__ui('网络图已变化，请重新拖拽或打开任务'));
        if(dialog.draw){const d=dialog.draw,items=[...d.activities,value],calculated=scheduleNetwork(items,d.metadata.decisions,data.calendar_config,plan.start_date),task=calculated.activities.find(a=>a.id===value.id)!,lane=nearestTaskLane(d.desiredLane,task.es,task.ef,d.occupied),shift=lane-d.desiredLane;await save(items,{...d.metadata,diagram_layout:{...d.metadata.diagram_layout,['task:'+value.id]:lane,...(d.sourceNew?{['event:'+d.source]:d.sourceLane+shift}:{}),...(d.targetNew?{['event:'+d.target]:lane}:{})}})}else await save(raw.some((a:any)=>a.id===value.id)?raw.map((a:any)=>a.id===value.id?value:a):[...raw,value]);setNode(value.id);
      }}/>}

      {dialog?.kind === "decision" && (
        <Modal title={__ui("决策节点设置")} onClose={() => setDialog(null)}>
          <Form
            onClose={() => setDialog(null)}
            onSubmit={async (d) => {
              const probability = Number(d.get("probability")),
                random = d.get("type") === "random" && d.get("randomize");
              const selected = random
                ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 <
                  probability / 100
                  ? dialog.value.branches[0]
                  : dialog.value.branches[1]
                : String(d.get("selected"));
              await save(raw, {
                decisions: (plan.decisions || []).map((v: any) =>
                  v.id !== dialog.value.id
                    ? v
                    : {
                        ...v,
                        label: String(d.get("label")),
                        type: d.get("type"),
                        probability,
                        selected,
                      },
                ),
              });
            }}
          >
            <Field label={__ui("节点名称")}>
              <input
                name="label"
                required
                defaultValue={dialog.value.label}
                disabled={!data.can_write}
              />
            </Field>
            <Field label={__ui("决策类型")}>
              <select
                name="type"
                defaultValue={dialog.value.type}
                disabled={!data.can_write}
              >
                <option value="event">{__ui("事件决策")}</option>
                <option value="random">{__ui("随机决策")}</option>
              </select>
            </Field>
            <Field label={__ui("激活分支（二选一）")}>
              <select
                name="selected"
                defaultValue={dialog.value.selected}
                disabled={!data.can_write}
              >
                {dialog.value.branches.map((id: string) => (
                  <option key={id} value={id}>
                    {raw.find((a: any) => a.id === id)?.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={__ui("分支一概率（%），分支二为剩余概率")}>
              <input
                name="probability"
                type="number"
                min="0"
                max="100"
                step="any"
                required
                defaultValue={dialog.value.probability}
                disabled={!data.can_write}
              />
            </Field>
            {data.can_write && (
              <label>
                <input name="randomize" type="checkbox" />
                {__ui("按概率重新抽取并保存结果")}
              </label>
            )}
            <p className="help">
              {__ui(
                "事件决策手动选择分支；随机决策勾选抽取。始终只有一个分支参与总工期与关键路线，刷新不会改变结果。",
              )}
            </p>
          </Form>
        </Modal>
      )}
      {__ui(
        dialog?.kind === "relation" && plan && (
          <Modal title={__ui("网络图逻辑关系")} onClose={() => setDialog(null)}>
            <Form
              onClose={() => setDialog(null)}
              onSubmit={async (d) => {
                const predecessor = String(d.get("predecessor")),
                  successor = String(d.get("successor"));
                if (predecessor === successor) throw Error("作业不能关联自身");
                const deps = {
                  id: predecessor,
                  type: String(d.get("type")),
                  lag: relationInterval(
                    String(d.get("interval")),
                    Number(d.get("days")),
                  ),
                };
                await save(
                  raw.map((a: any) =>
                    a.id !== successor
                      ? a
                      : {
                          ...a,
                          predecessors: [
                            ...a.predecessors.filter(
                              (p: any) => p.id !== predecessor,
                            ),
                            ...(d.get("remove") ? [] : [deps]),
                          ],
                        },
                  ),
                );
              }}
            >
              <Field label={__ui("前置作业")}>
                <select
                  aria-label={__ui("网络前置作业")}
                  name="predecessor"
                  defaultValue={dialog.predecessor}
                  disabled={dialog.existing}
                >
                  {__ui(
                    raw.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {__ui(a.code)} · {a.name}
                      </option>
                    )),
                  )}
                </select>
              </Field>
              {__ui(
                dialog.existing && (
                  <input
                    name="predecessor"
                    type="hidden"
                    value={dialog.predecessor}
                  />
                ),
              )}
              <Field label={__ui("后置作业")}>
                <select
                  aria-label={__ui("网络后置作业")}
                  name="successor"
                  defaultValue={dialog.successor}
                  disabled={dialog.existing}
                >
                  {__ui(
                    raw.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {__ui(a.code)} · {a.name}
                      </option>
                    )),
                  )}
                </select>
              </Field>
              {__ui(
                dialog.existing && (
                  <input
                    name="successor"
                    type="hidden"
                    value={dialog.successor}
                  />
                ),
              )}
              <Field label={__ui("关系类型")}>
                <select
                  name="type"
                  aria-label={__ui("网络关系类型")}
                  defaultValue={dialog.type}
                >
                  <option value="FS">{__ui("FS 完成→开始")}</option>
                  <option value="FF">{__ui("FF 完成→完成")}</option>
                  <option value="SS">{__ui("SS 开始→开始")}</option>
                  <option value="SF">{__ui("SF 开始→完成")}</option>
                </select>
              </Field>
              <Field label={__ui("提前／滞后")}>
                <select
                  name="interval"
                  aria-label={__ui("网络提前或滞后")}
                  defaultValue={dialog.lag < 0 ? "lead" : "lag"}
                >
                  <option value="lead">{__ui("提前")}</option>
                  <option value="lag">{__ui("滞后")}</option>
                </select>
              </Field>
              <Field label={__ui("天数")}>
                <input
                  name="days"
                  aria-label={__ui("网络间隔天数")}
                  type="number"
                  required
                  min={0}
                  max={3650}
                  step="any"
                  defaultValue={Math.abs(dialog.lag)}
                />
              </Field>
              {__ui(
                dialog.existing && (
                  <Field label={__ui("解除关系")}>
                    <input type="checkbox" name="remove" />
                  </Field>
                ),
              )}
            </Form>
          </Modal>
        ),
      )}
      {__ui(
        dialog?.kind === "delete" && plan && (
          <Confirm
            title={__ui("删除网络图")}
            detail={__uiFormat(
              "删除“{0}”，不会删除横道图作业及其他网络计划。",
              [plan.name],
            )}
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              await api(`${base}/${plan.id}`, "DELETE", {
                version: plan.version,
              });
              setSelected("");
              setNode("");
              setDialog(null);
              reload();
            }}
          />
        ),
      )}
      {__ui(
        dialog?.kind === "delete-node" && plan && (
          <Confirm
            title={__ui("删除任务")}
            detail={
              __uiFormat("删除“{0}”及其关联的逻辑关系。", [dialog.value.name]) +
              ((plan.decisions || []).some((d: any) =>
                d.branches.includes(dialog.value.id),
              )
                ? __ui("该任务属于决策节点；删除后，保留的分支将作为普通任务。")
                : "")
            }
            onClose={() => setDialog(null)}
            onConfirm={async () => {
              await save(
                raw
                  .filter((a: any) => a.id !== dialog.value.id)
                  .map((a: any) => ({
                    ...a,
                    predecessors: a.predecessors.filter(
                      (d: any) => d.id !== dialog.value.id,
                    ),
                  })),
              );
              setNode("");
            }}
          />
        ),
      )}
    </section>
  );
}
function MetadataFields({ name, start, level }: any) {
  return (
    <>
      <Field label={__ui("网络计划名称")}>
        <input
          aria-label={__ui("网络计划名称")}
          name="name"
          required
          maxLength={120}
          defaultValue={name}
        />
      </Field>
      <input type="hidden" name="granularity" value={level} />
      <Field label={__ui("计划开始日期")}>
        <input
          aria-label={__ui("网络计划开始日期")}
          name="start_date"
          type="date"
          required
          defaultValue={start}
        />
      </Field>
    </>
  );
}
