"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, CheckSquare, Menu, ListPlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { TaskSidebar, type SelectedKey } from "@/components/tasks/TaskSidebar";

/** 计算默认选中的清单：第一个文件夹的第一个清单优先，否则第一个独立清单。 */
function pickFirstList(
  folders: { lists?: { id: string }[] }[],
  standaloneLists: { id: string }[]
): string | null {
  for (const f of folders) {
    if (f.lists && f.lists.length > 0) return f.lists[0].id;
  }
  if (standaloneLists.length > 0) return standaloneLists[0].id;
  return null;
}

export default function TasksPage() {
  const refreshKey = 0;
  const [selected, setSelected] = useState<SelectedKey>({ type: "all" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  // null = 尚未加载完成；true = 有清单；false = 完全没有清单/文件夹
  const [hasAnyList, setHasAnyList] = useState<boolean | null>(null);
  // 递增信号：请求侧边栏打开「新建清单」对话框
  const [createListSignal, setCreateListSignal] = useState(0);
  // 递增信号：清单配置（viewMode/groupMode/sections 等）变更后通知 TaskPanel 重新加载
  const [listConfigVersion, setListConfigVersion] = useState(0);

  // 初始加载：自动定位到第一个清单，避免「所有任务」风暴
  const initLoad = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/folders");
      if (!res.ok) return;
      const data = await res.json();
      const folders = (data.folders ?? []) as { lists?: { id: string }[] }[];
      const standaloneLists = (data.standaloneLists ?? []) as { id: string }[];
      const firstId = pickFirstList(folders, standaloneLists);
      if (firstId) {
        setSelected({ type: "list", id: firstId });
        setHasAnyList(true);
      } else {
        setHasAnyList(false);
      }
    } catch {
      setHasAnyList(false);
    }
  }, []);

  useEffect(() => {
    void initLoad();
  }, [initLoad]);

  const handleSelectTask = (taskId: string, listId: string) => {
    setSelected({ type: "list", id: listId });
    setHighlightTaskId(taskId);
  };

  // 选中态映射：list → listId；folder → folderId；tag → tagId；trash → view=trash
  const listId = selected.type === "list" ? selected.id : undefined;
  const folderId = selected.type === "folder" ? selected.id : undefined;
  const tagId = selected.type === "tag" ? selected.id : undefined;
  const view: "main" | "trash" = selected.type === "trash" ? "trash" : "main";

  // 侧边栏树变更后同步 hasAnyList + 空态自动选中 + 通知 TaskPanel 重载清单配置
  const handleTreeChanged = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks/folders");
      if (!res.ok) return;
      const data = await res.json();
      const folders = (data.folders ?? []) as { lists?: { id: string }[] }[];
      const standaloneLists = (data.standaloneLists ?? []) as { id: string }[];
      const firstId = pickFirstList(folders, standaloneLists);
      setHasAnyList(firstId !== null);
      // 当前没有选中具体清单时，自动切到第一个
      if (firstId && selected.type !== "list" && selected.type !== "folder" && selected.type !== "tag") {
        setSelected({ type: "list", id: firstId });
      }
    } catch {
      /* ignore */
    }
    // 清单配置可能已变更（viewMode/groupMode/sections），通知 TaskPanel 重新加载
    setListConfigVersion((v) => v + 1);
  }, [selected.type]);

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
          <TaskSidebar
            selected={selected}
            onSelect={setSelected}
            onSelectTask={handleSelectTask}
            refreshKey={refreshKey}
            createListSignal={createListSignal}
            onTreeChanged={handleTreeChanged}
          />
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
                createListSignal={createListSignal}
                onTreeChanged={handleTreeChanged}
              />
            </div>
          </div>
        )}

        {/* Main */}
        <main className="flex-1 min-w-0 overflow-hidden bg-background">
          {hasAnyList === false ? (
            <EmptyTasksState onCreateList={() => setCreateListSignal((n) => n + 1)} />
          ) : hasAnyList === null ? (
            <div className="h-full flex items-center justify-center">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : (
            <TaskPanel
              key={refreshKey}
              listId={listId}
              folderId={folderId}
              tagId={tagId}
              highlightTaskId={highlightTaskId ?? undefined}
              onHighlightConsumed={() => setHighlightTaskId(null)}
              view={view}
              listConfigVersion={listConfigVersion}
            />
          )}
        </main>
      </div>

    </div>
  );
}

/** 空状态：没有任何清单/文件夹时引导用户创建。 */
function EmptyTasksState({ onCreateList }: { onCreateList: () => void }) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="flex flex-col items-center text-center max-w-md animate-[fadeIn_0.3s_ease-out]">
        <div className="relative mb-6">
          <div className="absolute inset-0 blur-2xl bg-primary/20 rounded-full" />
          <div className="relative h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ListPlus className="h-9 w-9 text-primary" />
          </div>
        </div>
        <h2 className="text-xl font-semibold tracking-tight mb-2">
          还没有清单
        </h2>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          创建你的第一个任务清单来开始管理任务。可以按项目、场景或任何你喜欢的维度来组织。
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <Button onClick={onCreateList} className="gap-2">
            <ListPlus className="h-4 w-4" />
            创建第一个清单
          </Button>
        </div>
        <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span>清单创建后即可在里面添加任务</span>
        </div>
      </div>
    </div>
  );
}
