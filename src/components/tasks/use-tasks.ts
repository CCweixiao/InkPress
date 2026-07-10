"use client";

import { useState, useCallback, useEffect } from "react";
import type { Task, TaskStatus, TaskPriority } from "./types";

export function useTasks(initialFilters?: {
  status?: string;
  spaceId?: string;
  smartView?: "today" | "next7days" | "inbox";
  trashed?: boolean;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (initialFilters?.status) params.set("status", initialFilters.status);
    if (initialFilters?.spaceId) params.set("spaceId", initialFilters.spaceId);
    if (initialFilters?.smartView) params.set("smartView", initialFilters.smartView);
    if (initialFilters?.trashed) params.set("trashed", "true");
    if (!initialFilters?.trashed) params.set("parentId", "null"); // 顶层任务（主视图）

    const res = await fetch(`/api/tasks?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks);
    }
    setLoading(false);
  }, [initialFilters?.status, initialFilters?.spaceId, initialFilters?.smartView, initialFilters?.trashed]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const createTask = useCallback(
    async (data: {
      title: string;
      priority?: TaskPriority;
      dueDate?: string | null;
      parentId?: string | null;
      spaceId?: string | null;
      tagIds?: string[];
    }) => {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchTasks();
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
        Pick<Task, "title" | "content" | "status" | "priority" | "dueDate" | "sortOrder" | "tagsJson" | "isCollapsed" | "parentId"> & { tagIds?: string[] }
      >
    ) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchTasks();
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
        return true;
      }
      return false;
    },
    [fetchTasks]
  );

  const reorderTasks = useCallback(
    async (items: { id: string; sortOrder: number; parentId?: string | null; status?: string }[]) => {
      const res = await fetch("/api/tasks/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        await fetchTasks();
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
    reorderTasks,
    toggleStatus,
    refetch: fetchTasks,
  };
}
