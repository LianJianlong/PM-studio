export type CostRow = {
  kind: string;
  department: string;
  activity_id: string;
  activity_code: string;
  activity_name: string;
  planned_cost: string;
  actual_cost: string;
};
export type CostDimension = "kind" | "department" | "activity";
export type CostGroup = { key: string; label: string; planned: bigint; actual: bigint; variance: bigint };

export function costUnits(value: string): bigint {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) throw Error("费用格式无效");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
}

export function formatCost(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const positive = value < 0n ? -value : value;
  const whole = (positive / 10000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (positive % 10000n).toString().padStart(4, "0").replace(/0{1,2}$/, "");
  return `${sign}${whole}.${fraction}`;
}

export function groupCosts(rows: CostRow[], dimension: CostDimension): CostGroup[] {
  const groups = new Map<string, CostGroup>();
  const kinds: Record<string, string> = { human: "人力", equipment: "设备", material: "材料", expense: "费用" };
  for (const row of rows) {
    const key = dimension === "activity" ? row.activity_id : row[dimension];
    const label = dimension === "activity" ? `${row.activity_code} · ${row.activity_name}` : dimension === "kind" ? kinds[key] || key : key;
    const group = groups.get(key) || { key, label, planned: 0n, actual: 0n, variance: 0n };
    group.planned += costUnits(row.planned_cost);
    group.actual += costUnits(row.actual_cost);
    group.variance = group.planned - group.actual;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-CN", { numeric: true }));
}
