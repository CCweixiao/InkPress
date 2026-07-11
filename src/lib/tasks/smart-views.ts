import type { Task } from "@/components/tasks/types";

export type SmartView = "today" | "next7days";

/** 取某日历天的 [start, end) 时间区间（UTC）。 */
function dayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** 任务是否属于"今天"视图：dueDate 落在今天 OR（已完成且 completedAt 落在今天）。 */
export function isToday(task: Task, now: Date): boolean {
  if (task.status === "cancelled") return false;
  const { start, end } = dayRange(now);
  if (task.status === "done" && task.completedAt) {
    const c = new Date(task.completedAt);
    return c >= start && c < end;
  }
  if (task.dueDate) {
    const d = new Date(task.dueDate);
    return d >= start && d < end;
  }
  return false;
}

/** 任务是否属于"最近 7 天"视图：dueDate 落在 [今天, 今天+7天 23:59] 区间（含第 7 个日历天结束）。 */
export function isNext7Days(task: Task, now: Date): boolean {
  if (task.status === "cancelled") return false;
  if (!task.dueDate) return false;
  const { start } = dayRange(now);
  const end = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days => covers today..today+7 inclusive
  const d = new Date(task.dueDate);
  return d >= start && d < end;
}

/** 按智能视图批量过滤。now 默认 new Date()。trashed 任务一律排除。 */
export function filterBySmartView(tasks: Task[], view: SmartView, now: Date = new Date()): Task[] {
  const active = tasks.filter((t) => !t.trashed);
  switch (view) {
    case "today":
      return active.filter((t) => isToday(t, now));
    case "next7days":
      return active.filter((t) => isNext7Days(t, now));
  }
}
