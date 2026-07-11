"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
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
} from "lucide-react";
import type { Task, TaskStatus } from "./types";
import { PRIORITY_CONFIG } from "./types";
import type { TaskPriority } from "./types";

interface KanbanViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onReorder: (items: { id: string; sortOrder: number; status?: string }[]) => Promise<boolean>;
}

// ===== 分组模式 =====
type GroupMode = "status" | "week";

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

/** 优先级 emoji 映射 */
const PRIORITY_EMOJI: Record<number, string> = { 1: "🔵", 2: "🟡", 3: "🟠", 4: "🔴" };

// ===== 卡片组件 =====
function KanbanCard({ task }: { task: Task }) {
  const isDone = task.status === "done";
  const isOverdue =
    task.dueDate && !isDone && new Date(task.dueDate) < new Date(new Date().toDateString());
  const listColor = task.list?.color;
  const priorityConfig = PRIORITY_CONFIG[task.priority as TaskPriority];

  const totalChildren = task.children?.length ?? 0;
  const completedChildren = task.children?.filter((c) => c.status === "done").length ?? 0;

  return (
    <div
      className={cn(
        "relative bg-background border border-border rounded-xl p-3 pl-3.5",
        "hover:shadow-md hover:border-border/80 transition-all duration-150 overflow-hidden"
      )}
    >
      {/* 左侧彩色条（清单色或优先级色） */}
      <span
        className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
        style={{ backgroundColor: listColor ?? "#cbd5e1" }}
      />

      {/* 标题行 */}
      <div className="flex items-start gap-1.5 mb-1.5">
        {task.priority > 0 && (
          <span
            className={cn("shrink-0 mt-0.5 text-xs", priorityConfig.color)}
            title={`优先级：${priorityConfig.label}`}
          >
            {PRIORITY_EMOJI[task.priority]}
          </span>
        )}
        <span
          className={cn(
            "text-sm flex-1 leading-snug",
            isDone && "line-through text-muted-foreground"
          )}
        >
          {task.title}
        </span>
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-1.5 flex-wrap">
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
    </div>
  );
}

// ===== 可拖拽卡片 =====
function SortableKanbanCard({ task }: { task: Task }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("cursor-grab active:cursor-grabbing", isDragging && "opacity-40")}
    >
      <KanbanCard task={task} />
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
export function KanbanView({ tasks, onUpdate, onReorder }: KanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>("status");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
        if (targetStatus && targetStatus !== activeTask.status) {
          const columnTasks = tasksByStatus(targetStatus);
          onReorder([{ id: activeTask.id, sortOrder: columnTasks.length, status: targetStatus }]);
        }
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
    [tasks, onReorder, onUpdate, groupMode, weekColumns, tasksByStatus]
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-3">
        {/* 分组切换控件 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted rounded-lg p-0.5">
            {([
              { mode: "status" as const, label: "按状态" },
              { mode: "week" as const, label: "按周" },
            ]).map((opt) => (
              <button
                key={opt.mode}
                onClick={() => setGroupMode(opt.mode)}
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
          {groupMode === "week" && (
            <span className="text-xs text-muted-foreground">
              拖拽卡片可修改截止日期到目标周
            </span>
          )}
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
                          <SortableKanbanCard key={task.id} task={task} />
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
                        <KanbanCard key={task.id} task={task} />
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
                            <SortableKanbanCard key={task.id} task={task} />
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
                        <KanbanCard key={task.id} task={task} />
                      ))}
                    </div>
                  </div>
                )}
              </>}
        </div>
      </div>

      {/* 拖拽浮层（必须与 DndContext 同级渲染） */}
      <DragOverlay>
        {activeTask && (
          <div className="opacity-95 rotate-2">
            <KanbanCard task={activeTask} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
