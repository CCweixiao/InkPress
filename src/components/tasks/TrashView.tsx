"use client";

import { RotateCcw, Trash2, Inbox, Clock3 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { daysLeft } from "@/lib/tasks/trash-lifecycle";
import { useTasks } from "./use-tasks";

export function TrashView() {
  const { tasks, loading, restoreTask, purgeTask, clearTrash } = useTasks({ trashed: true });
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  const handlePurge = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: "彻底删除",
      description: `「${title}」将被永久删除，此操作不可撤销。`,
    });
    if (!ok) return;
    await purgeTask(id);
  };

  const handleClearTrash = async () => {
    const ok = await confirmDialog({
      title: "清空垃圾箱",
      description: "所有垃圾箱中的任务及其子任务将被永久删除，此操作不可撤销。",
    });
    if (ok) await clearTrash();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <Inbox className="h-8 w-8" />
        <p className="text-sm">垃圾箱是空的</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-7 py-6">
      <div className="mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full bg-muted-foreground/50" />
          <div>
            <h2 className="text-xl font-semibold tracking-tight">垃圾箱</h2>
            <p className="text-xs text-muted-foreground">任务将在 30 天后永久删除；恢复的清单任务会归入“收集箱”</p>
          </div>
          <button
            onClick={() => void handleClearTrash()}
            className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
            title="清空垃圾箱"
            aria-label="清空垃圾箱"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-background">
        {tasks.map((task) => {
        const left = daysLeft(task.expiresAt ? new Date(task.expiresAt) : null);
        return (
          <div
            key={task.id}
            className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-accent/50"
          >
            <span className="flex-1 text-sm truncate opacity-70 line-through">{task.title}</span>
            {task.list && (
              <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: task.list.color }} />
                {task.list.name}
              </span>
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
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {left !== null && <><Clock3 className="h-3 w-3" />还剩 {left} 天</>}
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
      </div>
      {confirmElement}
    </div>
  );
}
