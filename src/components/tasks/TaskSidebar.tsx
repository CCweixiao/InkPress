"use client";

import { useState, useEffect, useCallback } from "react";
import { ListChecks, FolderOpen, FolderClosed, ChevronRight, ChevronDown, Trash2, Tag as TagIcon, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagManageDialog } from "./TagManageDialog";
import { TaskFolderDialog } from "./TaskFolderDialog";
import { TaskListDialog } from "./TaskListDialog";

export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "trash" };

interface TaskListInfo {
  id: string;
  name: string;
  color: string;
  folderId: string | null;
}
interface TaskFolderInfo {
  id: string;
  name: string;
  collapsed: boolean;
  sortOrder: number;
  lists: TaskListInfo[];
}

type Counts = {
  total: number;
  byList: Record<string, number>;
  trashed: number;
};

interface TaskSidebarProps {
  selected: SelectedKey;
  onSelect: (key: SelectedKey) => void;
  refreshKey?: number;
}

export function TaskSidebar({ selected, onSelect, refreshKey }: TaskSidebarProps) {
  const [folders, setFolders] = useState<TaskFolderInfo[]>([]);
  const [standaloneLists, setStandaloneLists] = useState<TaskListInfo[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, byList: {}, trashed: 0 });
  const [tagOpen, setTagOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [listDialogFolderId, setListDialogFolderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [treeRes, countRes] = await Promise.all([
      fetch("/api/tasks/folders"),
      fetch("/api/tasks/counts"),
    ]);
    if (treeRes.ok) {
      const data = await treeRes.json();
      setFolders(data.folders ?? []);
      setStandaloneLists(data.standaloneLists ?? []);
    }
    if (countRes.ok) {
      const c = await countRes.json();
      setCounts({ total: c.total, byList: c.byList ?? {}, trashed: c.trashed });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const toggleCollapsed = async (folder: TaskFolderInfo) => {
    // 乐观更新
    setFolders((fs) =>
      fs.map((f) => (f.id === folder.id ? { ...f, collapsed: !f.collapsed } : f))
    );
    await fetch(`/api/tasks/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collapsed: !folder.collapsed }),
    });
  };

  const folderTaskCount = (f: TaskFolderInfo) =>
    f.lists.reduce((sum, l) => sum + (counts.byList[l.id] ?? 0), 0);

  const openListDialog = (folderId: string | null) => {
    setListDialogFolderId(folderId);
    setListDialogOpen(true);
  };

  return (
    <aside className="w-60 shrink-0 border-r border-border flex flex-col gap-1 p-3 h-full">
      <button
        onClick={() => onSelect({ type: "all" })}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
          selected.type === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <ListChecks className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">全部任务</span>
        {counts.total > 0 && <span className="text-xs shrink-0">{counts.total}</span>}
      </button>

      <div className="h-px bg-border my-1" />

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">清单</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFolderDialogOpen(true)}
            className="p-0.5 rounded hover:bg-accent text-muted-foreground"
            title="新建文件夹"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => openListDialog(null)}
            className="p-0.5 rounded hover:bg-accent text-muted-foreground"
            title="新建清单"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 顶层独立清单 */}
      {standaloneLists.map((list) => (
        <button
          key={list.id}
          onClick={() => onSelect({ type: "list", id: list.id })}
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
            selected.type === "list" && selected.id === list.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
          <span className="flex-1 text-left truncate">{list.name}</span>
          {(counts.byList[list.id] ?? 0) > 0 && (
            <span className="text-xs shrink-0">{counts.byList[list.id]}</span>
          )}
        </button>
      ))}

      {/* 文件夹 */}
      {folders.map((folder) => (
        <div key={folder.id} className="space-y-0.5">
          <div
            className={cn(
              "group flex items-center gap-1 w-full px-1 py-1 rounded-md text-sm transition-colors",
              selected.type === "folder" && selected.id === folder.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <button
              onClick={() => toggleCollapsed(folder)}
              className="p-0.5 rounded hover:bg-accent"
              title={folder.collapsed ? "展开" : "收起"}
            >
              {folder.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {folder.collapsed ? <FolderClosed className="h-4 w-4 shrink-0" /> : <FolderOpen className="h-4 w-4 shrink-0" />}
            <button
              onClick={() => onSelect({ type: "folder", id: folder.id })}
              className="flex-1 text-left truncate"
            >
              {folder.name}
            </button>
            {folderTaskCount(folder) > 0 && (
              <span className="text-xs shrink-0">{folderTaskCount(folder)}</span>
            )}
            <button
              onClick={() => openListDialog(folder.id)}
              className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
              title="往此文件夹加清单"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {!folder.collapsed &&
            folder.lists.map((list) => (
              <button
                key={list.id}
                onClick={() => onSelect({ type: "list", id: list.id })}
                className={cn(
                  "flex items-center gap-2 w-full pl-8 pr-2 py-1.5 rounded-md text-sm transition-colors",
                  selected.type === "list" && selected.id === list.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
                <span className="flex-1 text-left truncate">{list.name}</span>
                {(counts.byList[list.id] ?? 0) > 0 && (
                  <span className="text-xs shrink-0">{counts.byList[list.id]}</span>
                )}
              </button>
            ))}
        </div>
      ))}

      <div className="h-px bg-border my-1" />

      <button
        onClick={() => onSelect({ type: "trash" })}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
          selected.type === "trash" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">垃圾箱</span>
        {counts.trashed > 0 && <span className="text-xs shrink-0">{counts.trashed}</span>}
      </button>

      <div className="flex-1" />

      <button
        onClick={() => setTagOpen(true)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        标签管理
      </button>

      <TagManageDialog open={tagOpen} onOpenChange={setTagOpen} />
      <TaskFolderDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        onSaved={load}
      />
      <TaskListDialog
        open={listDialogOpen}
        onOpenChange={setListDialogOpen}
        folderId={listDialogFolderId}
        onSaved={load}
      />
    </aside>
  );
}
