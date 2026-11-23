export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export function nextTodoDate(day: string, rule: Recurrence, anchorDay = Number(day.slice(8, 10))): string | null {
  if (rule === "none") return null;
  const current = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(current.getTime()) || current.toISOString().slice(0, 10) !== day) throw new Error("待办日期无效");
  if (rule === "monthly") {
    if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw new Error("重复日期锚点无效");
    current.setUTCDate(1);
    current.setUTCMonth(current.getUTCMonth() + 1);
    const last = new Date(current); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);
    current.setUTCDate(Math.min(anchorDay, last.getUTCDate()));
  } else current.setUTCDate(current.getUTCDate() + (rule === "weekly" ? 7 : 1));
  return current.toISOString().slice(0, 10);
}
