"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTasks } from "./use-tasks";
import { CalendarView } from "./CalendarView";
import { TaskDetailPanel } from "./TaskDetailPanel";

interface CalendarPageViewProps {
  onSelectTask?: (taskId: string, listId: string) => void;
}

/**
 * 独立任务日历页面：显示所有有截止日期的任务（跨清单），双击打开详情。
 */
export function CalendarPageView({ onSelectTask }: CalendarPageViewProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const { tasks, loading, updateTask, deleteTask, toggleStatus } = useTasks({});

  // 只显示有截止日期的任务
  const tasksWithDueDate = tasks.filter((t) => t.dueDate);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const handleOpenTask = (task: (typeof tasks)[number]) => {
    if (onSelectTask) {
      onSelectTask(task.id, task.listId ?? "");
    } else {
      setSelectedTaskId(task.id);
    }
  };

  return (
    <div className="flex h-full min-w-0">
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full bg-primary/70" />
          <div>
            <h2 className="text-xl font-semibold tracking-tight">任务日历</h2>
            <p className="text-xs text-muted-foreground">
              {loading ? "加载中…" : `${tasksWithDueDate.length} 个有截止日期的任务`}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : tasksWithDueDate.length === 0 ? (
          <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 py-14">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />
            <div className="relative flex flex-col items-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
                <CalendarDays className="h-7 w-7 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">暂无有截止日期的任务</p>
              <p className="text-xs mt-1 text-muted-foreground">
                在清单中为任务设置截止日期后，将在此处显示
              </p>
            </div>
          </div>
        ) : (
          <CalendarView
            tasks={tasksWithDueDate}
            onToggleStatus={toggleStatus}
            onUpdate={updateTask}
            onOpenTask={handleOpenTask}
          />
        )}
      </div>
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={updateTask}
          onDelete={deleteTask}
        />
      )}
    </div>
  );
}
