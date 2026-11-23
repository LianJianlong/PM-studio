// Shared wire/storage semantics: exact values never pass through Number.
export const fieldTypes = [
  "text",
  "number",
  "date",
  "boolean",
  "int8",
  "int16",
  "int24",
  "int32",
  "int64",
  "uint64",
  "decimal",
  "float32",
  "float64",
  "time",
  "timestamp",
  "timestamptz",
  "uuid",
  "json",
  "enum",
  "array",
  "binary",
  "single_select",
  "multi_select",
  "created_time",
  "modified_time",
  "created_user",
  "modified_user",
  "reference",
  "backlink",
  "formula",
] as const;
export type FieldType = (typeof fieldTypes)[number];
export type DataField = {
  id: string;
  name: string;
  type: FieldType;
  required?: boolean;
  plan_date?: "start"|"finish";
  image_upload?: boolean;
  auto_increment?: boolean;
  auto_increment_step?: string;
  auto_increment_start?: string;
  existing_records_before?: string;
  auto_code?: boolean;
  code_prefix?: string;
  code_start?: string;
  code_step?: string;
  code_width?: number;
  code_fill_gaps?: boolean;
  unit?: string;
  precision?: number;
  scale?: number;
  options?: string[];
  lifecycle?: string;
  target_table?: string;
  display_column?: string;
  bidirectional?: boolean;
  inverse_id?: string;
  inverse_name?: string;
  source_field?: string;
  formula?: string;
};
export const typeLabels: Record<FieldType, string> = {
  text: "文本",
  number: "数值（兼容）",
  date: "日期",
  boolean: "是 / 否",
  int8: "8位整数",
  int16: "16位整数",
  int24: "24位整数",
  int32: "32位整数",
  int64: "64位整数（精确）",
  uint64: "无符号64位整数（精确）",
  decimal: "定点小数（精确）",
  float32: "32位浮点数",
  float64: "64位浮点数",
  time: "时间",
  timestamp: "日期时间（无时区）",
  timestamptz: "日期时间（含时区）",
  uuid: "UUID",
  json: "JSON",
  enum: "枚举",
  array: "JSON数组",
  binary: "二进制（Base64）",
  single_select: "单选",
  multi_select: "多选",
  created_time: "创建时间（自动）",
  modified_time: "修改时间（自动）",
  created_user: "创建人ID（自动）",
  modified_user: "修改人ID（自动）",
  reference: "引用（单向 / 双向）",
  backlink: "引用（反向关联）",
  formula: "公式（只读计算）",
};
export const isReference = (field: Pick<DataField, "type">) =>
  ["reference", "backlink"].includes(field.type);
export const systemTypes = [
  "created_time",
  "modified_time",
  "created_user",
  "modified_user",
];
export const choiceTypes = ["enum", "single_select", "multi_select"];
export function isSystemField(field: Pick<DataField, "type"> & {derived_reference?:boolean;plan_date?:string}) {
  return field.plan_date==="finish" || !!field.derived_reference || systemTypes.includes(field.type);
}
// Derived values are never accepted from the caller or stored in record.data.
export function recordValues(
  columns: DataField[],
  record: any,
): Record<string, unknown> {
  const result = { ...record.data };
  for (const f of columns) {
    if (f.lifecycle === "deleted") continue;
    if (f.type === "created_time")
      result[f.id] = new Date(record.created_at).toISOString();
    if (f.type === "modified_time")
      result[f.id] = new Date(record.updated_at).toISOString();
    if (f.type === "created_user") result[f.id] = record.created_by;
    if (f.type === "modified_user") result[f.id] = record.updated_by ?? null;
  }
  return result;
}
export const integerTypes = [
  "int8",
  "int16",
  "int24",
  "int32",
  "int64",
  "uint64",
];
export const numericTypes = [
  ...integerTypes,
  "decimal",
  "number",
  "float32",
  "float64",
];
const limits: Record<string, [bigint, bigint]> = Object.fromEntries(
  [8, 16, 24, 32, 64].map((bits) => [
    `int${bits}`,
    [-(1n << BigInt(bits - 1)), (1n << BigInt(bits - 1)) - 1n],
  ]),
);
limits.uint64 = [0n, (1n << 64n) - 1n];
export function decimalParts(value: string): {
  coefficient: bigint;
  scale: number;
} {
  if (
    value.length > 2400 ||
    !/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d{1,4})?$/.test(value)
  )
    throw Error("小数格式无效");
  const [base, exp = "0"] = value.toLowerCase().split("e"),
    [whole, fraction = ""] = base.split(".");
  let scale = fraction.length - Number(exp),
    coefficient = BigInt(whole + fraction);
  if (Math.abs(scale) > 2000) throw Error("数值超出计算范围");
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}
export function fixedDecimal(coefficient: bigint, scale: number): string {
  const negative = coefficient < 0n,
    digits = (negative ? -coefficient : coefficient)
      .toString()
      .padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits}`;
}
export function exactSum(values: unknown[], scale?: number): string {
  const parts = values
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => decimalParts(String(v)));
  const places = scale ?? Math.max(0, ...parts.map((p) => p.scale));
  let sum = 0n;
  for (const p of parts) {
    if (p.scale > places) throw Error("统计精度不匹配");
    sum += p.coefficient * 10n ** BigInt(places - p.scale);
  }
  return fixedDecimal(sum, places);
}
export function formatExact(value: unknown): string {
  const text = String(value ?? "—");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [whole, fraction] = text.split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction === undefined ? "" : "." + fraction)
  );
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/.test(value);
}
function jsonValue(value: unknown, array: boolean) {
  if (array && !Array.isArray(value)) throw Error("必须为JSON数组");
  let nodes = 0;
  function walk(v: unknown, depth: number) {
    if (++nodes > 10000 || depth > 32) throw Error("JSON结构过大或过深");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (
        !Number.isFinite(v) ||
        (Number.isInteger(v) && !Number.isSafeInteger(v))
      )
        throw Error("JSON大整数须用字符串表示，避免精度丢失");
      return;
    }
    if (Array.isArray(v)) {
      for (const child of v) walk(child, depth + 1);
      return;
    }
    if (
      typeof v === "object" &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      for (const child of Object.values(v)) walk(child, depth + 1);
      return;
    }
    throw Error("JSON值无效");
  }
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 65536)
    throw Error("JSON不得超过64KB");
  return value;
}
export function fieldExemptsExisting(field:DataField,createdAt?:string|Date):boolean{
  return !!field.existing_records_before&&!!createdAt&&new Date(createdAt).getTime()<=new Date(field.existing_records_before).getTime();
}
export function validateValue(field: DataField, value: unknown): unknown {
  if (isSystemField(field)) throw Error("系统字段由服务器自动维护，不允许填写");
  if (field.lifecycle === "deleted") {
    if (value !== null && value !== undefined && value !== "")
      throw Error("字段已删除");
    return null;
  }
  if (value === undefined || value === null || value === "") {
    if (field.required && !field.auto_increment && !field.auto_code) throw Error("不能为空");
    return null;
  }
  const type = field.type;
  if (isReference(field)) {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some(
        (v) =>
          typeof v !== "string" ||
          !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v),
      )
    )
      throw Error("引用必须为最多100个记录ID的数组");
    const values = value.map((v) => v.toLowerCase());
    if (new Set(values).size !== values.length) throw Error("引用记录不可重复");
    if (field.required && !values.length) throw Error("至少关联一条记录");
    return values.sort();
  }
  if (type === "text") {
    if (typeof value !== "string" || value.length > 10000)
      throw Error("必须为不超过10000字的文本");
    return value;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw Error("必须为是或否");
    return value;
  }
  if (integerTypes.includes(type)) {
    if (typeof value === "number" && !Number.isSafeInteger(value))
      throw Error("整数必须精确，请以字符串传入大整数");
    if (
      !["string", "number"].includes(typeof value) ||
      !/^[-+]?\d+$/.test(String(value)) ||
      String(value).length > 22
    )
      throw Error("必须为整数");
    const n = BigInt(value as string);
    const [min, max] = limits[type];
    if (n < min || n > max) throw Error(`超出${type}范围 ${min} 至 ${max}`);
    return ["int64", "uint64"].includes(type) ? n.toString() : Number(n);
  }
  if (type === "decimal") {
    if (typeof value !== "string" || !/^[-+]?\d+(?:\.\d+)?$/.test(value))
      throw Error("精确小数必须用普通十进制字符串传入，不使用科学记数法");
    const p = field.precision ?? 38,
      s = field.scale ?? 2,
      { coefficient, scale } = decimalParts(value);
    if (scale > s) throw Error(`小数位超过${s}位，不自动舍入`);
    const n = coefficient * 10n ** BigInt(s - scale);
    if ((n < 0n ? -n : n) >= 10n ** BigInt(p))
      throw Error(`超出decimal(${p},${s})范围`);
    return fixedDecimal(n, s);
  }
  if (["number", "float32", "float64"].includes(type)) {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw Error("必须为有限数值");
    const n = type === "float32" ? Math.fround(value) : value;
    if (!Number.isFinite(n)) throw Error("超出32位浮点范围");
    return n;
  }
  if (type === "json" || type === "array")
    return jsonValue(value, type === "array");
  if (type === "multi_select") {
    if (
      !Array.isArray(value) ||
      value.length > 200 ||
      value.some((v) => typeof v !== "string" || !field.options?.includes(v)) ||
      new Set(value).size !== value.length
    )
      throw Error("多选必须为不重复的允许选项数组");
    if (field.required && value.length === 0) throw Error("至少选择一项");
    // Stable configured order makes equivalent selections export and compare identically.
    return field.options!.filter((v) => value.includes(v));
  }
  if (typeof value !== "string") throw Error("必须以字符串传入");
  if (type === "date") {
    if (!validDate(value)) throw Error("日期无效，使用YYYY-MM-DD");
    return value;
  }
  if (type === "time") {
    const time = /^\d{2}:\d{2}$/.test(value) ? value + ":00" : value;
    if (!validTime(time)) throw Error("时间无效，使用HH:mm:ss，最多6位小数秒");
    return time;
  }
  if (type === "timestamp" || type === "timestamptz") {
    const match = value.match(
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[-+]\d{2}:\d{2})?$/,
    );
    if (!match || !validDate(match[1])) throw Error("日期时间格式无效");
    const time = match[2].length === 5 ? match[2] + ":00" : match[2];
    if (!validTime(time)) throw Error("时间无效");
    if (type === "timestamp") {
      if (match[3]) throw Error("无时区字段不能包含时区");
      return `${match[1]}T${time}`;
    }
    const zone = match[3];
    if (!zone) throw Error("必须指定Z或±HH:mm时区");
    if (
      zone !== "Z" &&
      (Number(zone.slice(1, 3)) > 14 ||
        Number(zone.slice(4)) > 59 ||
        (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
    )
      throw Error("时区偏移无效");
    const [clock, fraction = ""] = time.split("."),
      instant = new Date(`${match[1]}T${clock}${zone}`);
    if (
      !Number.isFinite(instant.getTime()) ||
      instant.getUTCFullYear() < 0 ||
      instant.getUTCFullYear() > 9999
    )
      throw Error("日期时间越界");
    return (
      instant.toISOString().slice(0, 19) +
      (fraction ? "." + fraction : "") +
      "Z"
    );
  }
  if (type === "uuid") {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))
      throw Error("UUID格式无效");
    return value.toLowerCase();
  }
  if (type === "enum" || type === "single_select") {
    if (!field.options?.includes(value)) throw Error("不在允许的枚举选项中");
    return value;
  }
  if (type === "binary") {
    if (
      value.length > 87384 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )
    )
      throw Error("必须为不超过64KB的Base64内容");
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    if ((value.length / 4) * 3 - padding > 65536)
      throw Error("二进制内容超过64KB");
    return value;
  }
  throw Error("字段类型不支持");
}
export function inputValue(field: DataField, text: string): unknown {
  if (text === "") return null;
  if (["number", "float32", "float64"].includes(field.type)) {
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(text.trim()))
      throw Error("数值格式无效");
    return Number(text);
  }
  if (field.type === "boolean") {
    if (text === "true") return true;
    if (text === "false") return false;
    throw Error("布尔值无效");
  }
  if (
    ["json", "array", "multi_select", "reference", "backlink"].includes(
      field.type,
    )
  )
    return JSON.parse(text);
  return text;
}
export function displayValue(value: unknown): string {
  return value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : typeof value === "boolean"
        ? value
          ? "是"
          : "否"
        : String(value);
}
