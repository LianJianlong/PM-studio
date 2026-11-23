import { translateUiValue as __ui } from "./i18n";
import { useApi, Loading, ErrorBox } from "./lib";
export default function ReleaseReadiness() {
    const { data, error } = useApi<any>("/system/release-readiness");
    const events = useApi<any[]>('/system/security-events');
    if (error)
        return <ErrorBox message={__ui(error)}/>;
    if (!data)
        return <Loading />;
    return (<>
      <h3>{__ui("正式发布检查")}</h3>
      <p>
        {__ui(data.mode === "local"
            ? "当前为本机开发模式；测试账号保持可用。"
            : "当前为正式发布模式。")}{__ui(" ")}
        {__ui(data.ready
            ? "基础发布配置已满足。"
            : "以下条件需完成后才能启动正式发布模式。")}
      </p>
      <table className="data-grid">
        <thead>
          <tr>
            <th>{__ui("检查项")}</th>
            <th>{__ui("状态")}</th>
            <th>{__ui("处理说明")}</th>
          </tr>
        </thead>
        <tbody>
          {__ui(data.checks.map((c: any) => (<tr key={c.id}>
              <td>{__ui(c.title)}</td>
              <td>{__ui(c.passed ? "通过" : "待配置")}</td>
              <td>{__ui(c.detail)}</td>
            </tr>)))}
        </tbody>
      </table>
      {__ui(data.notes.map((n: string) => (<p className="help" key={n}>
          {__ui(n)}
        </p>)))}
      <details><summary>{__ui("安全事件日志（最近200条）")}</summary>{__ui(events.error ? <ErrorBox message={__ui(events.error)}/> : <div className="grid-scroll"><table className="data-grid"><thead><tr><th>{__ui("时间")}</th><th>{__ui("事件")}</th><th>{__ui("结果")}</th><th>{__ui("账号ID")}</th><th>{__ui("来源地址")}</th></tr></thead><tbody>{__ui(events.data?.map(e => <tr key={e.id}><td>{__ui(new Date(e.created_at).toLocaleString())}</td><td>{__ui(e.event)}</td><td>{__ui(e.outcome)}</td><td>{__ui(e.actor_id || '未知账号')}</td><td>{__ui(e.address)}</td></tr>))}</tbody></table></div>)}</details>
    </>);
}
