"use client";

import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, CircleDashed, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskItem } from "./TaskItem";
import { QuickAddInput } from "./QuickAddInput";
import type { Task, TaskStatus, TaskPriority } from "./types";

interface TaskListViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onCreateTask: (data: { title: string; priority?: TaskPriority; dueDate?: string | null; parentId?: string | null }) => Promise<boolean>;
}

export function TaskListView({
  tasks,
  onToggleStatus,
  onUpdate,
  onDelete,
  onCreateTask,
}: TaskListViewProps) {
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState(false);

  const handleAddSubtask = (parentId: string) => {
    setAddingSubtaskFor(parentId);
  };

  const handleSubtaskCreated = async (title: string, parentId: string | null) => {
    await onCreateTask({ title, parentId });
    setAddingSubtaskFor(null);
  };

  // Group tasks by status
  const todoTasks = tasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  const doneTasks = tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-5">
      {/* Quick add input */}
      <QuickAddInput onAdd={(title, priority, dueDate) => onCreateTask({ title, priority, dueDate })} />

      {/* Active tasks section */}
      <div>
        {/* Section header */}
        <div className="flex items-center gap-2 mb-2 px-3">
          <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">待办</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {todoTasks.length}
          </span>
        </div>

        {/* Task list */}
        {todoTasks.length > 0 ? (
          <div className="space-y-0.5">
            {todoTasks.map((task) => (
              <div key={task.id}>
                <TaskItem
                  task={task}
                  onToggleStatus={onToggleStatus}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onAddSubtask={handleAddSubtask}
                />
                {addingSubtaskFor === task.id && (
                  <div className="ml-12 mt-1">
                    <QuickAddInput
                      compact
                      placeholder="添加子任务..."
                      onAdd={(title, priority, dueDate) =>
                        handleSubtaskCreated(title, task.id)
                      }
                      onCancel={() => setAddingSubtaskFor(null)}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-muted-foreground/60">
            没有待办任务
          </div>
        )}
      </div>

      {/* Completed tasks section (collapsible) */}
      {doneTasks.length > 0 && (
        <div className="border-t border-border pt-3">
          {/* Collapsible section header */}
          <button
            onClick={() => setDoneCollapsed((v) => !v)}
            className="flex items-center gap-2 mb-2 px-3 w-full hover:bg-accent/50 rounded-lg py-1 -my-1 transition-colors group"
          >
            {doneCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
            )}
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <h3 className="text-sm font-medium text-foreground">已完成</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {doneTasks.length}
            </span>
          </button>

          {/* Task list */}
          {!doneCollapsed && (
            <div className="space-y-0.5 animate-in fade-in">
              {doneTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onToggleStatus={onToggleStatus}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onAddSubtask={handleAddSubtask}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 py-14">
          {/* Decorative gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />
          <div className="relative flex flex-col items-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
              <Plus className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">还没有任务</p>
            <p className="text-xs mt-1 text-muted-foreground">
              在上方输入框添加第一个任务
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
