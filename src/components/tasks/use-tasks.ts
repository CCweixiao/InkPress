"use client";

import { useState, useCallback, useEffect } from "react";
import type { Task, TaskStatus, TaskPriority } from "./types";

export function useTasks(initialFilters?: {
  status?: string;
  listId?: string;
  folderId?: string;
  tagId?: string;
  smartView?: "today" | "next7days";
  trashed?: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const notifyTasksChanged = () => {
    window.dispatchEvent(new Event("tasks:changed"));
  };

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (initialFilters?.status) params.set("status", initialFilters.status);
    if (initialFilters?.listId) params.set("listId", initialFilters.listId);
    if (initialFilters?.folderId) params.set("folderId", initialFilters.folderId);
    if (initialFilters?.tagId) params.set("tagId", initialFilters.tagId);
    if (initialFilters?.smartView) params.set("smartView", initialFilters.smartView);
    if (initialFilters?.trashed) params.set("trashed", "true");
    if (!initialFilters?.trashed && !initialFilters?.tagId) params.set("parentId", "null"); // 标签视图需要返回所有命中的任务

    const res = await fetch(`/api/tasks?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks);
    }
    setLoading(false);
  }, [initialFilters?.status, initialFilters?.listId, initialFilters?.folderId, initialFilters?.tagId, initialFilters?.smartView, initialFilters?.trashed]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(
    async (data: {
      title: string;
      priority?: TaskPriority;
      dueDate?: string | null;
      parentId?: string | null;
      listId?: string | null;
      sectionId?: string | null;
      status?: TaskStatus;
      tagIds?: string[];
    }) => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchTasks();
        notifyTasksChanged();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const updateTask = useCallback(
    async (
      id: string,
      data: Partial<
        Pick<Task, "title" | "content" | "status" | "priority" | "dueDate" | "sortOrder" | "tagsJson" | "isCollapsed" | "parentId" | "listId" | "sectionId"> & { tagIds?: string[] }
      >
    ) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchTasks();
        notifyTasksChanged();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        await fetchTasks();
        notifyTasksChanged();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const restoreTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}/restore`, { method: "POST" });
      if (res.ok) {
        await fetchTasks();
        notifyTasksChanged();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const purgeTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/tasks/${id}/purge`, { method: "DELETE" });
      if (res.ok) {
        await fetchTasks();
        notifyTasksChanged();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const clearTrash = useCallback(async () => {
    const res = await fetch("/api/tasks/trash", { method: "DELETE" });
    if (res.ok) {
      await fetchTasks();
      notifyTasksChanged();
      return true;
    }
    return false;
  }, [fetchTasks]);

  const reorderTasks = useCallback(
    async (items: { id: string; sortOrder: number; parentId?: string | null; sectionId?: string | null; status?: string }[]) => {
      const res = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        await fetchTasks();
        notifyTasksChanged();
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const toggleStatus = useCallback(
    async (id: string, currentStatus: TaskStatus) => {
      const newStatus: TaskStatus = currentStatus === "done" ? "todo" : "done";
      return updateTask(id, { status: newStatus });
    },
    [updateTask]
  );

  return {
    tasks,
    loading,
    createTask,
    updateTask,
    deleteTask,
    restoreTask,
    purgeTask,
    clearTrash,
    reorderTasks,
    toggleStatus,
    refetch: fetchTasks,
  };
}
