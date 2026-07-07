"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
    <div className="space-y-4">
      {/* Quick add input */}
      <QuickAddInput onAdd={(title, priority, dueDate) => onCreateTask({ title, priority, dueDate })} />

      {/* Active tasks */}
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

      {/* Completed tasks */}
      {doneTasks.length > 0 && (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm text-muted-foreground mb-2 px-3">
            已完成 ({doneTasks.length})
          </h3>
          <div className="space-y-0.5">
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
        </div>
      )}

      {tasks.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Plus className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">还没有任务</p>
          <p className="text-xs mt-1">在上方输入框添加第一个任务</p>
        </div>
      )}
    </div>
  );
}
