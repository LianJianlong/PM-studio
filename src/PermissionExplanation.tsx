import { translateUiValue as __ui } from "./i18n";
import { useApi, useApp, ErrorBox, roles, timestamp } from './lib';
export default function PermissionExplanation({ tableId, recordId }: {
    tableId?: string;
    recordId?: string;
}) {
    const { project, tick } = useApp();
    const query = new URLSearchParams();
    if (tableId)
        query.set('table_id', tableId);
    if (recordId)
        query.set('record_id', recordId);
    const { data, error } = useApi(project ? `/projects/${project.id}/permission-explanation?${query}` : null, tick);
    return <details className='panel permission-explanation'><summary>{__ui("查看权限来源与限制原因")}</summary>{__ui(error && <ErrorBox message={__ui(error)}/>)}{__ui(data && <><dl><dt>{__ui("来源")}</dt><dd>{__ui(data.source.type === 'workspace_owner' ? '工作空间所有者继承' : '项目成员授权')} · {__ui(roles[data.source.role] || data.source.role)}</dd><dt>{__ui("部门范围")}</dt><dd>{__ui(data.scope.department)}</dd><dt>{__ui("记录范围")}</dt><dd>{__ui(data.scope.rows)}</dd><dt>{__ui("可读数据表")}</dt><dd>{__ui(data.scope.tables.length)}{__ui(" 张")}</dd><dt>{__ui("隐藏列")}</dt><dd>{__ui(data.scope.hidden_column_count)}{__ui(" 个字段标识")}</dd><dt>{__ui("授权到期")}</dt><dd>{__ui(data.source.expires_at ? timestamp(data.source.expires_at) : '长期')}</dd></dl><ul>{__ui(data.reasons.map((reason: string) => <li key={reason}>{__ui(reason)}</li>))}</ul>{__ui(data.table && <p>{__ui("当前表：")}{__ui(data.table.allowed ? '可读' : '不可读')} · {__ui(data.table.write ? '允许写入' : '禁止写入')} · {__ui(data.table.export ? '允许导出' : '禁止导出')}。{__ui(data.table.reason)}</p>)}{__ui(data.record && <p>{__ui("当前记录：")}{__ui(data.record.read ? '可读' : '不可读')} · {__ui(data.record.write ? '允许修改' : '禁止修改')}。{__ui(data.record.reason)}</p>)}<p className='help'>{__ui("以下模块仍采用独立规则：")}</p><ul className='help'>{__ui(data.shared_modules.map((reason: string) => <li key={reason}>{__ui(reason)}</li>))}</ul></>)}</details>;
}
