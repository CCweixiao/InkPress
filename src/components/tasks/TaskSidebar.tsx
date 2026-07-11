"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  ListChecks,
  Menu,
  FolderOpen,
  FolderClosed,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Trash2,
  Tag as TagIcon,
  Plus,
  MoreHorizontal,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TagManageDialog } from "./TagManageDialog";
import { TaskFolderDialog } from "./TaskFolderDialog";
import { TaskListDialog } from "./TaskListDialog";
import { TagEditDialog, type TagInfo } from "./TagEditDialog";

export type SelectedKey =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "list"; id: string }
  | { type: "tag"; id: string }
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

interface TagNode extends TagInfo {
  children?: TagInfo[];
}

type Counts = {
  total: number;
  byList: Record<string, number>;
  byTag: Record<string, number>;
  trashed: number;
};

interface TaskSidebarProps {
  selected: SelectedKey;
  onSelect: (key: SelectedKey) => void;
  refreshKey?: number;
}

// ---------------------------------------------------------------------------
// arrayMove (lightweight inline copy, same semantics as @dnd-kit/sortable)
// ---------------------------------------------------------------------------
function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = arr.slice();
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

// ---------------------------------------------------------------------------
// Sortable wrapper: folder header row
// ---------------------------------------------------------------------------
function SortableFolderRow({
  folder,
  selected,
  folderTaskCount,
  onToggleCollapsed,
  onSelect,
  onAddList,
  onEditFolder,
}: {
  folder: TaskFolderInfo;
  selected: SelectedKey;
  folderTaskCount: number;
  onToggleCollapsed: () => void;
  onSelect: () => void;
  onAddList: () => void;
  onEditFolder: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id, data: { type: "folder" } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-1 w-full px-1 py-1 rounded-md text-sm transition-colors",
        selected.type === "folder" && selected.id === folder.id
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "opacity-50 z-10"
      )}
    >
      <button
        onClick={onToggleCollapsed}
        className="p-0.5 rounded hover:bg-accent"
        title={folder.collapsed ? "展开" : "收起"}
      >
        {folder.collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>
      {folder.collapsed ? (
        <FolderClosed className="h-4 w-4 shrink-0" />
      ) : (
        <FolderOpen className="h-4 w-4 shrink-0" />
      )}
      <button onClick={onSelect} className="flex-1 text-left truncate">
        {folder.name}
      </button>
      {folderTaskCount > 0 && (
        <span className="text-xs shrink-0">{folderTaskCount}</span>
      )}
      <button
        onClick={onAddList}
        className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
        title="往此文件夹加清单"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onEditFolder}
        className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100"
        title="编辑文件夹"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 touch-none"
        title="拖拽排序"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable wrapper: standalone (top-level) list row
// ---------------------------------------------------------------------------
function SortableListRow({
  list,
  count,
  isSelected,
  onSelect,
  onEdit,
  indent,
}: {
  list: TaskListInfo;
  count: number;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  indent?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id, data: { type: "list", folderId: list.folderId } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
        indent && "pl-8",
        isSelected
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "opacity-50 z-10"
      )}
      onClick={onSelect}
    >
      <Menu className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left truncate">{list.name}</span>
      {count > 0 && <span className="text-xs shrink-0">{count}</span>}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
        title="编辑清单"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 touch-none"
        title="拖拽排序"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ===========================================================================
// Main sidebar
// ===========================================================================
export function TaskSidebar({ selected, onSelect, refreshKey }: TaskSidebarProps) {
  const [folders, setFolders] = useState<TaskFolderInfo[]>([]);
  const [standaloneLists, setStandaloneLists] = useState<TaskListInfo[]>([]);
  const [counts, setCounts] = useState<Counts>({
    total: 0,
    byList: {},
    byTag: {},
    trashed: 0,
  });
  const [tagOpen, setTagOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [listDialogFolderId, setListDialogFolderId] = useState<string | null>(
    null
  );
  const [editFolder, setEditFolder] = useState<TaskFolderInfo | null>(null);
  const [editList, setEditList] = useState<TaskListInfo | null>(null);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [collapsedTagIds, setCollapsedTagIds] = useState<Set<string>>(new Set());
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [editTag, setEditTag] = useState<TagInfo | null>(null);
  const [tagDialogParentId, setTagDialogParentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [treeRes, countRes, tagsRes] = await Promise.all([
      fetch("/api/tasks/folders"),
      fetch("/api/tasks/counts"),
      fetch("/api/tags"),
    ]);
    if (treeRes.ok) {
      const data = await treeRes.json();
      setFolders(data.folders ?? []);
      setStandaloneLists(data.standaloneLists ?? []);
    }
    if (countRes.ok) {
      const c = await countRes.json();
      setCounts({
        total: c.total,
        byList: c.byList ?? {},
        byTag: c.byTag ?? {},
        trashed: c.trashed,
      });
    }
    if (tagsRes.ok) {
      const data = await tagsRes.json();
      setTags(data.tags ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const modifiers = useMemo(() => [restrictToVerticalAxis], []);

  const toggleCollapsed = async (folder: TaskFolderInfo) => {
    // 乐观更新
    setFolders((fs) =>
      fs.map((f) =>
        f.id === folder.id ? { ...f, collapsed: !f.collapsed } : f
      )
    );
    await fetch(`/api/tasks/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collapsed: !folder.collapsed }),
    });
  };

  const folderTaskCount = (f: TaskFolderInfo) =>
    f.lists.reduce((sum, l) => sum + (counts.byList[l.id] ?? 0), 0);

  const tagTree = useMemo<TagNode[]>(() => {
    const roots = tags.filter((t) => t.parentId === null);
    return roots.map((r) => ({
      ...r,
      children: tags
        .filter((t) => t.parentId === r.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [tags]);

  const tagCount = (t: TagInfo): number => {
    const direct = counts.byTag[t.id] ?? 0;
    if (t.parentId === null) {
      // 一级：加所有子标签
      const children = tags.filter((c) => c.parentId === t.id);
      return direct + children.reduce((sum, c) => sum + (counts.byTag[c.id] ?? 0), 0);
    }
    return direct;
  };

  const parentTagOptions = tags.filter((t) => t.parentId === null);

  const toggleTagCollapsed = (id: string) => {
    setCollapsedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openTagDialog = (parentId: string | null) => {
    setEditTag(null);
    setTagDialogParentId(parentId);
    setTagDialogOpen(true);
  };

  const editTagHandler = (t: TagInfo) => {
    setEditTag(t);
    setTagDialogParentId(null);
    setTagDialogOpen(true);
  };

  const allFoldersExpanded =
    folders.length > 0 && folders.every((f) => !f.collapsed);

  const toggleAllFoldersCollapsed = async () => {
    const nextCollapsed = allFoldersExpanded;
    setFolders((fs) => fs.map((f) => ({ ...f, collapsed: nextCollapsed })));
    await fetch("/api/tasks/folders/collapse-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collapsed: nextCollapsed }),
    });
  };

  const openListDialog = (folderId: string | null) => {
    setListDialogFolderId(folderId);
    setListDialogOpen(true);
  };

  // -------------------------------------------------------------------------
  // Folder DnD: reorder top-level folders only (no nesting allowed)
  // -------------------------------------------------------------------------
  const handleFolderDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      setFolders((prev) => {
        const oldIndex = prev.findIndex((f) => f.id === active.id);
        const newIndex = prev.findIndex((f) => f.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return prev;
        const reordered = arrayMove(prev, oldIndex, newIndex);
        // Persist new sortOrder
        const payload = reordered.map((f, i) => ({ id: f.id, sortOrder: i }));
        fetch("/api/tasks/folders/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: payload }),
        }).catch((err) => console.error("folder reorder failed:", err));
        return reordered;
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // List DnD: reorder within same parent group only.
  // standaloneLists share one SortableContext; each folder.lists gets its own.
  // Because cross-parent is YAGNI for this task, onDragEnd checks if active
  // and over belong to the same group; if not, the drag is ignored.
  // -------------------------------------------------------------------------
  const handleListDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // --- Try standalone lists group ---
      setStandaloneLists((prevStandalone) => {
        const oldIdx = prevStandalone.findIndex((l) => l.id === activeId);
        const newIdx = prevStandalone.findIndex((l) => l.id === overId);
        if (oldIdx >= 0 && newIdx >= 0) {
          const reordered = arrayMove(prevStandalone, oldIdx, newIdx);
          const payload = reordered.map((l, i) => ({
            id: l.id,
            sortOrder: i,
          }));
          fetch("/api/tasks/lists/reorder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: payload }),
          }).catch((err) => console.error("list reorder failed:", err));
          return reordered;
        }
        return prevStandalone; // not in this group — fall through
      });

      // --- Try folder child lists groups ---
      setFolders((prevFolders) => {
        let changed = false;
        const next = prevFolders.map((folder) => {
          const oldIdx = folder.lists.findIndex((l) => l.id === activeId);
          const newIdx = folder.lists.findIndex((l) => l.id === overId);
          if (oldIdx >= 0 && newIdx >= 0) {
            changed = true;
            const reordered = arrayMove(folder.lists, oldIdx, newIdx);
            const payload = reordered.map((l, i) => ({
              id: l.id,
              sortOrder: i,
            }));
            fetch("/api/tasks/lists/reorder", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: payload }),
            }).catch((err) => console.error("list reorder failed:", err));
            return { ...folder, lists: reordered };
          }
          return folder;
        });
        return changed ? next : prevFolders;
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <aside className="w-60 shrink-0 border-r border-border flex flex-col gap-1 p-3 h-full">
      <button
        onClick={() => onSelect({ type: "all" })}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
          selected.type === "all"
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        )}
      >
        <ListChecks className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">全部任务</span>
        {counts.total > 0 && (
          <span className="text-xs shrink-0">{counts.total}</span>
        )}
      </button>

      <div className="h-px bg-border my-1" />

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">清单</span>
        <div className="flex items-center gap-1">
          {folders.length > 0 && (
            <button
              onClick={toggleAllFoldersCollapsed}
              className="p-0.5 rounded hover:bg-accent text-muted-foreground"
              title={allFoldersExpanded ? "折叠全部文件夹" : "展开全部文件夹"}
            >
              {allFoldersExpanded ? (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
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

      {/* ============================================= List DnD context =====
          One DndContext for ALL lists. Inside we have:
            - SortableContext for standalone (top-level) lists
            - SortableContext for each folder's child lists (when expanded)
          Cross-group moves are ignored in onDragEnd (YAGNI per plan).
      ====================================================================== */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleListDragEnd}
        modifiers={modifiers}
      >
        {/* 顶层独立清单 */}
        <SortableContext
          id="standalone-lists"
          items={standaloneLists.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {standaloneLists.map((list) => (
            <SortableListRow
              key={list.id}
              list={list}
              count={counts.byList[list.id] ?? 0}
              isSelected={
                selected.type === "list" && selected.id === list.id
              }
              onSelect={() => onSelect({ type: "list", id: list.id })}
              onEdit={() => {
                setEditFolder(null);
                setEditList(list);
              }}
            />
          ))}
        </SortableContext>

        {/* 文件夹（含内部清单）— 整个 folder 区域用一个独立的 folders DnD context */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragEnd={handleFolderDragEnd}
          modifiers={modifiers}
        >
          <SortableContext
            id="folders"
            items={folders.map((f) => f.id)}
            strategy={verticalListSortingStrategy}
          >
            {folders.map((folder) => (
              <div key={folder.id} className="space-y-0.5">
                <SortableFolderRow
                  folder={folder}
                  selected={selected}
                  folderTaskCount={folderTaskCount(folder)}
                  onToggleCollapsed={() => toggleCollapsed(folder)}
                  onSelect={() =>
                    onSelect({ type: "folder", id: folder.id })
                  }
                  onAddList={() => openListDialog(folder.id)}
                  onEditFolder={() => setEditFolder(folder)}
                />
                {!folder.collapsed && (
                  <SortableContext
                    id={`folder-${folder.id}-lists`}
                    items={folder.lists.map((l) => l.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {folder.lists.map((list) => (
                      <SortableListRow
                        key={list.id}
                        list={list}
                        count={counts.byList[list.id] ?? 0}
                        isSelected={
                          selected.type === "list" &&
                          selected.id === list.id
                        }
                        onSelect={() =>
                          onSelect({ type: "list", id: list.id })
                        }
                        onEdit={() => {
                          setEditFolder(null);
                          setEditList(list);
                        }}
                        indent
                      />
                    ))}
                  </SortableContext>
                )}
              </div>
            ))}
          </SortableContext>
        </DndContext>
      </DndContext>

      <div className="h-px bg-border my-1" />

      <div className="flex items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">标签</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => openTagDialog(null)}
            className="p-0.5 rounded hover:bg-accent text-muted-foreground"
            title="新建一级标签"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {tagTree.map((tag) => {
        const isSelected = selected.type === "tag" && selected.id === tag.id;
        const isCollapsed = collapsedTagIds.has(tag.id);
        const hasChildren = (tag.children?.length ?? 0) > 0;
        const count = tagCount(tag);
        return (
          <div key={tag.id} className="space-y-0.5">
            <div
              className={cn(
                "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
                isSelected
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
              onClick={() => onSelect({ type: "tag", id: tag.id })}
            >
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleTagCollapsed(tag.id);
                  }}
                  className="p-0.5 rounded hover:bg-accent"
                  title={isCollapsed ? "展开" : "收起"}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="w-5" />
              )}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <span className="flex-1 text-left truncate">{tag.name}</span>
              {count > 0 && <span className="text-xs shrink-0">{count}</span>}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openTagDialog(tag.id);
                }}
                className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
                title="新建子标签"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  editTagHandler(tag);
                }}
                className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
                title="编辑标签"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
            {hasChildren && !isCollapsed && (
              <div className="pl-6 space-y-0.5">
                {tag.children!.map((child) => {
                  const childSelected =
                    selected.type === "tag" && selected.id === child.id;
                  const childCount = tagCount(child);
                  return (
                    <div
                      key={child.id}
                      className={cn(
                        "group flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
                        childSelected
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      )}
                      onClick={() => onSelect({ type: "tag", id: child.id })}
                    >
                      <span className="w-5" />
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: child.color }}
                      />
                      <span className="flex-1 text-left truncate">{child.name}</span>
                      {childCount > 0 && (
                        <span className="text-xs shrink-0">{childCount}</span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          editTagHandler(child);
                        }}
                        className="p-0.5 rounded hover:bg-accent opacity-0 group-hover:opacity-100 shrink-0"
                        title="编辑标签"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <div className="h-px bg-border my-1" />

      <button
        onClick={() => onSelect({ type: "trash" })}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm transition-colors",
          selected.type === "trash"
            ? "bg-accent text-accent-foreground font-medium"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        )}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">垃圾箱</span>
        {counts.trashed > 0 && (
          <span className="text-xs shrink-0">{counts.trashed}</span>
        )}
      </button>

      <div className="flex-1" />

      <button
        onClick={() => setTagOpen(true)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
      >
        <TagIcon className="h-4 w-4 shrink-0" />
        标签管理
      </button>

      <TagManageDialog open={tagOpen} onOpenChange={setTagOpen} />
      <TaskFolderDialog
        open={folderDialogOpen || editFolder !== null}
        onOpenChange={(o) => {
          if (!o) {
            setFolderDialogOpen(false);
            setEditFolder(null);
          }
        }}
        onSaved={load}
        folder={editFolder}
      />
      <TaskListDialog
        open={listDialogOpen || editList !== null}
        onOpenChange={(o) => {
          if (!o) {
            setListDialogOpen(false);
            setEditList(null);
          }
        }}
        folderId={listDialogFolderId}
        folders={folders.map((f) => ({ id: f.id, name: f.name }))}
        onSaved={load}
        list={editList}
      />
      <TagEditDialog
        open={tagDialogOpen || editTag !== null}
        onOpenChange={(o) => {
          if (!o) {
            setTagDialogOpen(false);
            setEditTag(null);
          }
        }}
        tag={editTag}
        defaultParentId={tagDialogParentId}
        parentOptions={parentTagOptions}
        onSaved={load}
      />
    </aside>
  );
}
