import { z } from "zod";
import { HttpError } from "./auth.ts";
import {
  fieldTypes,
  integerTypes,
  validateValue,
  fieldExemptsExisting,
  choiceTypes,
  isSystemField,
} from "../shared/fields.ts";
export const id = z.string().uuid(),
  name = z.string().trim().min(1).max(120),
  password = z.string().min(12).max(128).refine(v=>!/^(?:password|admin|test|qwerty)\d*$/i.test(v)&&!/^\d+$/.test(v)&&!/^(.)(\1)+$/u.test(v),'不能使用常见口令、纯数字或重复字符');
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "日期无效",
  );
export const field = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
    name,
    type: z.enum(fieldTypes),
    required: z.boolean().default(false),
    plan_date:z.enum(["start","finish"]).optional(),
    image_upload:z.boolean().optional(),
    auto_increment: z.boolean().optional(),
    auto_increment_start: z.string().regex(/^-?[0-9]{1,20}$/).optional(),
    auto_increment_step: z.string().regex(/^[1-9][0-9]{0,19}$/).optional(),
    auto_code: z.boolean().optional(),
    code_prefix: z.string().max(20).regex(/^[A-Za-z0-9._-]*$/).optional(),
    code_start: z.string().regex(/^[1-9][0-9]{0,11}$/).optional(),
    code_step: z.string().regex(/^[1-9][0-9]{0,6}$/).optional(),
    code_width: z.number().int().min(1).max(12).optional(),
    code_fill_gaps: z.boolean().optional(),
    unit: z.string().max(20).optional(),
    precision: z.number().int().min(1).max(1000).optional(),
    scale: z.number().int().min(0).max(1000).optional(),
    options: z.array(z.string().min(1).max(200)).max(200).optional(),
    target_table: id.optional(),
    display_column: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
      .optional(),
    bidirectional: z.boolean().optional(),
    inverse_name: name.optional(),
    formula: z.string().trim().min(1).max(20000).optional(),
  })
  .superRefine((f, ctx) => {
    if(f.plan_date&&f.type!=="date")ctx.addIssue({code:"custom",message:"计划日期字段必须为日期类型"});
    if(f.image_upload&&(f.type!=="text"||f.auto_code))ctx.addIssue({code:"custom",message:"照片上传仅适用于非自动编码文本列"});
    if ((f.auto_increment || f.auto_increment_step!==undefined || f.auto_increment_start!==undefined) && !integerTypes.includes(f.type))ctx.addIssue({code:'custom',message:'只有整数列支持自增设置'});
    if ((f.auto_code || f.code_prefix!==undefined || f.code_start!==undefined || f.code_step!==undefined || f.code_width!==undefined || f.code_fill_gaps!==undefined) && f.type!=='text')ctx.addIssue({code:'custom',message:'只有文本列支持组合编码'});
    if (f.type==='text' && !f.auto_code && [f.code_prefix,f.code_start,f.code_step,f.code_width,f.code_fill_gaps].some(v=>v!==undefined))ctx.addIssue({code:'custom',message:'先启用组合编码再设置规则'});
    if(f.auto_increment_step!==undefined){try{validateValue({...f,required:false},f.auto_increment_step)}catch{ctx.addIssue({code:'custom',message:'自增间隔超出该整数类型范围'})}}
    if(f.auto_increment_start!==undefined){try{validateValue({...f,required:false},f.auto_increment_start)}catch{ctx.addIssue({code:'custom',message:'自增起始值超出该整数类型范围'})}}
    if (f.type === "backlink")
      ctx.addIssue({ code: "custom", message: "反向列由双向引用自动生成" });
    if (f.type === "reference" && !f.target_table)
      ctx.addIssue({ code: "custom", message: "请选择关联数据表" });
    if (
      f.type !== "reference" &&
      [f.target_table, f.display_column, f.bidirectional, f.inverse_name].some(
        (v) => v !== undefined,
      )
    )
      ctx.addIssue({ code: "custom", message: "只有引用字段支持关联配置" });
    if (f.type === "formula" && !f.formula)
      ctx.addIssue({ code: "custom", message: "公式字段必须填写公式表达式" });
    if (f.type !== "formula" && f.formula !== undefined)
      ctx.addIssue({ code: "custom", message: "只有公式字段支持公式表达式" });
    if (f.type === "decimal" && (f.scale ?? 2) > (f.precision ?? 38))
      ctx.addIssue({ code: "custom", message: "小数位不能大于精度" });
    if (
      choiceTypes.includes(f.type) &&
      (!f.options?.length || new Set(f.options).size !== f.options.length)
    )
      ctx.addIssue({ code: "custom", message: "枚举选项不能为空或重复" });
    if (
      f.type !== "decimal" &&
      (f.precision !== undefined || f.scale !== undefined)
    )
      ctx.addIssue({ code: "custom", message: "仅精确小数支持精度配置" });
    if (!choiceTypes.includes(f.type) && f.options !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "仅枚举、单选和多选支持选项配置",
      });
    if (isSystemField(f) && f.required)
      ctx.addIssue({
        code: "custom",
        message: "系统字段自动生成，无需设置必填",
      });
  });
export const fields = z
  .array(field)
  .min(1)
  .max(50)
  .refine(
    (a) => new Set(a.map((f) => f.id)).size === a.length,
    "字段标识不可重复",
  );
export const crud = z.object({read:z.boolean(),create:z.boolean(),update:z.boolean(),delete:z.boolean()}).refine(v=>v.read||!(v.create||v.update||v.delete), "写入权限需要同时允许查看");
export const membership = z.object({
  role: z.enum(["manager", "editor", "reviewer", "viewer"]),
  project_role_id: id.nullable().default(null),
  department_id: id.nullable().default(null),
  table_ids: z.array(id).max(100).default([]),
  hidden_columns: z.array(z.string().max(40)).max(100).default([]),
  row_scope: z.enum(["all", "own"]).default("all"),
  can_export: z.boolean().default(false),
  expires_at: z.string().datetime().nullable().default(null),
  crud_permissions: z.record(z.string().refine(k=>k==="$data"||k==="$files"||id.safeParse(k).success||k.startsWith("department:")&&id.safeParse(k.slice(11)).success),crud).refine(v=>Object.keys(v).length<=202,"权限范围过多").default({}),
});
export const activity = z.object({
  code: z.string().trim().min(1).max(40),
  name,
  duration: z.number().min(0).max(3650),
  progress: z.number().min(0).max(100),
  department_id: id.nullable().default(null),
  predecessors: z
    .array(
      z.object({
        id,
        type: z.enum(["FS", "SS", "FF", "SF"]),
        lag: z.number().int().min(-3650).max(3650),
      }),
    )
    .max(50)
    .default([]),
});
export function validateRecord(columns: any[], data: Record<string, unknown>, createdAt?:string|Date) {
  if (Object.keys(data).some((k) => !columns.some((f) => f.id === k)))
    throw new HttpError(400, "记录包含未定义或无权访问的字段");
  const result: Record<string, unknown> = {};
  for (const f of columns) {
    if ((f as any).derived_reference) {
      if(Object.hasOwn(data,f.id))throw new HttpError(400,f.name+"：自动关联字段只读");
      continue;
    }
    if (f.type === "backlink") {
      if (Object.hasOwn(data, f.id)) validateValue(f, data[f.id]);
      continue;
    }
    if(f.plan_date==="finish"){if(Object.hasOwn(data,f.id)&&!createdAt)throw new HttpError(400,f.name+"：自动计算日期只读");continue;}
    if (isSystemField(f)) {
      if (Object.hasOwn(data, f.id))
        throw new HttpError(400, f.name + "：系统字段不允许填写或覆盖");
      continue;
    }
    if (f.type === "formula") {
      if(Object.hasOwn(data,f.id)&&fieldExemptsExisting(f,createdAt))result[f.id]=data[f.id];
      else if (Object.hasOwn(data, f.id))
        throw new HttpError(400, f.name + "：公式字段只读，不能填写");
      continue;
    }
    try {
      result[f.id] = validateValue(fieldExemptsExisting(f,createdAt)?{...f,required:false}:f, data[f.id]);
    } catch (error) {
      throw new HttpError(400, f.name + "：" + (error as Error).message);
    }
  }
  return result;
}
