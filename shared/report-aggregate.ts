import { decimalParts, exactSum, fixedDecimal } from "./fields.ts";

export type ReportAggregation = "count" | "sum" | "average" | "min" | "max";
export class StatisticsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatisticsError";
  }
}

function compareNumeric(a: string, b: string) {
  const left = decimalParts(a),
    right = decimalParts(b);
  const scale = Math.max(left.scale, right.scale);
  const l = left.coefficient * 10n ** BigInt(scale - left.scale);
  const r = right.coefficient * 10n ** BigInt(scale - right.scale);
  return l < r ? -1 : l > r ? 1 : 0;
}

export function aggregateReportValues(
  values: unknown[],
  aggregation: ReportAggregation,
): string {
  const present = values.filter(
    (value) => value !== null && value !== undefined && value !== "",
  );
  if (present.some((value) => String(value).startsWith("#ERROR")))
    throw new StatisticsError(
      "统计包含公式计算错误，请先修正源记录；未生成合计",
    );
  if (aggregation === "count") return String(values.length);
  if (
    present.some(
      (value) =>
        !/^[-+]?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(value)),
    )
  )
    throw new StatisticsError(
      "统计字段包含非数值结果，请选择数值字段或修正公式",
    );
  const numeric = values
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(String)
    .filter((value) => /^[-+]?(?:\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value));
  if (!numeric.length) return "0";
  if (aggregation === "min" || aggregation === "max") {
    return numeric.reduce((best, value) =>
      (
        aggregation === "min"
          ? compareNumeric(value, best) < 0
          : compareNumeric(value, best) > 0
      )
        ? value
        : best,
    );
  }
  const sum = exactSum(numeric);
  if (aggregation === "sum") return sum;
  const part = decimalParts(sum);
  const scale = Math.max(4, part.scale);
  const numerator = part.coefficient * 10n ** BigInt(scale - part.scale);
  const divisor = BigInt(numeric.length);
  const half = divisor / 2n;
  return fixedDecimal(
    (numerator + (numerator < 0n ? -half : half)) / divisor,
    scale,
  );
}
