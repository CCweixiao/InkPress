"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { QuickAddDialog } from "@/components/tasks/QuickAddDialog";
import type { TaskPriority } from "@/components/tasks/types";

export default function TasksPage() {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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

  const handleQuickAdd = async (data: { title: string; priority: TaskPriority; dueDate: string | null }) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setRefreshKey((k) => k + 1);
      return true;
    }
    return false;
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <CheckSquare className="h-5 w-5 text-primary" />
              <h1 className="font-semibold text-lg">任务</h1>
            </div>
          </div>

          <Button
            onClick={() => setQuickAddOpen(true)}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            新建任务
            <kbd className="ml-1 text-[10px] opacity-60 hidden sm:inline">⌘⇧T</kbd>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">
        <TaskPanel key={refreshKey} />
      </main>

      {/* Quick Add Dialog */}
      <QuickAddDialog
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        onAdd={handleQuickAdd}
      />
    </div>
  );
}
