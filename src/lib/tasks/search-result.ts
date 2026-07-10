import type { Task } from "@/components/tasks/types";

export type TaskSearchInput = Pick<
  Task,
  "id" | "title" | "status" | "priority" | "dueDate"
>;

export type TaskSearchResultItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
  archived: "已归档",
};

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  0: "",
  1: "低",
  2: "中",
  3: "高",
  4: "紧急",
};

/** 任务 → 全局搜索结果项。纯函数，不依赖 React / prisma。 */
export function taskToSearchResultItem(t: TaskSearchInput): TaskSearchResultItem {
  const parts: string[] = [STATUS_LABEL[t.status]];
  if (t.priority > 0) parts.push(PRIORITY_LABEL[t.priority]);
  if (t.dueDate) {
    const d = new Date(t.dueDate);
    parts.push(`${d.getMonth() + 1}月${d.getDate()}日`);
  }
  return {
    id: t.id,
    title: t.title || "无标题任务",
    subtitle: parts.join(" · "),
    href: "/tasks",
  };
}
