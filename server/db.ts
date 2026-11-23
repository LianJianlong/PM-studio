import {recordQuery} from './runtime-metrics.ts';
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./security.ts";
import { AsyncLocalStorage } from "node:async_hooks";
// DATE is a civil date, not a timestamp; keep its YYYY-MM-DD value across time zones.
pg.types.setTypeParser(1082,value=>value);
export const requestActor = new AsyncLocalStorage<string>();
export const requestTransaction=new AsyncLocalStorage<pg.PoolClient>();
function scopedPool(value:pg.Pool):pg.Pool{return new Proxy(value,{get(target,key){if(key==='query'){const client=requestTransaction.getStore();const query=client?client.query.bind(client):target.query.bind(target);return (...args:any[])=>{const started=performance.now();const result=(query as any)(...args);if(result?.then)return result.finally(()=>recordQuery(performance.now()-started));return result};}const result=Reflect.get(target,key);return typeof result==='function'?result.bind(target):result;}});}
export let pool = scopedPool(new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  statement_timeout: 15000,
}));
export const uid = () => randomUUID();
export const departments = [
  "人资",
  "经理",
  "设计管理",
  "技术",
  "工程",
  "安全",
  "质量",
  "机械与船机",
  "商务",
  "物资",
  "财税",
];
export const engineeringStages = [
  "定义",
  "启动",
  "概念",
  "方案",
  "技术",
  "实施",
  "竣工",
];
export const businessStages = [
  "投标",
  "中标",
  "计划",
  "实施",
  "控制",
  "收尾",
  "评价",
];
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const shared=requestTransaction.getStore();if(shared)return fn(shared);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id',$1,true)", [
      requestActor.getStore() ?? "",
    ]);
    const value = await fn(c);
    if((await c.query("SELECT current_setting('app.loe_dirty',true) value")).rows[0]?.value){const {flushLoe}=await import('./loe-refresh.ts');await flushLoe(c);}
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function audit(
  c: pg.Pool | pg.PoolClient,
  workspace: string,
  actor: string,
  action: string,
  resource: string,
  details: unknown = {},
) {
  await c.query(
    "INSERT INTO audit_log(workspace_id,actor_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5)",
    [workspace, actor, action, resource, JSON.stringify(details)],
  );
}
export async function createProject(
  c: pg.PoolClient,
  workspace: string,
  name: string,
  date: string,
  description = "",
) {
  const id = uid();
  await c.query(
    "INSERT INTO projects(id,workspace_id,name,start_date,description) VALUES($1,$2,$3,$4,$5)",
    [id, workspace, name, date, description],
  );
  const deps = [];
  for (const name of departments) {
    const d = uid();
    await c.query(
      "INSERT INTO departments(id,project_id,name) VALUES($1,$2,$3)",
      [d, id, name],
    );
    deps.push({ id: d, name });
  }
  return { id, deps };
}
export async function initialize() {
  if(process.env.RUN_MIGRATIONS!=='true'){
    const role=(await pool.query('SELECT current_user AS name,rolsuper,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(role.name!=='studio_app'||role.rolsuper||role.rolcreaterole)throw Error('运行应用只允许使用studio_app非特权账号');
    await pool.query('SELECT 1 FROM security_events LIMIT 0');return;
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)
    throw Error("ADMIN_PASSWORD must contain at least 12 characters");
  await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(90902026)");
    await c.query(
      await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    const exists = await c.query("SELECT id FROM users LIMIT 1");
    await c.query(
      await readFile(new URL("./lifecycle.sql", import.meta.url), "utf8"),
    );
    await c.query(
      await readFile(new URL("./record-fields.sql", import.meta.url), "utf8"),
    );
    await c.query(
      await readFile(new URL("./references.sql", import.meta.url), "utf8"),
    );
    await c.query(
      await readFile(
        new URL("./permission-revisions.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const migration of [
      "files.sql",
      "owner-items.sql",
      "query-library.sql",
      "todo-enhancements.sql",
      "todo-archive.sql",
      "todo-reliability.sql",
      "resource-management.sql",
      "superset-analytics.sql",
      "visual-reports.sql",
      "report-documents.sql", "report-schedules.sql", "drawing-boards.sql", "toolbox-notes.sql", "toolbox-documents.sql",
      "record-links.sql",
      "crud-permissions.sql", "progress-policy.sql", "security-hardening.sql",
      "plan-table.sql", "ai.sql", "planning-workbench.sql", "plan-summary.sql", "calendar-corrections.sql", "project-dashboard.sql", "public-views.sql", "audit-rectification.sql", "review-rectification.sql", "network-plans.sql", "project-roles.sql", "planning-integration.sql", "business-templates.sql", "construction-template.sql", "dashboard-overview.sql", "startup-defaults.sql", "login-appearance.sql", "security-console.sql", "password-security.sql", "file-storage.sql", "file-document.sql", "ai-data-workbench.sql", "integer-auto-increment.sql", "text-code-auto.sql", "wbs-code.sql", "resource-code.sql", "grid-insertion.sql", "record-confirmation.sql", "agenda-table.sql", "backup-access.sql", "view-preferences.sql", "ai-preview-binding.sql", "resource-duration-cost.sql", "p6-planning.sql", "progress-control.sql", "critical-delay.sql", "duration-types.sql", "loe.sql", "resource-remaining.sql", "resource-actuals.sql", "resource-observations.sql", "cost-management.sql", "custom-business-rules.sql", "business-ontology.sql", "business-actions.sql", "print-forms.sql", "workspace-storage.sql",
    ]) {
      await c.query(
        await readFile(new URL(`./${migration}`, import.meta.url), "utf8"),
      );
    }
    if (exists.rowCount) return;
    const admin = uid(),
      workspace = uid();
    await c.query(
      "INSERT INTO users(id,username,name,password_hash) VALUES($1,$2,$3,$4)",
      [admin, "admin", "平台管理员", hashPassword(process.env.ADMIN_PASSWORD!)],
    );
    await c.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
      workspace,
      "我的工程工作空间",
    ]);
    await c.query("INSERT INTO workspace_members VALUES($1,$2,$3)", [
      workspace,
      admin,
      "owner",
    ]);
    if (process.env.SEED_DEMO !== "true") return;
    const { id: project, deps } = await createProject(
      c,
      workspace,
      "滨海港区建设项目（示例）",
      "2026-09-01",
      "用于体验功能的示例项目，可另建正式项目。所有数据均为示例。",
    );
    await c.query(
      "UPDATE projects SET engineering_stage='实施',business_stage='实施' WHERE id=$1",
      [project],
    );
    const eng = deps.find((d) => d.name === "工程")!.id,
      table = uid();
    const columns = [
      { id: "date", name: "日期", type: "date", required: true },
      { id: "wbs", name: "WBS", type: "text", required: true },
      { id: "activity", name: "作业名称", type: "text", required: true },
      {
        id: "planned",
        name: "计划工程量",
        type: "number",
        unit: "m³",
        required: false,
      },
      {
        id: "actual",
        name: "实际工程量",
        type: "number",
        unit: "m³",
        required: true,
      },
      { id: "note", name: "施工说明", type: "text", required: false },
    ];
    await c.query(
      "INSERT INTO data_tables(id,project_id,department_id,name,description,columns) VALUES($1,$2,$3,$4,$5,$6)",
      [
        table,
        project,
        eng,
        "施工日报",
        "记录每日施工情况及工程量完成数据",
        JSON.stringify(columns),
      ],
    );
    const dates = [
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
    ];
    for (let i = 0; i < dates.length; i++)
      await c.query(
        "INSERT INTO records(id,table_id,data,status,created_by) VALUES($1,$2,$3,$4,$5)",
        [
          uid(),
          table,
          JSON.stringify({
            date: dates[i],
            wbs: "1.3",
            activity: "基础开挖",
            planned: 600,
            actual: [520, 560, 580, 610, 570, 590, 480][i],
            note: "示例数据",
          }),
          i < 5 ? "approved" : "draft",
          admin,
        ],
      );
    for (const d of deps.filter((d) => d.name !== "工程")) {
      await c.query(
        "INSERT INTO data_tables(id,project_id,department_id,name,description,columns) VALUES($1,$2,$3,$4,$5,$6)",
        [
          uid(),
          project,
          d.id,
          d.name + "工作台账",
          "可根据部门业务继续添加字段",
          JSON.stringify([
            { id: "title", name: "事项名称", type: "text", required: true },
            { id: "date", name: "登记日期", type: "date", required: true },
            { id: "note", name: "说明", type: "text", required: false },
          ]),
        ],
      );
    }
    const activities = [
      ["项目准备", 10, 100],
      ["测量放线", 7, 100],
      ["基础开挖", 22, 70],
      ["桩基施工", 30, 35],
      ["结构施工", 35, 0],
      ["设备安装", 20, 0],
      ["联调验收", 12, 0],
      ["竣工移交", 0, 0],
    ] as const;
    let prev = "";
    for (let i = 0; i < activities.length; i++) {
      const id = uid(),
        [name, duration, progress] = activities[i];
      await c.query(
        "INSERT INTO activities(id,project_id,code,name,duration,progress,department_id,predecessors) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          project,
          `1.${i + 1}`,
          name,
          duration,
          progress,
          eng,
          JSON.stringify(prev ? [{ id: prev, type: "FS", lag: 0 }] : []),
        ],
      );
      prev = id;
    }
    for (const [title, date] of [
      ["编制本周施工周报", "2026-09-24"],
      ["组织安全专项检查会议", "2026-09-25"],
      ["确认设备进场计划", "2026-09-28"],
    ])
      await c.query(
        "INSERT INTO todos(id,project_id,title,due_date,owner_id) VALUES($1,$2,$3,$4,$5)",
        [uid(), project, title, date, admin],
      );
    await audit(c, workspace, admin, "初始化示例项目", project);
  });
  // The migration connection is privileged; application requests use a non-superuser role.
  const systemIdentity=await pool.query('SELECT id,active FROM users WHERE system_admin');
  if(systemIdentity.rowCount&&!systemIdentity.rows[0].active)throw Error('系统管理员已停用，请通过离线运维恢复后启动');
  if(!systemIdentity.rowCount){
    const secret=process.env.SYSTEM_ADMIN_PASSWORD;
    if(!secret||secret.length<12)throw Error('缺少系统管理员；初装须提供独立SYSTEM_ADMIN_PASSWORD');
    await pool.query("INSERT INTO users(id,username,name,password_hash,password_policy_version,system_admin) VALUES($1,'superadmin','系统管理员',$2,1,true)",[uid(),hashPassword(secret)]);
  }
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!appPassword || !/^[a-f0-9]{48}$/.test(appPassword))
    throw Error("APP_DB_PASSWORD must be generated by setup.ps1");
  const roleExists = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname='studio_app'",
  );
  if (!roleExists.rowCount)
    await pool.query(
      `CREATE ROLE studio_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
  // Existing role passwords are rotated explicitly, never as a migration side effect.
  await pool.query(
    "GRANT USAGE ON SCHEMA public TO studio_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO studio_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO studio_app; REVOKE UPDATE,DELETE ON audit_log,approval_events,owner_item_events,project_file_versions,security_events,operation_events,plan_period_snapshots FROM studio_app; REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON integer_field_counters,resource_unit_observations,resource_rate_versions FROM studio_app; REVOKE DELETE ON project_cost_accounts FROM studio_app; REVOKE INSERT,DELETE,TRUNCATE ON app_login_appearance FROM studio_app",
  );
  await pool.query("GRANT USAGE ON SCHEMA analytics TO studio_app; GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO studio_app");
  const readerPassword = process.env.SUPERSET_READER_PASSWORD;
  if (readerPassword) {
    if (!/^[a-f0-9]{48}$/.test(readerPassword))
      throw Error("SUPERSET_READER_PASSWORD must be a 48-character hex secret");
    const exists = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='studio_analytics'");
    if (!exists.rowCount)
      await pool.query(`CREATE ROLE studio_analytics LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    else await pool.query(`ALTER ROLE studio_analytics PASSWORD '${readerPassword}'`);
    await pool.query("GRANT CONNECT ON DATABASE project_studio TO studio_analytics; GRANT USAGE ON SCHEMA analytics TO studio_analytics; GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO studio_analytics");
  }
  const url = new URL(process.env.DATABASE_URL!);
  url.username = "studio_app";
  url.password = appPassword;
  await pool.end();
  pool = scopedPool(new pg.Pool({
    connectionString: url.toString(),
    max: 12,
    statement_timeout: 15000,
  }));
}
