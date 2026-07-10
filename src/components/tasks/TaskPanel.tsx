"use client";

import { useState, useEffect, useCallback } from "react";
import { List, LayoutGrid, CalendarDays, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "./use-tasks";
import { TaskListView } from "./TaskListView";
import { KanbanView } from "./KanbanView";
import { CalendarView } from "./CalendarView";
import type { ViewMode, TaskStatus } from "./types";
import type { SmartView } from "@/lib/tasks/smart-views";

interface TaskPanelProps {
  spaceId?: string;
}

export function TaskPanel({ spaceId }: TaskPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const { tasks, loading, createTask, updateTask, deleteTask, reorderTasks, toggleStatus } =
    useTasks({
      spaceId,
      status: statusFilter || undefined,
      smartView: smartView ?? undefined,
    });

  const views: { mode: ViewMode; icon: React.ElementType; label: string }[] = [
    { mode: "list", icon: List, label: "列表" },
    { mode: "kanban", icon: LayoutGrid, label: "看板" },
    { mode: "calendar", icon: CalendarDays, label: "日历" },
  ];

  // 统计
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="space-y-4">
      {/* Header with view toggle and filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            {views.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all",
                  viewMode === mode
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={label}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Stats & filter */}
        <div className="flex items-center gap-3">
          {totalTasks > 0 && (
            <span className="text-xs text-muted-foreground">
              {completedTasks}/{totalTasks} 已完成
            </span>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs bg-muted border-none rounded-md px-2 py-1 text-muted-foreground"
          >
            <option value="">全部状态</option>
            <option value="todo">待办</option>
            <option value="in_progress">进行中</option>
            <option value="done">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
        </div>
      </div>

      {/* Smart view segmented control */}
      <div className="flex gap-1 border-b border-border pb-2">
        {([
          { key: null, label: "全部" },
          { key: "today", label: "今天" },
          { key: "next7days", label: "最近 7 天" },
          { key: "inbox", label: "收集箱" },
        ] as { key: SmartView | null; label: string }[]).map((opt) => (
          <button
            key={opt.label}
            onClick={() => setSmartView(opt.key)}
            className={cn(
              "px-3 py-1 text-sm rounded-md transition-colors",
              smartView === opt.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* View content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : (
        <>
          {viewMode === "list" && (
            <TaskListView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onCreateTask={createTask}
            />
          )}
          {viewMode === "kanban" && (
            <KanbanView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onReorder={reorderTasks}
            />
          )}
          {viewMode === "calendar" && (
            <CalendarView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onUpdate={updateTask}
            />
          )}
        </>
      )}
    </div>
  );
}
