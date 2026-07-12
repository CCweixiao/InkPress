"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  MeasuringStrategy,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import {
  Check,
  Circle,
  Clock,
  Archive,
  Calendar,
  AlertTriangle,
  CalendarOff,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  GripVertical,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Task, TaskStatus, TaskGroupMode, TaskSectionInfo } from "./types";
import { PRIORITY_CONFIG } from "./types";
import type { TaskPriority } from "./types";
import { QuickAddInput } from "./QuickAddInput";
import { getUngroupedPosition, setUngroupedPosition } from "@/lib/tasks/section-order";

interface KanbanViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onReorder: (items: { id: string; sortOrder: number; sectionId?: string | null; status?: string }[]) => Promise<boolean>;
  onOpenTask: (task: Task) => void;
  listId?: string;
  initialGroupMode?: TaskGroupMode;
  onGroupModeChange?: (mode: TaskGroupMode) => void;
  onTasksChanged?: () => Promise<void>;
  onSectionsChanged?: () => Promise<void> | void;
  onCreateTaskInSection?: (sectionId: string | null, title: string, priority?: TaskPriority, dueDate?: string | null) => Promise<boolean>;
}

// ===== 分组模式 =====
type GroupMode = TaskGroupMode;

/** 每个清单最多支持的分组数 */
const MAX_SECTIONS = 10;

// ===== 按状态分组的列配置 =====
const STATUS_COLUMNS: { status: TaskStatus; icon: React.ElementType; label: string; accent: string }[] = [
  { status: "todo", icon: Circle, label: "待办", accent: "text-slate-500" },
  { status: "in_progress", icon: Clock, label: "进行中", accent: "text-blue-500" },
  { status: "done", icon: Check, label: "已完成", accent: "text-green-500" },
  { status: "archived", icon: Archive, label: "已归档", accent: "text-gray-400" },
];

// ===== ISO 周计算工具 =====
/** 返回 ISO 周号 { year, week } */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** 返回某 ISO 周的周一（本地时间 00:00） */
function getMondayOfISOWeek(year: number, week: number): Date {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const monday = new Date(simple);
  const dow = simple.getDay();
  if (dow <= 4) monday.setDate(simple.getDate() - simple.getDay() + 1);
  else monday.setDate(simple.getDate() + 8 - simple.getDay());
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** 格式化日期为 M/D */
function fmtShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ===== 卡片组件 =====
function KanbanCard({ task, onToggleStatus }: { task: Task; onToggleStatus?: (id: string, status: TaskStatus) => void }) {
  const isDone = task.status === "done" || task.status === "archived";
  const isOverdue =
    task.dueDate && !isDone && new Date(task.dueDate) < new Date(new Date().toDateString());
  const listColor = task.list?.color;
  const priorityConfig = PRIORITY_CONFIG[task.priority as TaskPriority];

  const totalChildren = task.children?.length ?? 0;
  const completedChildren = task.children?.filter((c) => c.status === "done").length ?? 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleStatus?.(task.id, task.status);
  };

  return (
    <div
      className={cn(
        "relative bg-background border border-border rounded-xl p-3",
        "hover:shadow-md hover:border-border/80 transition-all duration-150 overflow-hidden",
        isDone && "opacity-60"
      )}
    >
      {/* 标题行 */}
      <div className="flex items-start gap-2 mb-1.5">
        {/* Checkbox */}
        <button
          onClick={handleToggle}
          className={cn(
            "shrink-0 mt-0.5 h-[18px] w-[18px] rounded-md border-2 flex items-center justify-center transition-all duration-200",
            isDone
              ? "bg-green-500 border-green-500 text-white"
              : "border-muted-foreground/40 hover:border-primary hover:scale-110"
          )}
          title={isDone ? "标记为待办" : "标记为完成"}
        >
          {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>

        <span
          className={cn(
            "text-sm flex-1 leading-snug pt-px",
            isDone && "line-through text-muted-foreground"
          )}
        >
          {task.title}
        </span>

        {/* 优先级旗帜 */}
        {task.priority > 0 && (
          <span
            className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md", priorityConfig.color)}
            title={`优先级：${priorityConfig.label}`}
            style={{ backgroundColor: listColor ? listColor + "14" : undefined }}
          >
            <Flag className="h-3.5 w-3.5 fill-current" />
          </span>
        )}
      </div>

      {/* Meta info */}
      {(task.dueDate || (task.tags && task.tags.length > 0) || totalChildren > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap pl-7">
          {task.dueDate && (
            <span
              className={cn(
                "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-medium",
                isOverdue
                  ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Calendar className="h-3 w-3" />
              {fmtShortDate(new Date(task.dueDate))}
            </span>
          )}
          {task.tags?.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-medium"
              style={{ backgroundColor: tag.color + "1a", color: tag.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </span>
          ))}
          {(task.tags?.length ?? 0) > 2 && (
            <span className="text-xs text-muted-foreground font-medium tabular-nums">
              +{task.tags!.length - 2}
            </span>
          )}
          {totalChildren > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground tabular-nums">
                {completedChildren}/{totalChildren}
              </span>
              {/* 迷你进度条 */}
              <span className="w-8 h-1 rounded-full bg-muted overflow-hidden">
                <span
                  className="block h-full bg-green-500 rounded-full"
                  style={{ width: `${(completedChildren / totalChildren) * 100}%` }}
                />
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 可拖拽卡片 =====
function SortableKanbanCard({ task, onOpen, onToggleStatus }: { task: Task; onOpen: (task: Task) => void; onToggleStatus: (id: string, status: TaskStatus) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  // 使用 translate3d + 更平滑的 transition 让拖拽更丝滑
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? "none" : transition ?? "transform 200ms cubic-bezier(0.18, 0.67, 0.6, 0.94)",
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "group/drag relative rounded-xl cursor-grab active:cursor-grabbing touch-none select-none",
        isDragging && "shadow-2xl ring-2 ring-primary/40 z-50"
      )}
      onDoubleClick={() => onOpen(task)}
    >
      <KanbanCard task={task} onToggleStatus={onToggleStatus} />
    </div>
  );
}

// ===== 分组内联添加任务 =====
function InlineSectionAdd({ placeholder, onAdd, onCancel }: {
  placeholder?: string;
  onAdd: (title: string, priority: TaskPriority, dueDate: string | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1.5">
      <QuickAddInput compact placeholder={placeholder} onAdd={onAdd} onCancel={onCancel} autoFocus />
    </div>
  );
}

// ===== 空列占位（同时作为 droppable） =====
function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "space-y-2 p-2 rounded-xl min-h-[180px] transition-colors",
        "bg-muted/40 border border-dashed border-border/50",
        isOver && "bg-primary/5 border-primary/40"
      )}
    >
      {children}
    </div>
  );
}

// ===== 主组件 =====
export function KanbanView({ tasks, onToggleStatus, onUpdate, onReorder, onOpenTask, listId, initialGroupMode = "status", onGroupModeChange, onTasksChanged, onSectionsChanged, onCreateTaskInSection }: KanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>(initialGroupMode);
  const [sections, setSections] = useState<TaskSectionInfo[]>([]);
  const [addingSection, setAddingSection] = useState(false);
  const [addingTaskInSection, setAddingTaskInSection] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState("");
  const [menuSectionId, setMenuSectionId] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState("");
  const [deletingSection, setDeletingSection] = useState<TaskSectionInfo | null>(null);
  const [deleteMode, setDeleteMode] = useState<"tasks" | "move">("tasks");
  const [sectionActionBusy, setSectionActionBusy] = useState(false);
  const [ungroupedName, setUngroupedName] = useState("未分组");
  const [ungroupedVisible, setUngroupedVisible] = useState(true);
  const [deleteTargetSectionId, setDeleteTargetSectionId] = useState("");
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [ungroupedPos, setUngroupedPos] = useState(0);

  const loadSections = useCallback(async () => {
    if (!listId) return setSections([]);
    const res = await fetch(`/api/tasks/lists/${listId}`);
    if (res.ok) {
      const list = (await res.json()).list;
      setSections(list?.sections ?? []);
      setUngroupedName(list?.ungroupedName ?? "未分组");
      setUngroupedVisible(list?.ungroupedVisible ?? true);
    }
  }, [listId]);

  // 加载 ungrouped 列的位置（localStorage，-1 表示末尾）
  useEffect(() => {
    if (listId) {
      const pos = getUngroupedPosition(listId);
      setUngroupedPos(pos < 0 ? 0 : pos);
    }
  }, [listId]);

  useEffect(() => { setGroupMode(initialGroupMode); }, [initialGroupMode]);
  useEffect(() => { void loadSections(); }, [loadSections]);

  // 自定义模式下的显示列：真实分组 + 虚拟未分组列，按 ungroupedPos 插入
  const displayColumns = useMemo(() => {
    if (!ungroupedVisible) return sections;
    const ungroupedCol: TaskSectionInfo = { id: "unsectioned", name: ungroupedName, color: "#94a3b8", sortOrder: 999, listId: listId ?? "" };
    const pos = Math.min(ungroupedPos, sections.length);
    const result = [...sections];
    result.splice(pos, 0, ungroupedCol);
    return result;
  }, [sections, ungroupedVisible, ungroupedName, ungroupedPos, listId]);

  const selectGroupMode = (mode: GroupMode) => {
    setGroupMode(mode);
    onGroupModeChange?.(mode);
  };

  const createSection = async () => {
    if (!listId || !sectionName.trim()) return;
    if (sections.length >= MAX_SECTIONS) return;
    await fetch("/api/tasks/sections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId, name: sectionName.trim() }) });
    setSectionName(""); setAddingSection(false); await loadSections();
  };

  const saveSectionName = async () => {
    if (!editingSectionId || !editingSectionName.trim() || sectionActionBusy) return;
    setSectionActionBusy(true);
    const query = editingSectionId === "unsectioned" && listId ? `?listId=${listId}` : "";
    const res = await fetch(`/api/tasks/sections/${editingSectionId}${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: editingSectionName.trim() }) });
    if (res.ok) { setEditingSectionId(null); await loadSections(); await onSectionsChanged?.(); }
    setSectionActionBusy(false);
  };

  const deleteSection = async () => {
    if (!deletingSection || sectionActionBusy) return;
    setSectionActionBusy(true);
    const params = new URLSearchParams({ mode: deleteMode });
    if (listId) params.set("listId", listId);
    if (deletingSection.id === "unsectioned" && deleteMode === "move" && deleteTargetSectionId) params.set("targetSectionId", deleteTargetSectionId);
    const res = await fetch(`/api/tasks/sections/${deletingSection.id}?${params}`, { method: "DELETE" });
    if (res.ok) {
      setDeletingSection(null);
      await loadSections();
      await onTasksChanged?.();
      await onSectionsChanged?.();
    }
    setSectionActionBusy(false);
  };

  const reorderSections = async (targetSectionId: string) => {
    if (!draggedSectionId || draggedSectionId === targetSectionId) return setDraggedSectionId(null);
    // 基于 displayColumns（含 ungrouped 虚拟列）计算位置
    const fromIndex = displayColumns.findIndex((col) => col.id === draggedSectionId);
    const targetIndex = displayColumns.findIndex((col) => col.id === targetSectionId);
    if (fromIndex < 0 || targetIndex < 0) return setDraggedSectionId(null);
    const reorderedCols = [...displayColumns];
    const [moved] = reorderedCols.splice(fromIndex, 1);
    reorderedCols.splice(targetIndex, 0, moved);
    setDraggedSectionId(null);

    // 分离真实分组和 ungrouped 的位置
    const newRealSections = reorderedCols.filter((col) => col.id !== "unsectioned");
    const newUngroupedPos = reorderedCols.findIndex((col) => col.id === "unsectioned");

    // 乐观更新
    setSections(newRealSections);
    if (newUngroupedPos >= 0) {
      setUngroupedPos(newUngroupedPos);
      if (listId) setUngroupedPosition(listId, newUngroupedPos);
    }

    // 持久化真实分组的 sortOrder
    const results = await Promise.all(newRealSections.map((section, sortOrder) => fetch(`/api/tasks/sections/${section.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder }),
    })));
    if (results.some((result) => !result.ok)) await loadSections();
    await onSectionsChanged?.();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  );

  // ===== 按周分组的列计算 =====
  const weekColumns = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentWeek = getISOWeek(today);

    // 构造从本周起连续 4 周的列
    const weeks: {
      key: string;
      year: number;
      week: number;
      label: string;
      dateRange: string;
      isCurrent: boolean;
    }[] = [];

    for (let i = 0; i < 4; i++) {
      const monday = getMondayOfISOWeek(currentWeek.year, currentWeek.week + i);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const w = getISOWeek(monday);
      weeks.push({
        key: `${w.year}-W${w.week}`,
        year: w.year,
        week: w.week,
        label: `${String(w.week).padStart(2, "0")}-W${i + 1}`,
        dateRange: `${fmtShortDate(monday)} - ${fmtShortDate(sunday)}`,
        isCurrent: i === 0,
      });
    }

    return weeks;
  }, []);

  // ===== 分组任务 =====
  const tasksByStatus = useCallback(
    (status: TaskStatus) => tasks.filter((t) => t.status === status),
    [tasks]
  );

  const tasksByWeek = useCallback(
    (weekKey: string) => {
      const col = weekColumns.find((w) => w.key === weekKey);
      if (!col) return [];
      const monday = getMondayOfISOWeek(col.year, col.week);
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7); // 排他上界
      return tasks.filter((t) => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        return d >= monday && d < nextMonday;
      });
    },
    [tasks, weekColumns]
  );

  const overdueTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.dueDate &&
          t.status !== "done" &&
          t.status !== "archived" &&
          new Date(t.dueDate) < new Date(new Date().toDateString())
      ),
    [tasks]
  );

  const noDateTasks = useMemo(
    () => tasks.filter((t) => !t.dueDate && t.status !== "done" && t.status !== "archived"),
    [tasks]
  );

  // ===== 拖拽处理 =====
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      if (!over) return;

      const activeTask = tasks.find((t) => t.id === active.id);
      if (!activeTask) return;

      const overId = over.id as string;

      // --- 按状态分组 ---
      if (groupMode === "status") {
        let targetStatus: TaskStatus | null = null;
        if (["todo", "in_progress", "done", "archived"].includes(overId)) {
          targetStatus = overId as TaskStatus;
        } else {
          const overTask = tasks.find((t) => t.id === overId);
          if (overTask) targetStatus = overTask.status;
        }
        if (!targetStatus) return;
        const overTask = tasks.find((task) => task.id === overId);
        const columnTasks = tasksByStatus(targetStatus).filter((task) => task.id !== activeTask.id);
        // 向下拖（active 原本在 over 之前）时，插入到 over 之后
        const isMovingDown = overTask && activeTask.sortOrder < overTask.sortOrder;
        const targetIndex = overTask
          ? Math.max(0, columnTasks.findIndex((task) => task.id === overTask.id)) + (isMovingDown ? 1 : 0)
          : columnTasks.length;
        columnTasks.splice(targetIndex < 0 ? columnTasks.length : targetIndex, 0, activeTask);
        void onReorder(columnTasks.map((task, sortOrder) => ({ id: task.id, sortOrder, status: targetStatus! })));
        return;
      }

      if (groupMode === "custom") {
        const targetSection = sections.find((section) => section.id === overId);
        const overTask = tasks.find((task) => task.id === overId);
        const sectionId = overId === "unsectioned" ? null : targetSection?.id ?? overTask?.sectionId;
        if (sectionId === undefined) return;
        const columnTasks = tasks.filter((task) => (task.sectionId ?? null) === (sectionId ?? null) && task.id !== activeTask.id);
        // 向下拖（active 原本在 over 之前）时，插入到 over 之后
        const isMovingDown = overTask && activeTask.sortOrder < overTask.sortOrder;
        const targetIndex = overTask
          ? Math.max(0, columnTasks.findIndex((task) => task.id === overTask.id)) + (isMovingDown ? 1 : 0)
          : columnTasks.length;
        columnTasks.splice(targetIndex < 0 ? columnTasks.length : targetIndex, 0, activeTask);
        void onReorder(columnTasks.map((task, sortOrder) => ({ id: task.id, sortOrder, sectionId: sectionId ?? null })));
        return;
      }

      // --- 按周分组 ---
      // overId 可能是列 key (YYYY-W{N}) 或某任务 id
      if (overId.match(/^\d{4}-W\d+$/)) {
        const col = weekColumns.find((w) => w.key === overId);
        if (col) {
          const monday = getMondayOfISOWeek(col.year, col.week);
          const newDate = new Date(monday);
          // 保持原 dueTime（如果有）
          if (activeTask.dueTime) {
            const [hh, mm] = activeTask.dueTime.split(":");
            newDate.setHours(Number(hh), Number(mm), 0, 0);
          }
          onUpdate(activeTask.id, { dueDate: newDate.toISOString() });
        }
        return;
      }

      // 落在某卡片上 → 取其所在周
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask?.dueDate) {
        const w = getISOWeek(new Date(overTask.dueDate));
        const monday = getMondayOfISOWeek(w.year, w.week);
        const newDate = new Date(monday);
        if (activeTask.dueTime) {
          const [hh, mm] = activeTask.dueTime.split(":");
          newDate.setHours(Number(hh), Number(mm), 0, 0);
        }
        onUpdate(activeTask.id, { dueDate: newDate.toISOString() });
      }
    },
    [tasks, onReorder, onUpdate, groupMode, weekColumns, tasksByStatus, sections]
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
      <div className="space-y-3">
        {/* 分组切换控件 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            {([
              { mode: "status" as const, label: "按状态" },
              ...(listId ? [{ mode: "custom" as const, label: "自定义" }] : []),
            ]).map((opt) => (
              <button
                key={opt.mode}
                onClick={() => selectGroupMode(opt.mode)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-all",
                  groupMode === opt.mode
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 列容器 */}
        <div className="flex gap-4 overflow-x-auto pb-4">
          {groupMode === "status"
            ? // ===== 按状态分组 =====
              STATUS_COLUMNS.map(({ status, icon: Icon, label, accent }) => {
                const columnTasks = tasksByStatus(status);
                return (
                  <div key={status} className="flex-1 min-w-[260px] max-w-[350px]">
                    {/* 列头 */}
                    <div className="flex items-center gap-2 mb-2.5 px-2">
                      <Icon className={cn("h-4 w-4", accent)} />
                      <h3 className="text-sm font-medium">{label}</h3>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                        {columnTasks.length}
                      </span>
                    </div>
                    <SortableContext id={status} items={columnTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                      <DroppableColumn id={status}>
                        {columnTasks.map((task) => (
                          <SortableKanbanCard key={task.id} task={task} onOpen={onOpenTask} onToggleStatus={onToggleStatus} />
                        ))}
                        {columnTasks.length === 0 && (
                          <div className="text-center py-6 text-muted-foreground/50 text-xs">
                            拖拽任务到这里
                          </div>
                        )}
                      </DroppableColumn>
                    </SortableContext>
                  </div>
                );
              })
            : groupMode === "custom"
            ? <>
                {displayColumns.map((section) => {
                  const columnTasks = tasks.filter((task) => section.id === "unsectioned" ? !task.sectionId : task.sectionId === section.id);
                  return (
                    <div
                      key={section.id}
                      className={cn("w-[300px] shrink-0 transition-opacity", draggedSectionId === section.id && "opacity-45")}
                      onDragOver={(event) => { if (draggedSectionId) event.preventDefault(); }}
                      onDrop={() => void reorderSections(section.id)}
                    >
                      <div className="mb-2.5 flex items-center gap-2 px-1">
                        <button
                          draggable
                          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", section.id); setDraggedSectionId(section.id); }}
                          onDragEnd={() => setDraggedSectionId(null)}
                          className="cursor-grab rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground active:cursor-grabbing"
                          title="拖动分组排序"
                        ><GripVertical className="h-3.5 w-3.5" /></button>
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: section.color }} />
                        {editingSectionId === section.id ? (
                          <input
                            autoFocus
                            value={editingSectionName}
                            onChange={(event) => setEditingSectionName(event.target.value)}
                            onKeyDown={(event) => { if (event.key === "Enter") void saveSectionName(); if (event.key === "Escape") setEditingSectionId(null); }}
                            className="min-w-0 flex-1 rounded-md border border-primary bg-background px-2 py-1 text-sm font-semibold outline-none"
                          />
                        ) : <h3 className="text-sm font-semibold">{section.name}</h3>}
                        <span className="text-xs text-muted-foreground">{columnTasks.length}</span>
                        <div className="relative ml-auto flex items-center gap-0.5">
                            <button onClick={() => setAddingTaskInSection(section.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="在此分组添加任务"><Plus className="h-4 w-4" /></button>
                            <button onClick={() => setMenuSectionId((current) => current === section.id ? null : section.id)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="分组菜单"><MoreHorizontal className="h-4 w-4" /></button>
                            {menuSectionId === section.id && (
                              <>
                                <div className="fixed inset-0 z-30" onClick={() => setMenuSectionId(null)} />
                                <div className="absolute right-0 top-7 z-40 w-36 rounded-lg border border-border bg-background p-1 shadow-xl">
                                  <button onClick={() => { setEditingSectionId(section.id); setEditingSectionName(section.name); setMenuSectionId(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent"><Pencil className="h-3.5 w-3.5" />编辑分组</button>
                                  <button onClick={() => { setDeletingSection(section); setDeleteMode("tasks"); setDeleteTargetSectionId(sections[0]?.id ?? ""); setMenuSectionId(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" />删除分组</button>
                                </div>
                              </>
                            )}
                          </div>
                      </div>
                      <SortableContext id={section.id} items={columnTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                        <DroppableColumn id={section.id}>
                          {columnTasks.map((task) => <SortableKanbanCard key={task.id} task={task} onOpen={onOpenTask} onToggleStatus={onToggleStatus} />)}
                          {addingTaskInSection === section.id && (
                            <InlineSectionAdd
                              placeholder="添加任务到此分组..."
                              onAdd={async (title, priority, dueDate) => {
                                const sid = section.id === "unsectioned" ? null : section.id;
                                const ok = await onCreateTaskInSection?.(sid, title, priority, dueDate) ?? false;
                                if (ok) setAddingTaskInSection(null);
                                return ok;
                              }}
                              onCancel={() => setAddingTaskInSection(null)}
                            />
                          )}
                        </DroppableColumn>
                      </SortableContext>
                    </div>
                  );
                })}
                <div className="w-56 shrink-0 pt-0.5">
                  {addingSection ? <div className="rounded-xl border border-border bg-muted/30 p-2"><input autoFocus value={sectionName} onChange={(e) => setSectionName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createSection(); if (e.key === "Escape") setAddingSection(false); }} placeholder="分组名称" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /><div className="mt-2 flex gap-2"><button onClick={createSection} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">添加</button><button onClick={() => setAddingSection(false)} className="px-2 text-xs text-muted-foreground">取消</button></div></div> : sections.length >= MAX_SECTIONS ? <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground"><Plus className="h-4 w-4" />已达分组上限（{MAX_SECTIONS}）</div> : <button onClick={() => setAddingSection(true)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/5"><Plus className="h-4 w-4" />添加分组</button>}
                </div>
              </>
            : // ===== 按周分组 =====
              <>
                {/* 逾期列（只读展示，不 droppable） */}
                {overdueTasks.length > 0 && (
                  <div className="flex-1 min-w-[240px] max-w-[320px]">
                    <div className="flex items-center gap-2 mb-2.5 px-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      <h3 className="text-sm font-medium">已逾期</h3>
                      <span className="text-xs text-red-600 bg-red-100 dark:bg-red-900/40 dark:text-red-300 px-1.5 py-0.5 rounded-full tabular-nums">
                        {overdueTasks.length}
                      </span>
                    </div>
                    <div className="space-y-2 p-2 rounded-xl min-h-[180px] bg-red-50/50 dark:bg-red-950/20 border border-dashed border-red-200/50 dark:border-red-900/40">
                      {overdueTasks.map((task) => (
                        <KanbanCard key={task.id} task={task} onToggleStatus={onToggleStatus} />
                      ))}
                    </div>
                  </div>
                )}

                {/* 周列 */}
                {weekColumns.map((col) => {
                  const columnTasks = tasksByWeek(col.key);
                  return (
                    <div key={col.key} className="flex-1 min-w-[260px] max-w-[350px]">
                      <div className="flex items-center gap-2 mb-2.5 px-2">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-semibold tabular-nums", col.isCurrent && "text-primary")}>
                              {col.label}
                            </span>
                            {col.isCurrent && (
                              <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-medium">
                                本周
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums">{col.dateRange}</span>
                        </div>
                        <span className="ml-auto text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                          {columnTasks.length}
                        </span>
                      </div>
                      <SortableContext id={col.key} items={columnTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        <DroppableColumn id={col.key}>
                          {columnTasks.map((task) => (
                            <SortableKanbanCard key={task.id} task={task} onOpen={onOpenTask} onToggleStatus={onToggleStatus} />
                          ))}
                          {columnTasks.length === 0 && (
                            <div className="text-center py-6 text-muted-foreground/50 text-xs">
                              拖拽任务到这里
                            </div>
                          )}
                        </DroppableColumn>
                      </SortableContext>
                    </div>
                  );
                })}

                {/* 无截止日期列 */}
                {noDateTasks.length > 0 && (
                  <div className="flex-1 min-w-[240px] max-w-[320px]">
                    <div className="flex items-center gap-2 mb-2.5 px-2">
                      <CalendarOff className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">无日期</h3>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full tabular-nums">
                        {noDateTasks.length}
                      </span>
                    </div>
                    <div className="space-y-2 p-2 rounded-xl min-h-[180px] bg-muted/30 border border-dashed border-border/50">
                      {noDateTasks.map((task) => (
                        <KanbanCard key={task.id} task={task} onToggleStatus={onToggleStatus} />
                      ))}
                    </div>
                  </div>
                )}
              </>}
        </div>
      </div>

      <Dialog open={Boolean(deletingSection)} onOpenChange={(open) => { if (!open && !sectionActionBusy) setDeletingSection(null); }}>
        <DialogContent hideClose className="max-w-md gap-6">
          <DialogHeader>
            <DialogTitle>删除分组</DialogTitle>
            <DialogDescription>请选择如何处理“{deletingSection?.name}”中的任务。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className={cn("flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors", deleteMode === "tasks" ? "border-red-500 bg-red-50/70 dark:bg-red-950/30" : "border-border hover:bg-accent/50")}>
              <input type="radio" name="delete-section-mode" value="tasks" checked={deleteMode === "tasks"} onChange={() => setDeleteMode("tasks")} className="mt-0.5 h-4 w-4 accent-red-600" />
              <span><span className="block text-sm font-medium">删除分组和所有任务</span><span className="mt-1 block text-xs text-muted-foreground">分组内任务将移入垃圾箱，可在 30 天内恢复。</span></span>
            </label>
            <label className={cn("flex gap-3 rounded-xl border p-4 transition-colors", deletingSection?.id === "unsectioned" && sections.length === 0 ? "cursor-not-allowed opacity-50" : "cursor-pointer", deleteMode === "move" ? "border-primary bg-primary/5" : "border-border hover:bg-accent/50")}>
              <input type="radio" name="delete-section-mode" value="move" checked={deleteMode === "move"} disabled={deletingSection?.id === "unsectioned" && sections.length === 0} onChange={() => setDeleteMode("move")} className="mt-0.5 h-4 w-4 accent-primary" />
              <span className="flex-1"><span className="block text-sm font-medium">仅删除分组</span><span className="mt-1 block text-xs text-muted-foreground">{deletingSection?.id === "unsectioned" ? "保留所有任务，并将它们移动到其他分组。" : "保留所有任务，并将它们移动到“未分组”。"}</span>{deletingSection?.id === "unsectioned" && sections.length > 0 && deleteMode === "move" && <select value={deleteTargetSectionId} onChange={(event) => setDeleteTargetSectionId(event.target.value)} className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs">{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select>}</span>
            </label>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" disabled={sectionActionBusy} onClick={() => setDeletingSection(null)}>取消</Button>
            <Button variant={deleteMode === "tasks" ? "destructive" : "default"} disabled={sectionActionBusy} onClick={() => void deleteSection()}>{sectionActionBusy ? "处理中…" : "确认删除"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拖拽浮层（必须与 DndContext 同级渲染） */}
      <DragOverlay>
        {activeTask && (
          <div className="opacity-95 rotate-2">
            <KanbanCard task={activeTask} onToggleStatus={onToggleStatus} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
