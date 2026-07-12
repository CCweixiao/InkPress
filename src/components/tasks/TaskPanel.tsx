"use client";

import { useState, useEffect, useCallback } from "react";
import { useTasks } from "./use-tasks";
import { KanbanView } from "./KanbanView";
import { TagTaskListView } from "./TagTaskListView";
import { TrashView } from "./TrashView";
import { TaskDetailPanel } from "./TaskDetailPanel";
import type { Task, TaskGroupMode } from "./types";

interface TaskPanelProps {
  listId?: string;
  folderId?: string;
  tagId?: string;
  highlightTaskId?: string;
  onHighlightConsumed?: () => void;
  view?: "main" | "trash";
  /** 清单配置版本号：变更时强制重新加载 list 配置（groupMode/sections 等） */
  listConfigVersion?: number;
}

function findTaskById(tasks: Task[], id: string | null): Task | null {
  if (!id) return null;
  for (const task of tasks) {
    if (task.id === id) return task;
    const match = findTaskById(task.children ?? [], id);
    if (match) return match;
  }
  return null;
}

export function TaskPanel({ listId, folderId, tagId, highlightTaskId, onHighlightConsumed, view = "main", listConfigVersion }: TaskPanelProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [listName, setListName] = useState<string>("所有任务");
  const [groupMode, setGroupMode] = useState<TaskGroupMode>("custom");
  const [isCollectionList, setIsCollectionList] = useState(false);
  const { tasks, loading, createTask, updateTask, deleteTask, reorderTasks, toggleStatus, refetch } =
    useTasks({
      listId,
      folderId,
      tagId,
    });
  const selectedTask = findTaskById(tasks, selectedTaskId);

  const loadList = useCallback(() => {
    if (!listId) {
      setListName(folderId ? "文件夹任务" : tagId ? "标签任务" : "所有任务");
      setIsCollectionList(false);
      return;
    }
    return fetch(`/api/tasks/lists/${listId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data?.list) return;
        setListName(data.list.name);
        setIsCollectionList(data.list.name === "收集箱");
        if (data.list.name === "收集箱") setGroupMode("status");
      });
  }, [listId, folderId, tagId, listConfigVersion]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 清单打开时默认展示自定义分组；用户仍可在当前页面切换到按状态视图。
  useEffect(() => {
    setGroupMode("custom");
  }, [listId]);

  useEffect(() => {
    if (!highlightTaskId || loading || tasks.length === 0) return;
    // 等一帧让 DOM 完成渲染
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-task-id="${highlightTaskId}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "rounded-md", "animate-pulse");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary", "rounded-md", "animate-pulse");
        onHighlightConsumed?.();
      }, 2000);
    }, 100);
    return () => clearTimeout(timer);
  }, [highlightTaskId, loading, tasks, onHighlightConsumed]);

  if (view === "trash") {
    return <TrashView />;
  }

  const completedTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex h-full min-w-0">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden px-7 py-6">
        <div className="shrink-0 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-1 rounded-full bg-primary/70" />
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{listName}</h2>
              <p className="text-xs text-muted-foreground">{tasks.length} 个任务 · {completedTasks} 个已完成</p>
            </div>
          </div>
        </div>

        <div className="mt-4 min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : tagId ? (
            <TagTaskListView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onOpenTask={(task) => setSelectedTaskId(task.id)}
              selectedTaskId={selectedTaskId}
            />
          ) : (
            <KanbanView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onReorder={reorderTasks}
              onOpenTask={(task) => setSelectedTaskId(task.id)}
              selectedTaskId={selectedTaskId}
              fixedGroupMode={isCollectionList ? "status" : undefined}
              listId={listId}
              initialGroupMode={groupMode}
              onGroupModeChange={(mode) => {
                if (isCollectionList) return;
                setGroupMode(mode);
                if (listId) void fetch(`/api/tasks/lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupMode: mode }) });
              }}
              onTasksChanged={refetch}
              onSectionsChanged={loadList}
              onCreateTaskInSection={async (sectionId, title, priority, dueDate) => createTask({ title, priority, dueDate, listId: listId ?? undefined, sectionId })}
              onCreateTask={async (title, priority, dueDate, status) => createTask({ title, priority, dueDate, status, listId: listId ?? undefined })}
              onCreateSubtask={async (parent, title) => createTask({
                title,
                parentId: parent.id,
                listId: parent.listId,
                sectionId: parent.sectionId ?? null,
              })}
            />
          )}
        </div>
      </div>
      {selectedTask && (
        <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTaskId(null)} onUpdate={updateTask} onDelete={deleteTask} />
      )}
    </div>
  );
}
