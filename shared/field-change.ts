import {
  validateValue,
  numericTypes,
  isSystemField,
  isReference,
  type DataField,
} from "./fields.ts";

// Validate before conversion; never truncate text, round decimals or narrow large integers silently.
export function changeFieldValue(
  previous: DataField,
  next: DataField,
  value: unknown,
) {
  if (next.type === "formula" || isSystemField(next)) {
    if (value !== undefined && value !== null && value !== "")
      throw Error("已有录入值，不能改为自动计算字段；请先迁移数据");
    return undefined;
  }
  if (isReference(previous) || isReference(next))
    throw Error("引用结构不能通过类型修改转换");
  if (value === undefined || value === null || value === "")
    return validateValue(next, value);
  let candidate = value;
  if (previous.type !== next.type) {
    if (
      next.type === "text" &&
      ["string", "number", "boolean"].includes(typeof value)
    )
      candidate = String(value);
    else if (
      numericTypes.includes(next.type) &&
      (numericTypes.includes(previous.type) || previous.type === "text")
    ) {
      const text = String(value).trim();
      if (!/^[-+]?\d+(?:\.\d+)?$/.test(text))
        throw Error("已有值不是有效十进制数值");
      if (["number", "float32", "float64"].includes(next.type)) {
        const n = Number(text);
        if (
          !Number.isFinite(n) ||
          (Number.isInteger(n) && !Number.isSafeInteger(n))
        )
          throw Error("转换会损失整数精度，请使用精确整数或定点小数");
        if (next.type === "float32" && Math.fround(n) !== n)
          throw Error("转换会损失32位浮点精度");
        candidate = n;
      } else candidate = text;
    }
  }
  return validateValue(next, candidate);
}
