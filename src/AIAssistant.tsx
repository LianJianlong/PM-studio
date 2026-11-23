import AIClosureAnalysis from './AIClosureAnalysis';
import AIReadEvidence from './AIReadEvidence';
import AIWebSources from './AIWebSources';
import './ai-assistant.css';
import AIBusinessChecks,{BusinessCheckReport} from './AIBusinessChecks';
import AIImpactPath from './AIImpactPath';
import AIAnswer from './AIAnswer';
import AIObjectCatalog from './AIObjectCatalog';
import AIKeyFields from './AIKeyFields';
import {displayAIText} from '../shared/ai-reference-labels';
import { formatUiTemplate as __uiFormat } from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import { useEffect, useState, useId, useRef } from "react";
import { Bot, Settings, Send } from "lucide-react";
import {
  api,
  useApi,
  useApp,
  PageTitle,
  Field,
  Form,
  Modal,
  ErrorBox,
  Loading,
} from "./lib";
import AIMentionInput from "./AIMentionInput";
import AIChangePreview from "./AIChangePreview";
import AIReadTable from "./AIReadTable";
import { compactAIHistory, visibleAIAnswer } from "../shared/ai-context";
import { aiProviders } from "../shared/ai";
export default function AIAssistant() {
  const { workspace, project, tick, reload, notify } = useApp();
  const currentProject=useRef(project?.id);currentProject.current=project?.id;
  const shortcutHint = useId(),
    requestGeneration = useRef(0),sending=useRef(false),composeRef=useRef<HTMLFormElement>(null),messageListRef=useRef<HTMLDivElement>(null),followLatest=useRef(true);
  const state = useApi<any>(
    workspace ? `/workspaces/${workspace.id}/ai-configs` : null,
    tick,
  );
  const changes = useApi<any[]>(
    project ? `/projects/${project.id}/ai/changes` : null,
    tick,
  );
  const runs = useApi<any[]>(
    project ? `/projects/${project.id}/ai/runs` : null,
    tick,
  );
  const [webSearch,setWebSearch]=useState(false);
  const [closureOpen,setClosureOpen]=useState(false);
  const [objectCatalog,setObjectCatalog]=useState(false),[businessChecks,setBusinessChecks]=useState(false);
  const [confirmChange, setConfirmChange] = useState<any>(null);
  const [provider, setProvider] = useState(""),
    [prompt, setPrompt] = useState(""),
    [write, setWrite] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [messages, setMessages] = useState<any[]>([]),
    [settings, setSettings] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [testing, setTesting] = useState("");
  const [testingError,setTestingError]=useState("");
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(()=>{const list=messageListRef.current;if(list&&followLatest.current)list.scrollTop=list.scrollHeight;},[messages,busy]);
  const enabled = state.data?.configs.filter((c: any) => c.enabled) || [];
  useEffect(() => {
    requestGeneration.current++;
    setBusy(false);sending.current=false;
    setMessages([]);
    setPrompt("");
    setError("");
    setWrite(false);setWebSearch(false);
    setConfirmChange(null);
    setEdit(null);
    setSettings(false);
    setObjectCatalog(false);setBusinessChecks(false);setClosureOpen(false);
  }, [project?.id]);
  useEffect(() => {
    if (!enabled.some((c: any) => c.provider === provider))
      setProvider(enabled[0]?.provider || "");
  }, [state.data, provider]);
  async function send() {
    if (!project || busy || sending.current || !provider) return;
    const text = prompt.trim();
    if (!text) return;
    const generation = ++requestGeneration.current;
    sending.current=true;followLatest.current=true;setBusy(true);
    setError("");
    setPrompt("");
    setMessages((v) => [...v.slice(-5), { role: "user", text }]);
    try {
      const r = await api(`/projects/${project.id}/ai/chat`, "POST", {
        provider,
        prompt: text,
        allow_write: write,web_search:webSearch,
        history: compactAIHistory(
          messages.filter(m=>!["failed","error"].includes(m.outcome)).map((m) => ({ role: m.role, text: m.text })),
        ),
      });
      if (generation !== requestGeneration.current) return;
      setMessages((v) => [
        ...v.slice(-5),
        {
          role: "assistant",
          text: r.answer,web:r.web,
          trace: r.trace,evidence:r.evidence,
          stages: r.stages,
          outcome: r.outcome,
          run_id: r.run_id,
          datasets: r.datasets,
          visualizations: r.visualizations,
          rule_reports:r.rule_reports,closure_reports:r.closure_reports,
        },
      ]);
      if (r.proposals?.length) setConfirmChange(r.proposals[0]);
      reload();
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setError((e as Error).message);
      setPrompt(text);
      void changes.refresh().catch(()=>{});void runs.refresh().catch(()=>{});
      setMessages(v=>[...v.slice(-5),{role:"assistant",text:(e as Error).message,outcome:"error",retry_prompt:text}]);
    } finally {
      if (generation === requestGeneration.current) {
        setBusy(false);sending.current=false;
        setWrite(false);
      }
    }
  }
  if (state.loading && !state.data) return <Loading />;
  return (
    <>
      <PageTitle
        icon={Bot}
        title={__ui("AI 数据助手")}
        subtitle={__ui("查询、关联追踪与业务协同 · 每一步遵循当前账号权限")}
      >
        {__ui(
          state.data?.can_manage && (
            <button onClick={() => setSettings(true)}>
              <Settings size={16} />
              {__ui("模型服务配置")}
            </button>
          ),
        )}
      </PageTitle>
      {__ui(
        (error || state.error) && (
          <ErrorBox message={__ui(error || state.error)} />
        ),
      )}
      <section className="panel ai-assistant">
        <div className="ai-assistant-toolbar"><button type="button" onClick={()=>setClosureOpen(true)}>{__ui("业务闭环分析")}</button>{closureOpen&&<AIClosureAnalysis onClose={()=>setClosureOpen(false)}/>}<button type="button" onClick={()=>setObjectCatalog(true)}>{__ui("业务对象与全局表目录")}</button><button type="button" onClick={()=>setBusinessChecks(true)}>{__ui("业务规则检查")}</button>{businessChecks&&<AIBusinessChecks onClose={()=>setBusinessChecks(false)}/>}
      {objectCatalog&&<AIObjectCatalog onClose={()=>setObjectCatalog(false)}/>}
          <Field label={__ui("模型服务")}>
            <select
              aria-label={__ui("AI模型服务")}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={busy}
            >
              <option value="" disabled>
                {__ui("请选择已启用服务")}
              </option>
              {enabled.map((c: any) => (
                <option key={c.provider} value={c.provider}>
                  {aiProviders[c.provider as keyof typeof aiProviders]?.name} ·{" "}
                  {c.model}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="ai-scope-bar"><span>{workspace?.name} / {project?.name}</span><strong>{__ui(write?"本轮可拟定修改，仍需最终确认":"只读查询与分析")}</strong></div>
        <details className="ai-help"><summary>{__ui("操作与权限说明")}</summary><p className="help">
          {__ui(
            "读取授权表和字段 → 拟定数据草案 → 预览差异 → 确认写入。默认只读，所有操作遵循当前用户权限。",
          )}
        </p>
        {provider === "ollama" && (
          <p className="help">
            {__ui(
              "Ollama冷启动默认等待30分钟。名称含-cloud的模型会在云端处理本次指令及授权数据。",
            )}
          </p>
        )}
        </details>
        {!enabled.length && (
          <ErrorBox
            message={__ui("尚无启用的模型服务，请由空间管理员配置。")}
          />
        )}
        <div className="ai-message-list" ref={messageListRef} onScroll={e=>{const list=e.currentTarget;followLatest.current=list.scrollHeight-list.clientHeight-list.scrollTop<80}} aria-live="polite">
          {!messages.length && (
            <div className="empty-state">
              <strong>{__ui("选择表，说出你要完成的事")}</strong>
              <p>
                {__ui(
                  "例如：@WBS 补充完善工作范围；或创建采购跟踪表，包含设备、供应商、状态。AI会先读取现有内容，再生成待确认草案。",
                )}
              </p>
            </div>
          )}
          {!messages.length&&<div className="ai-quick-prompts">{["查询当前项目有哪些可读数据表","检查指定表的数据一致性","分析一条记录的关联与影响"].map(text=><button type="button" key={text} disabled={busy} onClick={()=>{setPrompt(__ui(text));composeRef.current?.querySelector("textarea")?.focus()}}>{__ui(text)}</button>)}</div>}
          {messages.map((m, i) => (
            <article key={i} className={"ai-message " + m.role}>
              <strong>
                {__ui(m.role === "user" ? "我" : "AI助手")}
                {m.outcome &&
                  " · " +
                    __ui(
                      (
                        {
                          review: "待确认",
                          answer: "查询完成",
                          blocked: "需要补充",
                          failed: "未写入",
                          error:"请求未完成",
                        } as any
                      )[m.outcome] || m.outcome,
                    )}
              </strong>
              <AIAnswer text={__ui(displayAIText(m.role === "assistant" ? visibleAIAnswer(m.text) : m.text))}/>{m.role==='assistant'&&<AIWebSources web={m.web}/>}
              <AIReadEvidence result={m} project={project!.id}/>
              {!!m.datasets?.length&&<details className="ai-source-tables"><summary>{__ui("已读取的数据表")} · {m.datasets.length}</summary>{m.datasets.map((t:any)=><AIReadTable key={t.id} table={t}/>)}</details>}
              {m.retry_prompt&&<button type="button" disabled={busy} onClick={()=>{setPrompt(m.retry_prompt);setWrite(false);composeRef.current?.querySelector("textarea")?.focus()}}>{__ui("恢复本次输入")}</button>}
            </article>
          ))}
          {busy && (
            <p>
              {__uiFormat(
                "正在处理，请稍候（{0} 秒）。",
                [elapsed],
              )}
            </p>
          )}
        </div>
        <form
          ref={composeRef}
          className="ai-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <AIMentionInput
            project={project.id}
            value={prompt}
            onChange={setPrompt}
            disabled={busy}
            onSend={() => {
              if (!busy && provider && prompt.trim()) void send();
            }}
          />
          <label><input type="checkbox" checked={webSearch} disabled={busy} onChange={e=>{setWebSearch(e.target.checked);if(e.target.checked)setWrite(false)}}/>{__ui('\u8054\u7f51\u641c\u7d22')}</label>
<label className="checkbox-label">
            <input
              type="checkbox"
              checked={write}
              disabled={busy}
              onChange={(e) => {setWrite(e.target.checked);if(e.target.checked)setWebSearch(false)}}
            />
            {__ui("允许本轮增删改（仍需确认）")}
          </label>
          <button
            className="primary"
            disabled={busy || !provider || !prompt.trim()}
          >
            <Send size={16} />
            {__ui(busy ? "处理中" : "发送")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setError("");
            }}
          >
            {__ui("清空对话")}
          </button>
        </form>
        <p id={shortcutHint} className="help">
          {__ui(
            "输入 @ 分级选择表或行；Enter 进入下一级，Shift+Enter 插入。聊天仅保留近期关键任务和结果。",
          )}
        </p>
      </section>
      {(changes.data || []).filter(
        (c) => c.status === "pending" && new Date(c.expires_at) > new Date(),
      ).length > 0 && (
        <section className="panel">
          <h3>{__ui("待确认草案")}</h3>
          {(changes.data || [])
            .filter(
              (c) =>
                c.status === "pending" && new Date(c.expires_at) > new Date(),
            )
            .map((c) => (
              <article key={c.id} className="ai-pending">
                <strong>{displayAIText(c.body?.summary || __ui("数据操作草案"))}</strong>
                <div className="heading-actions">
                  <button
                    className="primary"
                    disabled={!c.can_confirm}
                    onClick={() => setConfirmChange(c)}
                  >
                    {__ui("预览整个方案")}
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await api(
                          `/projects/${project.id}/ai/changes/${c.id}/cancel`,
                          "POST",
                          {},
                        );
                        reload();
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    {__ui("取消操作")}
                  </button>
                </div>
              </article>
            ))}
        </section>
      )}
      <section className="panel">
        <details>
          <summary>{__ui("关键操作记录")}</summary>
          {runs.error && <ErrorBox message={runs.error} />}{" "}
          {!runs.data?.length && <p>{__ui("暂无操作记录")}</p>}
          {(runs.data || []).map((r) => (
            <article key={r.id} className="ai-pending">
              <strong>
                {__ui(
                  (
                    {
                      review: "待确认",
                      written: "已写入",
                      answer: "查询完成",
                      blocked: "需要补充",
                      failed: "执行失败，请查看结果",
                      unknown: "结果待核实",
                      cancelled: "已取消",
                      expired: "已过期，未写入",
                      reading: "读取中",
                      drafting: "拟定中",
                    } as any
                  )[r.status] || r.status,
                )}
              </strong>
              <time>{new Date(r.created_at).toLocaleString()}</time>
              <p>{__ui(displayAIText(r.summary || ""))}</p>{r.detail&&<div className="help">{r.detail.rolled_back&&<p>{__ui("执行失败，整批已回滚")}</p>}{r.detail.unknown&&<p>{__ui("结果仍待核实，请勿新建重复操作")}</p>}{r.detail.failed_step&&<p>{__ui("失败步骤")}：{r.detail.failed_step}</p>}{r.detail.message&&<p>{__ui(displayAIText(r.detail.message))}</p>}{r.detail.completed_steps>0&&<p>{__ui("已完成步骤")}：{r.detail.completed_steps}</p>}</div>}
            </article>
          ))}
        </details>
      </section>
      {(changes.data || []).some((c) =>
        ["unknown", "executing"].includes(c.status),
      ) && (
        <section className="panel">
          <h3>{__ui("执行结果待核实")}</h3>
          {(changes.data || [])
            .filter((c) => ["unknown", "executing"].includes(c.status))
            .map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  try {
                    const checked=await api(
                      `/projects/${project.id}/ai/changes/${c.id}/reconcile`,
                      "POST",
                      {},
                    );
                    notify(__ui(checked.outcome?.label||"结果仍待核实，请勿新建重复操作"));reload();
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                {__ui("核实执行结果")}
              </button>
            ))}
        </section>
      )}
      {confirmChange && (
        <AIChangePreview
          project={project.id}
          change={confirmChange}
          onClose={() => setConfirmChange(null)}
          onWritten={(r) => {
            if(currentProject.current!==project.id)return;
            const text = r.ok
              ? "确认结果：方案已写入，请到预览中的目标表查看。"
              : r.unknown
                ? "确认结果：待核实，请勿重复新建。"
                : `确认结果：未写入，${r.error || r.data?.error || r.status}`;
            setMessages((v) => [...v.slice(-5), { role: "assistant", text }]);
            setConfirmChange(null);
            reload();
            notify(text);
          }}
        />
      )}
      {__ui(
        settings && (
          <Modal
            title={__ui("AI模型服务配置")}
            wide
            onClose={() => {
              if (!testing) {
                setSettings(false);
                setEdit(null);
              }
            }}
          >
            <p className="help">
              {__ui(
                "仅空间所有者可配置。密钥加密存储，不返回浏览器；输入框留空保留原密钥。Ollama在Docker中连接宿主机，请使用host.docker.internal。修改地址需重新输入或清除密钥。",
              )}
            </p>
            {__ui(
              !edit ? (
                <>
                  <div className="type-picker">
                    {__ui(
                      Object.entries(aiProviders).map(([id, p]) => (
                        <button
                          key={id}
                          onClick={() =>
                            setEdit(
                              state.data.configs.find(
                                (c: any) => c.provider === id,
                              ) || {
                                provider: id,
                                protocol: p.protocol,
                                base_url: p.base_url,
                                model: "",
                                enabled: false,
                                max_tokens: 4096,
                                timeout_seconds: id === "ollama" ? 600 : 60,
                                cold_start_seconds:
                                  id === "ollama" ? 1800 : undefined,
                                version: 0,
                              },
                            )
                          }
                        >
                          {__ui(p.name)}
                          {__ui(
                            state.data.configs.some(
                              (c: any) => c.provider === id && c.enabled,
                            )
                              ? " · 已启用"
                              : "",
                          )}
                        </button>
                      )),
                    )}
                  </div>
                  {testingError&&<ErrorBox message={__ui(testingError)}/>}
                  <table className="data-grid">
                    <thead>
                      <tr>
                        <th>{__ui("服务")}</th>
                        <th>{__ui("模型")}</th>
                        <th>{__ui("状态")}</th>
                        <th>{__ui("操作")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {__ui(
                        state.data.configs.map((c: any) => (
                          <tr key={c.provider}>
                            <td>
                              {__ui(
                                aiProviders[
                                  c.provider as keyof typeof aiProviders
                                ].name,
                              )}
                            </td>
                            <td>{__ui(c.model)}</td>
                            <td>
                              {__ui(c.enabled ? "启用" : "停用")} ·{" "}
                              {__ui(c.has_key ? "已保存密钥" : "无密钥")}
                            </td>
                            <td>
                              <button onClick={() => setEdit(c)}>
                                {__ui("编辑")}
                              </button>
                              <button
                                disabled={!!testing}
                                onClick={async () => {
                                  setTestingError("");
                                  setTesting(c.provider);
                                  try {
                                    await api(
                                      `/workspaces/${workspace.id}/ai-configs/${c.provider}/test`,
                                      "POST",
                                      {},
                                    );
                                    notify("模型服务连接成功");
                                  } catch (e) {
                                    setTestingError((e as Error).message);
                                  } finally {
                                    setTesting("");
                                  }
                                }}
                              >
                                {__ui(
                                  testing === c.provider
                                    ? "测试中"
                                    : "测试连接",
                                )}
                              </button>
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </>
              ) : (
                <Form
                  key={edit.provider}
                  onClose={() => setEdit(null)}
                  onSubmit={async (d) => {
                    await api(`/workspaces/${workspace.id}/ai-configs`, "PUT", {
                      provider: edit.provider,
                      protocol: d.get("protocol"),
                      base_url: d.get("base_url"),
                      model: d.get("model"),
                      api_key: String(d.get("api_key") || "").trim(),
                      clear_key: d.get("clear_key") === "on" && !String(d.get("api_key")||"").trim(),
                      enabled: d.get("enabled") === "on",
                      max_tokens: Number(d.get("max_tokens")),
                      timeout_seconds: Number(d.get("timeout_seconds")),
                      version: edit.version,
                      ...(edit.provider === "ollama"
                        ? {
                            thinking: d.get("thinking") === "on",
                            cold_start_seconds: Number(
                              d.get("cold_start_seconds") || 1800,
                            ),
                          }
                        : {}),
                    });
                    setEdit(null);
                    setTestingError("");
                    reload();
                    notify("模型配置已加密保存");
                  }}
                >
                  <h3>
                    {
                      aiProviders[edit.provider as keyof typeof aiProviders]
                        .name
                    }
                  </h3>
                  <Field label={__ui("API协议")}>
                    <select name="protocol" defaultValue={edit.protocol}>
                      <option value="responses">OpenAI Responses</option>
                      <option value="chat">
                        {__ui("OpenAI兼容 Chat Completions")}
                      </option>
                      <option value="claude">Claude Messages</option>
                      <option value="gemini">Gemini GenerateContent</option>
                    </select>
                  </Field>
                  <Field label={__ui("接口基础地址")}>
                    <input
                      name="base_url"
                      required
                      type="url"
                      defaultValue={edit.base_url}
                      placeholder={__ui("https://服务域名/v1")}
                    />
                  </Field>
                  <Field label={__ui("模型名称")} hint={edit.protocol==='gemini'?__ui('填写模型API ID，例如 gemini-3.8-flash；不要填写带空格的显示名称。'):undefined}>
                    <input
                      name="model"
                      required
                      maxLength={150}
                      defaultValue={edit.model}
                      placeholder={__ui("填写供应商支持的模型ID")}
                    />
                  </Field>
                  <AIKeyFields hasKey={!!edit.has_key} local={edit.provider==='ollama'}/>
                  <div className="form-grid">
                    <Field label={__ui("输出Token上限")}>
                      <input
                        name="max_tokens"
                        type="number"
                        min={256}
                        max={16384}
                        defaultValue={edit.max_tokens}
                      />
                    </Field>
                    <Field label={__ui("单次模型超时（秒）")}>
                      <input
                        name="timeout_seconds"
                        type="number"
                        min={5}
                        max={edit.provider === "ollama" ? 1800 : 120}
                        defaultValue={edit.timeout_seconds}
                      />
                    </Field>
                  </div>
                  {__ui(
                    edit.provider === "ollama" && (
                      <Field
                        label={__ui("冷启动等待（秒）")}
                        hint={__ui(
                          "冷启动默认30分钟，最长60分钟；就绪后单次推理默认10分钟，分别计时",
                        )}
                      >
                        <input
                          name="cold_start_seconds"
                          type="number"
                          required
                          min={5}
                          max={3600}
                          defaultValue={edit.cold_start_seconds ?? 1800}
                        />
                      </Field>
                    ),
                  )}
                  {__ui(
                    edit.provider === "ollama" && (
                      <label className="checkbox-label">
                        <input
                          name="thinking"
                          type="checkbox"
                          defaultChecked={edit.thinking !== false}
                        />
                        {__ui("启用思考模式（会增加本机推理时间）")}
                      </label>
                    ),
                  )}
                  <label className="checkbox-label">
                    <input
                      name="enabled"
                      type="checkbox"
                      defaultChecked={edit.enabled}
                    />
                    {__ui("启用供本空间用户使用")}
                  </label>
                </Form>
              ),
            )}
          </Modal>
        ),
      )}
    </>
  );
}
