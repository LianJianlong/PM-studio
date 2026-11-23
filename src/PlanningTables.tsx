import {formatUiTemplate as __uiFormat} from "./i18n";
import { translateUiValue as __ui } from "./i18n";
import OrganizationTree from "./OrganizationTree";
import { RecordGrid } from "./DataCenter";
import { api, useApi, useApp, Loading, ErrorBox, Empty } from "./lib";
export default function PlanningTables({ kind, }: {
    kind: "wbs" | "organization" | "constraints";
}) {
    const { project, tick, reload, context, notify } = useApp(), state = useApi<any>(`/projects/${project.id}/planning-tables/${kind}`, tick);
    const table=state.data?.table,name=({wbs:"WBS",organization:"组织架构",constraints:"项目限制"})[kind];
    if (state.error)
        return <ErrorBox message={__ui(state.error)}/>;
    if (!state.data)
        return <Loading />;
    if (!table)
        return (<section className="panel">
        <Empty text={__uiFormat("尚未建立{0}数据表", [name])}/>
        {__ui(context.permission.manage && (<button className="primary" onClick={async () => {
                    try {
                        await api(`/projects/${project.id}/planning-tables/${kind}`, "POST", {});
                        reload();
                        notify(`${name}数据表已启用`);
                    }
                    catch (e) {
                        notify((e as Error).message);
                    }
                }}>{__ui("启用")}{__ui(name)}{__ui("数据表")}</button>))}
      </section>);
    if(kind==="organization")return <OrganizationTree key={table.id} table={table}/>;
    return <RecordGrid key={table.id} table={table} mode="entry" planningHierarchy={kind==='wbs'?'wbs':undefined}/>;
}
