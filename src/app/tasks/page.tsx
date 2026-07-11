"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, CheckSquare, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { QuickAddDialog } from "@/components/tasks/QuickAddDialog";
import { TaskSidebar, type SelectedKey } from "@/components/tasks/TaskSidebar";
import type { TaskPriority } from "@/components/tasks/types";

export default function TasksPage() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<SelectedKey>({ type: "all" });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global keyboard shortcut for quick add
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setQuickAddOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleQuickAdd = async (data: {
    title: string;
    priority: TaskPriority;
    dueDate: string | null;
    tagIds: string[];
    listId?: string;
  }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, listId: data.listId ?? null }),
    });
    if (res.ok) {
      setRefreshKey((k) => k + 1);
      return true;
    }
    return false;
  };

  // 选中态映射：list → 传 listId；folder → 传 folderId；trash → view=trash
  const listId = selected.type === "list" ? selected.id : undefined;
  const folderId = selected.type === "folder" ? selected.id : undefined;
  const view: "main" | "trash" = selected.type === "trash" ? "trash" : "main";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent md:hidden"
              title="菜单"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5 text-primary" />
              <h1 className="font-semibold text-lg">任务</h1>
            </div>
          </div>

          <Button onClick={() => setQuickAddOpen(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            新建任务
            <kbd className="ml-1 text-[10px] opacity-60 hidden sm:inline">⌘⇧T</kbd>
          </Button>
        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 mx-auto max-w-6xl w-full px-6">
        {/* Desktop sidebar */}
        <div className="hidden md:block">
          <TaskSidebar selected={selected} onSelect={setSelected} refreshKey={refreshKey} />
        </div>

        {/* Mobile sidebar drawer */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
            <div className="relative bg-background h-full">
              <TaskSidebar
                selected={selected}
                onSelect={(k) => {
                  setSelected(k);
                  setSidebarOpen(false);
                }}
                refreshKey={refreshKey}
              />
            </div>
          </div>
        )}

        {/* Main */}
        <main className="flex-1 py-6 min-w-0">
          <TaskPanel key={refreshKey} listId={listId} folderId={folderId} view={view} />
        </main>
      </div>

      {/* Quick Add Dialog */}
      <QuickAddDialog
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onAdd={handleQuickAdd}
      />
    </div>
  );
}
