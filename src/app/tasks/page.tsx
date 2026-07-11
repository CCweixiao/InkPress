"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckSquare, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { TaskSidebar, type SelectedKey } from "@/components/tasks/TaskSidebar";

export default function TasksPage() {
  const refreshKey = 0;
  const [selected, setSelected] = useState<SelectedKey>({ type: "all" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);

  const handleSelectTask = (taskId: string, listId: string) => {
    setSelected({ type: "list", id: listId });
    setHighlightTaskId(taskId);
  };

  // 选中态映射：list → listId；folder → folderId；tag → tagId；trash → view=trash
  const listId = selected.type === "list" ? selected.id : undefined;
  const folderId = selected.type === "folder" ? selected.id : undefined;
  const tagId = selected.type === "tag" ? selected.id : undefined;
  const view: "main" | "trash" = selected.type === "trash" ? "trash" : "main";

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur shrink-0 z-40">
        <div className="px-5 h-14 flex items-center gap-4">
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

        </div>
      </header>

      {/* Body: sidebar + main */}
      <div className="flex flex-1 min-h-0 w-full bg-muted/15">
        {/* Desktop sidebar */}
        <div className="hidden md:block h-full">
          <TaskSidebar selected={selected} onSelect={setSelected} onSelectTask={handleSelectTask} refreshKey={refreshKey} />
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
                onSelectTask={(taskId, listId) => {
                  handleSelectTask(taskId, listId);
                  setSidebarOpen(false);
                }}
                refreshKey={refreshKey}
              />
            </div>
          </div>
        )}

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-hidden bg-background">
          <TaskPanel
            key={refreshKey}
            listId={listId}
            folderId={folderId}
            tagId={tagId}
            highlightTaskId={highlightTaskId ?? undefined}
            onHighlightConsumed={() => setHighlightTaskId(null)}
            view={view}
          />
        </main>
      </div>

    </div>
  );
}
