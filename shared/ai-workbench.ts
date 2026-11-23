import { z } from "zod";
import {businessActions,resourceBusinessOperation,type BusinessScope} from "./ai-business-objects";
import { agentPlan, type AgentPlan } from "./ai-agent-plan.ts";
const values = z.record(z.string(), z.unknown());
const row = z.object({ id: z.string().optional(), data: values }).strict();
const operation = z
  .object({
    action: z.enum([
      "table.create",
      "table.update",
      "table.delete",
      "field.add",
      "field.update",
      "field.delete",
      "records.create",
      "records.update",
      "records.delete",
      ...businessActions,
    ]),
    table: z.string().optional(),
    target:z.string().min(1).optional(),
    resource:z.string().min(1).optional(),
    data:values.optional(),
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,30}$/)
      .optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    department_id: z.string().optional(),
    columns: z.array(values).optional(),
    field: z.string().optional(),
    definition: values.optional(),
    rows: z.array(row).max(5000).optional(),
    ids: z.array(z.string()).max(1000).optional(),
  })
  .strict();
export const dataTask = z
  .object({
    outcome: z.enum(["answer", "load", "draft", "clarify"]),
    summary: z.string().min(1).max(2000),
    table_ids: z.array(z.string()).max(8).default([]),
    page: z.number().int().positive().default(1),
    search: z.string().max(100).default(""),
    operations: z.array(operation).max(96).default([]),
  })
  .strict();
export type DataTask = z.infer<typeof dataTask>;
export type DataTable = {
  id: string;
  name: string;
  project_id: string;
  columns: any[];
  object_version: number;
  rows: any[];
  total: number;
  permissions: any;
  planning_kind?: string;
  review_mode?: string;
  page?: number;
  search?: string;
  row_aliases?:Record<string,string>;
};
export type DataScope = {
  project: string;
  departments: string[];
  department_lookup?: Record<string, string>;
  tables: DataTable[];
  business?:BusinessScope;
};
function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
function fieldValues(table: DataTable, data: Record<string, unknown>) {
  const mapped: Record<string, unknown> = {};
  ensure(Object.keys(data).length, "记录内容不能为空");
  for (const [key, value] of Object.entries(data)) {
    const exact = table.columns.find((c) => c.id === key);
    const matches = exact
      ? [exact]
      : table.columns.filter((c) => c.name === key);
    ensure(
      matches.length === 1,
      `字段“${key}”未定义、不可见或重名，请使用已读取的字段ID`,
    );
    ensure(!Object.hasOwn(mapped, matches[0].id), "字段重复");
    mapped[matches[0].id] = value;
  }
  return mapped;
}
/** Server compiles domain operations. The model cannot choose URLs, versions or credentials. */
export function compileDataTask(task: DataTask, scope: DataScope): AgentPlan {
  ensure(
    task.outcome === "draft" && task.operations.length,
    "没有可执行的数据草案",
  );
  const tables = scope.tables.map((t) => ({
    ...t,
    columns: t.columns.map((c) => ({ ...c })),
    rows: t.rows.map((r) => ({ ...r, data: { ...r.data } })),
  }));
  const steps: any[] = [];
  const keys = new Set<string>();
  const add = (method: string, path: string, body: any, key?: string) => {
    const id = key || `op_${steps.length + 1}`;
    ensure(!keys.has(id), "步骤标识重复");
    keys.add(id);
    steps.push({ key: id, method, path, body });
    return id;
  };
  const find = (value?: string) => {
    const exact = tables.find((t) => t.id === value);
    const matches = exact ? [exact] : tables.filter((t) => t.name === value);
    ensure(
      matches.length === 1,
      "目标表未读取、无权访问或重名，请先加载目标表",
    );
    return matches[0];
  };
  const createdResources=new Map<string,string>(),businessVersions=new Map<string,number>();
  for (const original of task.operations) {
    let op=original;
    if((businessActions as readonly string[]).includes(op.action)){
      ensure(scope.business,'业务对象尚未读取，请先选择对应计划对象');
      if(op.action.startsWith('resource.')||op.action==='allocation.assign'){
        const step=resourceBusinessOperation(op,scope.project,scope.business,createdResources,businessVersions);add(step.method,step.path,step.body,op.key);continue;
      }
      const bound=op.action==='activity.update'?scope.business.activity_table:scope.business.wbs_table;
      ensure(bound,'未找到真实业务绑定表');const table=find(bound);
      const recordTarget=scope.business.activities.find(a=>a.id===op.target)?.record_id||op.target;const exact=table.rows.find(r=>r.id===recordTarget);const matches=exact?[exact]:table.rows.filter(r=>r.data?.code===op.target||r.data?.name===op.target);
      ensure(matches.length===1,'业务对象未读取、不可见或编码/名称不唯一');
      ensure(op.data&&Object.keys(op.data).length,'业务修改需要非空data');
      if(op.action==='activity.update')op={...op,action:'records.update',table:bound,rows:[{id:matches[0].id,data:op.data}]};
      else{ensure(!Object.hasOwn(op.data,'parent'),'父节点由业务关系确定，不能同时提交parent');op={...op,action:'records.create',table:bound,rows:[{data:{...op.data,parent:[matches[0].id]}}]};}
    }

    if (op.action === "table.create") {
      ensure(
        op.key && op.name && op.columns?.length && op.department_id,
        "新建表需要key、name、department_id和columns",
      );
      const department =
        scope.department_lookup?.[op.department_id] || op.department_id;
      ensure(
        scope.departments.includes(department),
        "目标部门不属于当前授权项目",
      );
      add(
        "POST",
        `/projects/${scope.project}/tables`,
        {
          name: op.name,
          description: op.description || "",
          department_id: department,
          columns: op.columns,
        },
        op.key,
      );
      tables.push({
        id: `$steps.${op.key}.id`,
        project_id: scope.project,
        name: op.name,
        columns: op.columns,
        object_version: 1,
        rows: [],
        total: 0,
        permissions: { create: true, write: true, delete: true, manage: true },
      });
      continue;
    }
    const table = find(op.table);
    ensure(table.project_id === scope.project, "目标表不属于当前项目");
    const id = table.id;
    if (op.action === "table.update" || op.action === "table.delete") {
      ensure(table.permissions.manage, "当前用户没有管理该表的权限");
      const body: any = { version: table.object_version++ };
      if (op.action === "table.delete") body.lifecycle = "deleted";
      else {
        ensure(op.name || op.description !== undefined, "修改表需要名称或说明");
        if (op.name) body.name = op.name;
        if (op.description !== undefined) body.description = op.description;
      }
      add("PATCH", `/objects/table/${id}`, body);
      continue;
    }
    if (op.action.startsWith("field.")) {
      ensure(table.permissions.manage, "当前用户没有管理字段的权限");
      if (op.action === "field.add") {
        ensure(
          op.definition?.id && op.definition?.name && op.definition?.type,
          "新增字段需要id、name、type",
        );
        ensure(
          !table.columns.some((c) => c.id === op.definition!.id),
          "字段ID已存在",
        );
        add("POST", `/tables/${id}/columns`, op.definition);
        table.columns.push(op.definition);
        table.object_version++;
      } else {
        const matches = table.columns.filter(
          (c) => c.id === op.field || c.name === op.field,
        );
        ensure(matches.length === 1, "目标字段不存在、不可见或重名");
        const field = matches[0];
        const body: any = { version: table.object_version++ };
        if (op.action === "field.delete") {
          body.lifecycle = "deleted";
          table.columns = table.columns.filter((c) => c !== field);
        } else {
          ensure(
            op.definition && Object.keys(op.definition).length,
            "修改字段需要definition",
          );
          body.definition = { ...field, ...op.definition, id: field.id };
          Object.assign(field, body.definition);
        }
        add("PATCH", `/objects/tables/${id}/columns/${field.id}`, body);
      }
      continue;
    }
    if (op.action === "records.create") {
      ensure(table.permissions.create, "当前用户没有新增该表记录的权限");
      ensure(op.rows?.length, "新增需要rows");
      ensure(op.rows.length <= 5000, "每批新增最多5000条");
      ensure(
        op.rows.every((r) => !r.id),
        "新增不能携带旧记录ID",
      );
      add("POST", `/tables/${id}/import`, {
        rows: op.rows.map((r) => fieldValues(table, r.data)),
        include_created_ids:true,
      },op.key);
      continue;
    }
    const deleting = op.action === "records.delete";
    ensure(
      deleting ? table.permissions.delete : table.permissions.write,
      "当前用户没有执行该记录操作的权限",
    );
    const requests = deleting
      ? (op.ids || []).map((id) => ({ id, data: {} }))
      : op.rows || [];
    ensure(
      requests.length && requests.length <= 1000,
      "每批修改/删除需要1至1000条记录",
    );
    ensure(
      new Set(requests.map((r) => r.id)).size === requests.length,
      "同一批记录不能重复",
    );
    const batch: any[] = [],
      seenRecords = new Set<string>();
    for (const request of requests) {
      const exact = table.rows.find((r) => r.id === request.id);
      const alias=table.row_aliases?.[request.id!];
      const matches=exact?[exact]:alias?table.rows.filter(r=>r.id===alias):table.rows.filter((r,i)=>(!table.row_aliases&&`row_${i+1}`===request.id)||r.data?.code===request.id);
      ensure(
        matches.length === 1,
        "目标记录未读取、无权查看或不唯一，请先加载正确页面",
      );
      const current = matches[0];
      ensure(!seenRecords.has(current.id), "同一批实际记录不能重复");
      seenRecords.add(current.id);
      ensure(current.lifecycle !== "deleted", "记录已删除");
      const data = deleting ? undefined : fieldValues(table, request.data);
      if (!deleting && current.status === "approved" && table.review_mode!=="supervisor") {
        const change = add("POST", `/records/${current.id}/change`, {});
        add("PUT", `/records/$steps.${change}.id`, { version: 1, data });
      } else {
        ensure(
          (["draft", "rejected"].includes(current.status)||!deleting&&current.status==='approved'&&table.review_mode==='supervisor'),
          "记录处于审批或不可编辑状态，不能直接操作",
        );
        batch.push({
          id: current.id,
          version: current.version,
          ...(!deleting ? { data } : {}),
        });
        if (!deleting) current.version++;
      }
    }
    if (batch.length)
      add(
        "POST",
        `/tables/${id}/records/batch-${deleting ? "delete" : "update"}`,
        { records: batch },
      );
  }
  return agentPlan.parse({ summary: task.summary, operations: steps });
}
export function enrichmentFields(prompt: string, table: DataTable) {
  const text = prompt.replace(/@\[[\s\S]*?\]\([^)]*\)/g, "");
  if (!/补充|完善|编写|拟定|补全|撰写|enrich|draft|fill.*blank/i.test(text))
    return [];
  return table.columns
    .filter(
      (c) =>
        !["id", "code", "parent"].includes(c.id) &&
        ["text", "long_text", "textarea", "rich_text"].includes(
          c.type || "text",
        ) &&
        (text.includes(c.name) ||
          text.includes(c.id) ||
          (/工作范围|scope of work/i.test(text) &&
            /^(description|scope|work_scope)$/.test(c.id))),
    )
    .map((c) => c.id);
}
/** Accept equivalent operation envelopes only; never guess table, record, field or value. */
export function normalizeDataTask(input: any) {
  if (!input || typeof input !== "object") return input;
  const names = [
    "table.create",
    "table.update",
    "table.delete",
    "field.add",
    "field.update",
    "field.delete",
    "records.create",
    "records.update",
    "records.delete",
    ...businessActions,
  ];
  const aliases: Record<string, string> = {
    create_table: "table.create",
    update_table: "table.update",
    delete_table: "table.delete",
    add_field: "field.add",
    create_field: "field.add",
    update_field: "field.update",
    delete_field: "field.delete",
    add_column: "field.add",
    update_column: "field.update",
    delete_column: "field.delete",
    create_records: "records.create",
    update_records: "records.update",
    delete_records: "records.delete",
  };
  return {
    ...input,
    operations: Array.isArray(input.operations)
      ? input.operations.map((raw: any) => {
          if (!raw || typeof raw !== "object") return raw;
          let op = { ...raw };
          if (!op.action) {
            const keys = Object.keys(op).filter(
              (k) => names.includes(k) || aliases[k],
            );
            if (
              keys.length === 1 &&
              op[keys[0]] &&
              typeof op[keys[0]] === "object" &&
              !Array.isArray(op[keys[0]])
            ) {
              const key = keys[0],
                nested = op[key];
              delete op[key];
              for (const [k, v] of Object.entries(nested)) {
                if (k in op && JSON.stringify(op[k]) !== JSON.stringify(v))
                  throw Error("操作包中存在矛盾参数");
                op[k] = v;
              }
              op.action = aliases[key] || key;
            }
          }
          op.action = aliases[op.action] || op.action;
          return op;
        })
      : input.operations,
  };
}
