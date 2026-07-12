"use client";

import { useState, useEffect, useCallback } from "react";
import { List, LayoutGrid, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "./use-tasks";
import { TaskListView } from "./TaskListView";
import { KanbanView } from "./KanbanView";
import { CalendarView } from "./CalendarView";
import { TrashView } from "./TrashView";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { QuickAddInput } from "./QuickAddInput";
import type { ViewMode, TaskGroupMode, TaskSectionInfo } from "./types";

interface TaskPanelProps {
  listId?: string;
  folderId?: string;
  tagId?: string;
  highlightTaskId?: string;
  onHighlightConsumed?: () => void;
  view?: "main" | "trash";
  /** 清单配置版本号：变更时强制重新加载 list 配置（viewMode/groupMode/sections 等） */
  listConfigVersion?: number;
}

export function TaskPanel({ listId, folderId, tagId, highlightTaskId, onHighlightConsumed, view = "main", listConfigVersion }: TaskPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [listName, setListName] = useState<string>("所有任务");
  const [groupMode, setGroupMode] = useState<TaskGroupMode>("status");
  const [sections, setSections] = useState<TaskSectionInfo[]>([]);
  const [ungroupedName, setUngroupedName] = useState("未分组");
  const [ungroupedVisible, setUngroupedVisible] = useState(true);
  const { tasks, loading, createTask, updateTask, deleteTask, reorderTasks, toggleStatus, refetch } =
    useTasks({
      listId,
      folderId,
      tagId,
      status: statusFilter || undefined,
    });
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  const loadList = useCallback(() => {
    if (!listId) {
      setListName(folderId ? "文件夹任务" : tagId ? "标签任务" : "所有任务");
      setSections([]);
      return;
    }
    return fetch(`/api/tasks/lists/${listId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data?.list) return;
        setListName(data.list.name);
        setViewMode(data.list.viewMode as ViewMode);
        setGroupMode(data.list.groupMode === "custom" ? "custom" : "status");
        setSections(data.list.sections ?? []);
        setUngroupedName(data.list.ungroupedName ?? "未分组");
        setUngroupedVisible(data.list.ungroupedVisible ?? true);
      });
  }, [listId, folderId, tagId, listConfigVersion]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (listId) void fetch(`/api/tasks/lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ viewMode: mode }) });
  };

  const createTopLevelTask = async (title: string, priority: Parameters<typeof createTask>[0]["priority"], dueDate: string | null) => {
    if (groupMode === "custom" && !ungroupedVisible && sections.length === 0 && listId) {
      await fetch(`/api/tasks/lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ungroupedVisible: true }) });
      setUngroupedVisible(true);
    }
    await createTask({ title, priority, dueDate, listId: listId ?? undefined, sectionId: groupMode === "custom" && !ungroupedVisible ? sections[0]?.id ?? null : null });
  };

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

  const views: { mode: ViewMode; icon: React.ElementType; label: string }[] = [
    { mode: "list", icon: List, label: "列表" },
    { mode: "kanban", icon: LayoutGrid, label: "看板" },
    { mode: "calendar", icon: CalendarDays, label: "日历" },
  ];

  // 统计
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex h-full min-w-0">
    <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full bg-primary/70" />
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{listName}</h2>
          <p className="text-xs text-muted-foreground">{tasks.length} 个任务 · {completedTasks} 个已完成</p>
        </div>
      </div>
      {/* Header with view toggle and filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            {views.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => changeViewMode(mode)}
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

      <QuickAddInput onAdd={(title, priority, dueDate) => void createTopLevelTask(title, priority, dueDate)} />

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
              onOpenTask={(task) => setSelectedTaskId(task.id)}
              sections={sections.length > 0 ? sections : undefined}
              ungroupedName={ungroupedName}
              ungroupedVisible={ungroupedVisible}
              onReorder={reorderTasks}
              onCreateTaskInSection={async (sectionId, title, priority, dueDate) => createTask({ title, priority, dueDate, listId: listId ?? undefined, sectionId })}
            />
          )}
          {viewMode === "kanban" && (
            <KanbanView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onUpdate={updateTask}
              onDelete={deleteTask}
              onReorder={reorderTasks}
              onOpenTask={(task) => setSelectedTaskId(task.id)}
              listId={listId}
              initialGroupMode={groupMode}
              onGroupModeChange={(mode) => {
                setGroupMode(mode);
                if (listId) void fetch(`/api/tasks/lists/${listId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupMode: mode }) });
              }}
              onTasksChanged={refetch}
              onSectionsChanged={loadList}
              onCreateTaskInSection={async (sectionId, title, priority, dueDate) => createTask({ title, priority, dueDate, listId: listId ?? undefined, sectionId })}
            />
          )}
          {viewMode === "calendar" && (
            <CalendarView
              tasks={tasks}
              onToggleStatus={toggleStatus}
              onUpdate={updateTask}
              onOpenTask={(task) => setSelectedTaskId(task.id)}
            />
          )}
        </>
      )}
    </div>
    {selectedTask && (
      <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTaskId(null)} onUpdate={updateTask} onDelete={deleteTask} />
    )}
    </div>
  );
}
