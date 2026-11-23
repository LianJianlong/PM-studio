import {attachPlanStarts} from './plan-dates.ts';
import {configureOrganizationRoster,organizationPeople,organizationRosterDescriptor} from './organization-roster.ts';
import { Router } from "express";
import { z } from "zod";
import { pool, tx, uid, audit } from "./db.ts";
import {
  access,
  canManage,
  canWrite,operationAllowed,
  requireThat,
  tableAccess,
  visibleColumns,canRecordAction,recordVisibilitySql,rowAllowed,canConfirmRecord,
} from "./auth.ts";
import { id } from "./validation.ts";
import {editableRecord} from "../shared/record-policy.ts";
import { lockReferenceProject,projectReferenceRows } from "./references.ts";
import { syncActivityRecord } from "./plan-table.ts";
import { schedule } from "./schedule.ts";
import {resourceGridFields,resourceGridOrder,type ResourceGridField} from "../shared/resource-grid.ts";
import {
  defaultProjectCalendar,
  validateCalendar,
} from "../shared/project-calendar.ts";
export const planningWorkbench = Router();
const summaryPath='/projects/:project/plan-summary';
async function summaryValue(project:any,c:Parameters<typeof access>[2]=pool):Promise<{markdown:string;version:number}>{
  const row=(await c.query('SELECT markdown,version FROM project_plan_summaries WHERE project_id=$1',[project.id])).rows[0];
  return row??{markdown:project.description||'',version:0};
}
const canEditSummary=(a:any)=>a.lifecycle==='active'&&a.workspace_lifecycle==='active'&&canWrite(a)&&operationAllowed(a,'$data','update');
planningWorkbench.get(summaryPath,async(req,res)=>{
  const a=await access(req.user.id,id.parse(req.params.project));
  requireThat(operationAllowed(a,'$data','read'));
  res.json({...await summaryValue(a),can_edit:canEditSummary(a)});
});
planningWorkbench.put(summaryPath,async(req,res)=>{
  const project=id.parse(req.params.project),actor=req.user.id;
  const {markdown,version}=z.object({markdown:z.string().max(200000),version:z.number().int().nonnegative()}).strict().parse(req.body);
  const result=await tx(async c=>{
    const first=await access(actor,project,c);
    requireThat(canEditSummary(first));
    await c.query('SELECT id FROM workspaces WHERE id=$1 FOR SHARE',[first.workspace_id]);
    await c.query('SELECT id FROM projects WHERE id=$1 FOR NO KEY UPDATE',[project]);
    const a=await access(actor,project,c);
    requireThat(canEditSummary(a));
    requireThat((await summaryValue(a,c)).version===version,409,'项目概况已被更新。请复制当前草稿，再重新打开项目概况。');
    const next={markdown,version:version+1};
    await c.query("INSERT INTO project_plan_summaries(project_id,markdown,version) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET markdown=EXCLUDED.markdown,version=EXCLUDED.version",[project,markdown,next.version]);
    await audit(c,a.workspace_id,actor,'更新项目概况',project,{version:next.version});
    return {...next,can_edit:true};
  });
  res.json(result);
});

const organizationPath='/projects/:project/organization-tree';
async function organizationAccess(user:string,project:string,c:Parameters<typeof access>[2]=pool){
  const a=await access(user,project,c);
  requireThat(operationAllowed(a,'$data','read'));
  const binding=(await c.query("SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind='organization'",[project])).rows[0];
  requireThat(binding,404,'请先启用组织架构表');
  return tableAccess(user,binding.table_id,c);
}
planningWorkbench.get(organizationPath,async(req,res)=>{
 const {table,permission:a}=await organizationAccess(req.user.id,id.parse(req.params.project));
 const rows=(await pool.query(`SELECT r.*,
 EXISTS(SELECT 1 FROM records child WHERE child.table_id=r.table_id AND child.lifecycle='active' AND child.status<>'obsolete' AND child.data->'parent'->>0=r.id::text) AS has_children
 FROM records r WHERE r.table_id=$1 AND r.lifecycle='active' AND r.status<>'obsolete' AND ${recordVisibilitySql(a,'$2')} ORDER BY coalesce(r.row_position,grid_base_position(r.created_at,r.id)),r.id LIMIT 10001`,[table.id,req.user.id])).rows;
 requireThat(rows.length<=10000,400,'组织树最多显示10000个岗位，请使用数据表管理更大范围');
 const active=table.lifecycle==='active'&&a.lifecycle==='active'&&a.workspace_lifecycle==='active';
 const projected=await projectReferenceRows(req.user.id,table,a,rows);
 const linked=await organizationPeople(req.user.id,table,a,projected);
 res.json({roster:linked.roster,can_configure_roster:active&&canManage(a),rows:linked.rows.map((r:any)=>({...r,
   can_edit:active&&canRecordAction(a,table,'update')&&editableRecord(table,r.status),
   can_remove:active&&canRecordAction(a,table,'delete')&&!r.has_children&&(
     ['draft','rejected'].includes(r.status)||r.status==='approved'&&canConfirmRecord(a,table))
 })),can_create:active&&canRecordAction(a,table,'create')});
});
planningWorkbench.get('/projects/:project/organization-roster',async(req,res)=>{
 const {table,permission}=await organizationAccess(req.user.id,id.parse(req.params.project));
 res.json(await organizationRosterDescriptor(req.user.id,table,permission));
});
planningWorkbench.put('/projects/:project/organization-roster',async(req,res)=>{
 const project=id.parse(req.params.project),body=z.object({table_id:id.optional()}).strict().parse(req.body);
 const result=await tx(async c=>{await lockReferenceProject(c,project);return configureOrganizationRoster(c,req.user.id,project,body.table_id)});
 res.json(result);
});
planningWorkbench.post(organizationPath+'/:record/remove',async(req,res)=>{
 const project=id.parse(req.params.project),key=id.parse(req.params.record);
 const body=z.object({version:z.number().int().positive()}).strict().parse(req.body);
 await tx(async c=>{
  await lockReferenceProject(c,project);
  const {table,permission:a}=await organizationAccess(req.user.id,project,c);
  requireThat(table.lifecycle==='active'&&a.lifecycle==='active'&&a.workspace_lifecycle==='active');
  requireThat(canRecordAction(a,table,'delete'));
  const r=(await c.query("SELECT * FROM records WHERE id=$1 AND table_id=$2 FOR UPDATE",[key,table.id])).rows[0];
  requireThat(r&&rowAllowed(a,r,req.user.id),404,'岗位不存在或不可访问');
  requireThat(r.version===body.version&&r.lifecycle==='active',409,'岗位已更新，请刷新后重试');
  requireThat(!(await c.query("SELECT 1 FROM records WHERE table_id=$1 AND lifecycle='active' AND status<>'obsolete' AND data->'parent'->>0=$2 LIMIT 1",[table.id,key])).rowCount,409,'请先调整下级岗位，再移除此岗位');
  if(r.status==='approved'){
    requireThat(canConfirmRecord(a,table));
    await c.query("UPDATE records SET status='obsolete',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$1",[key,req.user.id]);
  }else{
    requireThat(['draft','rejected'].includes(r.status),409,'待审岗位请先撤回');
    requireThat(!(await c.query('SELECT 1 FROM approvals WHERE record_id=$1 LIMIT 1',[key])).rowCount,409,'有审批历史的岗位请在数据表中作废');
    await c.query("UPDATE records SET lifecycle='deleted',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$1",[key,req.user.id]);
  }
  await audit(c,a.workspace_id,req.user.id,'移除组织岗位',key,{previous_status:r.status});
 });
 res.json({ok:true});
});
const planningSettings = z.union([
  z.object({kind:z.literal('wbs_color'),level:z.number().int().min(1).max(50),color:z.string().regex(/^#[0-9a-f]{6}$/i).nullable()}).strict(),
  z.object({kind:z.literal('resource_code'),prefix:z.string().max(20).regex(/^[A-Za-z0-9._-]*$/),start:z.number().int().min(1).max(999999999999),step:z.number().int().min(1).max(9999999),width:z.number().int().min(1).max(12),fill_gaps:z.boolean()}).strict(),
  z.object({kind:z.literal('resource_column'),label:z.string().trim().min(1).max(120),anchor:z.string().max(48),side:z.enum(['left','right'])}).strict(),
  z.object({kind:z.literal('resource_column_rename'),key:z.string().max(48),label:z.string().trim().min(1).max(120)}).strict(),
  z.object({kind:z.literal('resource_column_delete'),key:z.string().regex(/^custom_[0-9a-f]{32}$/)}).strict(),
]);
planningWorkbench.get('/projects/:project/planning-settings',async(req,res)=>{
  const a=await access(req.user.id,id.parse(req.params.project));
  requireThat(operationAllowed(a,'$data','read'));
  const settings=(await pool.query("SELECT planning_settings FROM projects WHERE id=$1",[a.id])).rows[0]?.planning_settings||{};
  res.json({...settings,can_manage:canManage(a)&&a.lifecycle==='active'&&a.workspace_lifecycle==='active'});
});
planningWorkbench.put('/projects/:project/planning-settings',async(req,res)=>{
  const body=planningSettings.parse(req.body);
  await tx(async c=>{
    const a=await access(req.user.id,id.parse(req.params.project),c);
    requireThat(canManage(a)&&a.lifecycle==='active'&&a.workspace_lifecycle==='active');
    if(body.kind==='resource_code')await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':resource-code',0))",[a.id]);
    if(body.kind.startsWith('resource_column'))await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':resource-columns',0))",[a.id]);
    const settings=(await c.query('SELECT planning_settings FROM projects WHERE id=$1 FOR NO KEY UPDATE',[a.id])).rows[0].planning_settings;
    if(body.kind==='wbs_color'){
      const colors={...settings.wbs_colors};
      if(body.color)colors[body.level]=body.color;else delete colors[body.level];
      settings.wbs_colors=colors;
    }else if(body.kind==='resource_column'){
      const fields=settings.resource_columns||[];
      requireThat(resourceGridOrder(fields).includes(body.anchor),409,'插入位置对应的列已变更，请刷新重试');
      requireThat(resourceGridOrder(fields).length<50,400,'每表最多50列');
      settings.resource_columns=[...fields,{key:'custom_'+uid().replaceAll('-',''),label:body.label,anchor:body.anchor,side:body.side}];
    }else if(body.kind==='resource_column_rename'){
      const fields:ResourceGridField[]=settings.resource_columns||[];
      requireThat(resourceGridOrder(fields).includes(body.key),409,'列已变更，请刷新重试');
      if(fields.some(f=>f.key===body.key))settings.resource_columns=fields.map(f=>f.key===body.key?{...f,label:body.label}:f);
      else settings.resource_column_labels={...settings.resource_column_labels,[body.key]:body.label};
    }else if(body.kind==='resource_column_delete'){
      const fields:ResourceGridField[]=settings.resource_columns||[];
      requireThat(fields.some(f=>f.key===body.key),409,'列已变更，请刷新重试');
      requireThat(!(await c.query("SELECT 1 FROM project_resources WHERE project_id=$1 AND nullif(custom_values->>$2,'') IS NOT NULL LIMIT 1",[a.id,body.key])).rowCount,409,'字段已有数据，不能删除');
      const byKey=new Map(fields.map(f=>[f.key,f]));
      const order=resourceGridOrder(fields).filter(key=>key!==body.key);
      settings.resource_columns=order.flatMap((key,i)=>{
        const field=byKey.get(key);
        return field?[{...field,anchor:order[i-1]||resourceGridFields[0],side:i?'right':'left'}]:[];
      });
    }else{
      const {kind,...rule}=body;
      settings.resource_code=rule;
    }
    await c.query('UPDATE projects SET planning_settings=$2 WHERE id=$1',[a.id,JSON.stringify(settings)]);
    await audit(c,a.workspace_id,req.user.id,'修改计划设置',a.id,body);
  });
  res.json({ok:true});
});
planningWorkbench.get(
  "/projects/:project/planning-tables/:kind",
  async (req, res) => {
    const project = id.parse(req.params.project),
      kind = z.enum(["wbs", "organization", "constraints"]).parse(req.params.kind),
      a = await access(req.user.id, project);
    const row = (
      await pool.query(
        "SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind=$2",
        [project, kind],
      )
    ).rows[0];
    if (!row) return res.json({ table: null, can_manage: canManage(a) });
    const result = await tableAccess(req.user.id, row.table_id);
    res.json({
      table: {
        ...result.table,
        columns: visibleColumns(result.permission, result.table),
      },
      can_manage: canManage(a),
    });
  },
);
planningWorkbench.post(
  "/projects/:project/planning-tables/:kind",
  async (req, res) => {
    const project = id.parse(req.params.project),
      kind = z.enum(["wbs", "organization", "constraints"]).parse(req.params.kind);
    const tableId = await tx(async (c) => {
      await lockReferenceProject(c, project);
      const a = await access(req.user.id, project, c);
      requireThat(canManage(a));
      requireThat(
        a.lifecycle === "active" && a.workspace_lifecycle === "active",
        409,
        "仅活动项目可启用层级表",
      );
      await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        project,
      ]);
      const old = (
        await c.query(
          "SELECT table_id FROM planning_tables WHERE project_id=$1 AND kind=$2",
          [project, kind],
        )
      ).rows[0];
      if (old) return old.table_id;
      const department = (
        await c.query(
          "SELECT id FROM departments WHERE project_id=$1 ORDER BY (name='经理') DESC,name LIMIT 1",
          [project],
        )
      ).rows[0];
      requireThat(department, 409, "项目需要一个部门");
      const key = uid();
      const fields = kind==='constraints' ? [
        {id:'name',name:'限制事项',type:'text',required:true},
        {id:'category',name:'限制类别',type:'single_select',options:['合同','场地','设计','采购','施工','资源','审批','其他']},
        {id:'description',name:'限制说明',type:'text'},
        {id:'owner',name:'责任人',type:'text'},
        {id:'due_date',name:'解除期限',type:'date'},
        {id:'resolution',name:'解除措施',type:'text'},
        {id:'constraint_status',name:'处理状态',type:'single_select',options:['待处理','处理中','已解除']},
      ] : [
        { id: "code", name: "编码", type: "text", required: true, auto_code:true, ...(kind==='organization'?{code_prefix:'ORG-',code_start:'1',code_step:'1',code_width:3}:{}) },
        {
          id: "name",
          name: kind === "wbs" ? "WBS名称" : "组织名称",
          type: "text",
          required: true,
        },
        {
          id: "parent",
          name: "上级节点",
          type: "reference",
          target_table: key,
          display_column: "name",
        },
        {
          id: "description",
          name: kind === "wbs" ? "工作范围" : "职责说明",
          type: "text",
        },
        { id: "owner", name: "负责人", type: "text" },
      ];
      await c.query(
        "INSERT INTO data_tables(id,project_id,department_id,name,columns) VALUES($1,$2,$3,$4,$5)",
        [
          key,
          project,
          department.id,
          ({wbs:"项目WBS",organization:"项目组织架构",constraints:"项目限制"})[kind],
          JSON.stringify(fields),
        ],
      );
      await c.query("INSERT INTO planning_tables VALUES($1,$2,$3)", [
        project,
        kind,
        key,
      ]);
      if (kind === "wbs") {
        const p = (
          await c.query(
            "SELECT table_id FROM plan_data_tables WHERE project_id=$1",
            [project],
          )
        ).rows[0];
        if (p)
          await c.query(
            `UPDATE data_tables SET columns=columns||$1::jsonb WHERE id=$2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(columns) f WHERE f->>'id'='wbs')`,
            [
              JSON.stringify([
                {
                  id: "wbs",
                  name: "所属WBS",
                  type: "reference",
                  target_table: key,
                  display_column: "name",
                },
              ]),
              p.table_id,
            ],
          );
      }
      await audit(c, a.workspace_id, req.user.id, "启用计划层级数据表", key, {
        kind,
      });
      if(kind==='organization')await configureOrganizationRoster(c,req.user.id,project);
      return key;
    });
    res.json({ id: tableId });
  },
);
planningWorkbench.get("/projects/:project/calendar", async (req, res) => {
  const a = await access(req.user.id, id.parse(req.params.project));
  res.json({
    config: a.calendar_config || defaultProjectCalendar,
    version: a.calendar_version,
    can_manage: canManage(a)&&operationAllowed(a,'$data','update')&&a.lifecycle==='active'&&a.workspace_lifecycle==='active',
  });
});
const periods = z.array(z.tuple([z.string().max(5), z.string().max(5)])).max(8);
const calendar = z.object({
  name: z.string().trim().min(1).max(120),
  week: z.array(periods).length(7),
  exceptions: z.record(z.string(), periods),
  hours_per_day: z.number(),
  hours_per_week: z.number(),
  hours_per_month: z.number(),
  hours_per_year: z.number(),
});
planningWorkbench.put("/projects/:project/calendar", async (req, res) => {
  const project = id.parse(req.params.project),
    b = z
      .object({ version: z.number().int(), config: calendar })
      .parse(req.body);
  try {
    validateCalendar(b.config);
  } catch (e) {
    requireThat(false, 400, (e as Error).message);
  }
  await tx(async (c) => {
    await lockReferenceProject(c, project);
    const a = await access(req.user.id, project, c);
    requireThat(canManage(a)&&operationAllowed(a,'$data','update'));
    requireThat(
      a.lifecycle === "active" && a.workspace_lifecycle === "active",
      409,
      "项目处于非活动状态",
    );
    const p = (
      await c.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [project])
    ).rows[0];
    requireThat(
      p.calendar_version === b.version,
      409,
      "日历已更新，请刷新后重试",
    );
    const rows = (
      await c.query("SELECT * FROM activities WHERE project_id=$1", [project])
    ).rows;
    try {
      schedule(await attachPlanStarts(a.id,rows,c),b.config,a.start_date);
    } catch (e) {
      requireThat(false, 400, (e as Error).message);
    }
    await c.query(
      "UPDATE projects SET calendar_config=$1,calendar_version=calendar_version+1 WHERE id=$2",
      [JSON.stringify(b.config), project],
    );
    await audit(c, a.workspace_id, req.user.id, "更新项目工作日历", project, {
      name: b.config.name,
      version: b.version + 1,
    });
  });
  res.json({ ok: true });
});
planningWorkbench.post("/projects/:project/dependencies", async (req, res) => {
  const project = id.parse(req.params.project),
    b = z
      .object({
        predecessor: id,
        successor: id,
        type: z.enum(["FS", "SS", "FF", "SF"]),
        lag: z.number().int().min(-3650).max(3650),
        version: z.number().int(),
        remove: z.boolean().default(false),
      })
      .parse(req.body);
  requireThat(b.predecessor !== b.successor, 400, "作业不能依赖自身");
  await tx(async (c) => {
    await lockReferenceProject(c, project);
    const a = await access(req.user.id, project, c);
    requireThat(canWrite(a)&&operationAllowed(a,"$data","update"));
    requireThat(
      a.lifecycle === "active" && a.workspace_lifecycle === "active",
      409,
      "项目处于非活动状态",
    );
    await c.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [project]);
    const rows = (
        await c.query(
          "SELECT * FROM activities WHERE project_id=$1 FOR UPDATE",
          [project],
        )
      ).rows,
      next = rows.find((r) => r.id === b.successor);
    requireThat(
      next && rows.some((r) => r.id === b.predecessor),
      404,
      "关系两端必须属于本项目",
    );
    requireThat(next.version === b.version, 409, "目标作业已更新，请重新拖拽");
    const deps = next.predecessors.filter((d: any) => d.id !== b.predecessor);
    if (!b.remove) deps.push({ id: b.predecessor, type: b.type, lag: b.lag });
    requireThat(deps.length <= 50,400,'每个作业最多支持 50 个前置关系');
    try {
      schedule(
        await attachPlanStarts(project,rows.map((r)=>(r.id===next.id?{...r,predecessors:deps}:r)),c),
        a.calendar_config,
        a.start_date,
      );
    } catch (e) {
      requireThat(false, 400, (e as Error).message);
    }
    await c.query(
      "UPDATE activities SET predecessors=$1,version=version+1 WHERE id=$2",
      [JSON.stringify(deps), next.id],
    );
    await syncActivityRecord(c, req.user.id, project, next.id);
    await audit(
      c,
      a.workspace_id,
      req.user.id,
      b.remove ? "删除作业逻辑关系" : "更新作业逻辑关系",
      next.id,
      { predecessor: b.predecessor, type: b.type, lag: b.lag },
    );
  });
  res.json({ ok: true });
});
