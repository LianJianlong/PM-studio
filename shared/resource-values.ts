import { validateValue } from "./fields.ts";

// Transport and database values remain decimal strings. Numbers are only for drawing charts.
export function resourceValue(
  value: unknown,
  maximum = "1000000000000000",
): string {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (!Number.isInteger(value) && Math.abs(value) >= 1e12))
  )
    throw Error("大金额请使用精确数值文本，避免精度损失");
  const result = validateValue(
    {
      id: "value",
      name: "数值",
      type: "decimal",
      precision: 20,
      scale: 4,
      required: true,
    },
    String(value),
  ) as string;
  const ticks = resourceTicks(result);
  if (ticks < 0n || ticks > resourceTicks(maximum))
    throw Error(`数值必须在0至${maximum}之间，最多4位小数`);
  return result;
}
export function resourceTicks(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (
    (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"))) *
    (negative ? -1n : 1n)
  );
}
export function resourceText(ticks: bigint): string {
  const sign=ticks<0n?"-":"",absolute=ticks<0n?-ticks:ticks;
  return `${sign}${absolute / 10000n}.${(absolute % 10000n).toString().padStart(4, "0")}`;
}
export function distributeResource(value: string, count: number): bigint[] {
  if (!Number.isSafeInteger(count) || count < 1) throw Error("分摊天数无效");
  const total = resourceTicks(value),
    days = BigInt(count),
    base = total / days,
    remainder = total % days;
  return Array.from(
    { length: count },
    (_, index) => base + (BigInt(index) < remainder ? 1n : 0n),
  );
}
// Work quantities are not capped by the monetary budget limit.
function durationTicks(value:string):bigint{
 const d=Number(value);if(!Number.isFinite(d)||d<0||d>3650)throw Error('持续工期须为0至3650工作日');
 return BigInt(Math.round(d*100000000));
}
export function resourceUnits(quantity:string,duration:string):string{
 const product=resourceTicks(resourceValue(quantity))*durationTicks(duration);
 return resourceText((product+50000000n)/100000000n);
}
export function resourceCost(quantity:string,rate:string,duration='1.0000'):string{
 const product=resourceTicks(resourceValue(quantity))*resourceTicks(resourceValue(rate))*durationTicks(duration);
 return resourceValue(resourceText((product+500000000000n)/1000000000000n));
}
export function calendarCapacity(
  capacity: string,
  minutes: number,
  hoursPerDay: number,
): bigint {
  if (
    !Number.isFinite(hoursPerDay) ||
    hoursPerDay < 1/60 ||
    !Number.isSafeInteger(minutes) ||
    minutes < 0
  )
    throw Error("资源日容量换算无效");
  const divisor = BigInt(Math.round(hoursPerDay * 60 * 1000000));
  return (resourceTicks(capacity) * BigInt(minutes) * 1000000n) / divisor;
}
export function distributeResourceByMinutes(
  value: string,
  weights: number[],
): bigint[] {
  if (
    !weights.length ||
    weights.some((w) => !Number.isSafeInteger(w) || w <= 0)
  )
    throw Error("工时分摊权重无效");
  const total = resourceTicks(value),
    denominator = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  const parts = weights.map((w) => (total * BigInt(w)) / denominator);
  let rest = total - parts.reduce((s, v) => s + v, 0n);
  const ranked = weights
    .map((w, i) => ({ i, remainder: (total * BigInt(w)) % denominator }))
    .sort((a, b) =>
      a.remainder > b.remainder
        ? -1
        : a.remainder < b.remainder
          ? 1
          : a.i - b.i,
    );
  for (let i = 0; rest > 0n; i++, rest--) parts[ranked[i].i]++;
  return parts;
}
