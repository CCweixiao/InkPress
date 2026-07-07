export type TaskStatus = "todo" | "in_progress" | "done" | "archived";
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

export interface Task {
  id: string;
  title: string;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  completedAt: string | null;
  parentId: string | null;
  spaceId: string | null;
  sortOrder: number;
  tagsJson: string;
  isCollapsed: boolean;
  createdAt: string;
  updatedAt: string;
  children?: Task[];
}

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; emoji: string }> = {
  0: { label: "无", color: "text-muted-foreground", emoji: "" },
  1: { label: "低", color: "text-blue-500", emoji: "🔵" },
  2: { label: "中", color: "text-yellow-500", emoji: "🟡" },
  3: { label: "高", color: "text-orange-500", emoji: "🟠" },
  4: { label: "紧急", color: "text-red-500", emoji: "🔴" },
};

export const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "待办", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  in_progress: { label: "进行中", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  done: { label: "已完成", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  archived: { label: "已归档", color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500" },
};

export type ViewMode = "list" | "kanban" | "calendar";
