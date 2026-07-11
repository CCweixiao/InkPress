"use client";

import { RotateCcw, Trash2, Inbox } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { daysLeft } from "@/lib/tasks/trash-lifecycle";
import { useTasks } from "./use-tasks";

export function TrashView() {
  const { tasks, loading, restoreTask, purgeTask } = useTasks({ trashed: true });
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  const handlePurge = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: "彻底删除",
      description: `「${title}」将被永久删除，此操作不可撤销。`,
    });
    if (!ok) return;
    await purgeTask(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <Inbox className="h-8 w-8" />
        <p className="text-sm">垃圾箱是空的</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {tasks.map((task) => {
        const left = daysLeft(task.expiresAt ? new Date(task.expiresAt) : null);
        return (
          <div
            key={task.id}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/50"
          >
            <span className="flex-1 text-sm truncate opacity-70 line-through">{task.title}</span>
            {task.space && (
              <span className="text-xs text-muted-foreground shrink-0">📁 {task.space.name}</span>
            )}
            <div className="flex gap-1 shrink-0">
              {task.tags?.map((t) => (
                <span
                  key={t.id}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: t.color }}
                  title={t.name}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {left !== null ? `还剩 ${left} 天` : ""}
            </span>
            <button
              onClick={() => restoreTask(task.id)}
              className="p-1 text-muted-foreground hover:text-primary rounded"
              title="恢复"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => handlePurge(task.id, task.title)}
              className="p-1 text-muted-foreground hover:text-red-500 rounded"
              title="彻底删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      {confirmElement}
    </div>
  );
}
