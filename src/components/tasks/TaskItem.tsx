"use client";

import { useState, useRef, useEffect } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  GripVertical,
  Plus,
  Trash2,
  Calendar,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus } from "./types";
import { PRIORITY_CONFIG } from "./types";
import { TagPicker } from "./TagPicker";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface TaskItemProps {
  task: Task;
  depth?: number;
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task> & { tagIds?: string[] }) => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string) => void;
  onOpen?: (task: Task) => void;
  dragHandleProps?: Record<string, unknown>;
}

export function SortableTaskItem(props: Omit<TaskItemProps, "dragHandleProps">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: "task", task: props.task, parentId: props.task.parentId, sectionId: props.task.sectionId ?? null },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative rounded-lg", isDragging && "z-20 bg-background opacity-45 shadow-xl ring-1 ring-primary/30")}
    >
      <TaskItem {...props} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

export function TaskItem({
  task,
  depth = 0,
  onToggleStatus,
  onUpdate,
  onDelete,
  onAddSubtask,
  onOpen,
  dragHandleProps,
}: TaskItemProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [showActions, setShowActions] = useState(false);
  const [animatingDone, setAnimatingDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleToggle = () => {
    if (task.status === "done" || task.status === "cancelled") {
      onToggleStatus(task.id, task.status);
    } else {
      setAnimatingDone(true);
      setTimeout(() => {
        onToggleStatus(task.id, task.status);
        setAnimatingDone(false);
      }, 300);
    }
  };

  const handleSaveTitle = () => {
    if (editTitle.trim() && editTitle !== task.title) {
      onUpdate(task.id, { title: editTitle.trim() });
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveTitle();
    if (e.key === "Escape") {
      setEditTitle(task.title);
      setEditing(false);
    }
  };

  const completedChildren =
    task.children?.filter((c) => c.status === "done" || c.status === "cancelled").length ?? 0;
  const totalChildren = task.children?.length ?? 0;
  const hasChildren = totalChildren > 0;
  const progressPct = totalChildren > 0 ? (completedChildren / totalChildren) * 100 : 0;

  const isDone = task.status === "done" || task.status === "cancelled";
  const isOverdue =
    task.dueDate && !isDone && new Date(task.dueDate) < new Date();
  const isToday =
    task.dueDate &&
    !isDone &&
    new Date(task.dueDate).toDateString() === new Date().toDateString();

  const listColor = task.list?.color;

  const formatDueDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) return "今天";
    if (date.toDateString() === tomorrow.toDateString()) return "明天";
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  return (
    <div data-task-id={task.id} className={cn("group", animatingDone && "task-complete-animation")}>
      <div
        className={cn(
          "relative flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-150",
          "hover:bg-accent/50",
          isDone && "opacity-60",
          depth > 0 && "ml-6"
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("button,input,select") && !editing) onOpen?.(task);
        }}
      >
        {/* 左侧清单颜色色条（仅顶层任务 + hover 显示） */}
        {depth === 0 && listColor && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full transition-opacity"
            style={{ backgroundColor: listColor, opacity: showActions ? 0.7 : 0 }}
          />
        )}

        {/* Drag handle */}
        <span
          className={cn(
            "cursor-grab text-muted-foreground/40 hover:text-muted-foreground transition-opacity shrink-0",
            showActions ? "opacity-100" : "opacity-0"
          )}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </span>

        {/* Collapse toggle for parent tasks */}
        {hasChildren ? (
          <button
            onClick={() => onUpdate(task.id, { isCollapsed: !task.isCollapsed })}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            {task.isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Checkbox */}
        <button
          onClick={handleToggle}
          className={cn(
            "shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-all duration-200",
            isDone
              ? "bg-green-500 border-green-500 text-white scale-100"
              : "border-muted-foreground/40 hover:border-primary hover:scale-110"
          )}
        >
          {isDone && <Check className="h-3 w-3" />}
          {!isDone && task.status === "in_progress" && (
            <Circle className="h-2 w-2 fill-primary text-primary" />
          )}
        </button>

        {/* Title */}
        {editing ? (
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none outline-none text-sm"
          />
        ) : (
          <span
            className={cn(
              "flex-1 text-sm cursor-text select-none min-w-0 truncate",
              isDone && "line-through text-muted-foreground"
            )}
            onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }}
          >
            {task.title}
          </span>
        )}

        {/* Tags */}
        {task.tags?.length > 0 && (
          <div className="flex gap-1 shrink-0">
            {task.tags.slice(0, 2).map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md shrink-0 font-medium"
                style={{ backgroundColor: t.color + "1a", color: t.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />
                {t.name}
              </span>
            ))}
            {task.tags.length > 2 && (
              <span className="text-xs text-muted-foreground shrink-0">
                +{task.tags.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Due date pill */}
        {task.dueDate && (
          <span
            className={cn(
              "flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md shrink-0 font-medium",
              isOverdue
                ? "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300"
                : isToday
                  ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-muted text-muted-foreground"
            )}
          >
            <Calendar className="h-3 w-3" />
            {formatDueDate(task.dueDate)}
          </span>
        )}

        {/* Priority flag */}
        {task.priority > 0 && (
          <span
            className={cn(
              "flex items-center justify-center w-5 h-5 rounded-md shrink-0",
              task.priority >= 3
                ? "bg-red-100 dark:bg-red-900/40"
                : task.priority === 2
                  ? "bg-yellow-100 dark:bg-yellow-900/40"
                  : "bg-blue-100 dark:bg-blue-900/40"
            )}
            title={`优先级：${PRIORITY_CONFIG[task.priority as TaskPriority].label}`}
          >
            <Flag
              className={cn("h-3 w-3 fill-current", PRIORITY_CONFIG[task.priority as TaskPriority].color)}
            />
          </span>
        )}

        {/* Progress for subtasks */}
        {hasChildren && (
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            {completedChildren}/{totalChildren}
          </span>
        )}

        {/* Actions */}
        <div
          className={cn(
            "flex items-center gap-0.5 transition-opacity shrink-0",
            showActions ? "opacity-100" : "opacity-0"
          )}
        >
          <TagPicker
            selectedIds={task.tags?.map((t) => t.id) ?? []}
            onChange={(ids) => onUpdate(task.id, { tagIds: ids })}
          />
          <button
            onClick={() => onAddSubtask(task.id)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded"
            title="添加子任务"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded"
            title="删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Subtask progress bar */}
      {hasChildren && !task.isCollapsed && (
        <div
          className="h-0.5 bg-muted rounded-full mx-3 overflow-hidden"
          style={{ marginLeft: `${depth * 24 + 48}px` }}
        >
          <div
            className="h-full bg-green-500 transition-all duration-500 ease-out rounded-full"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Subtasks */}
      {hasChildren && !task.isCollapsed && (
        <SortableContext items={task.children!.map((child) => child.id)} strategy={verticalListSortingStrategy}>
        <div className="mt-0.5 rounded-lg transition-colors">
          {task.children!.map((child) => (
            <SortableTaskItem
              key={child.id}
              task={child}
              depth={depth + 1}
              onToggleStatus={onToggleStatus}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
              onOpen={onOpen}
            />
          ))}
        </div>
        </SortableContext>
      )}
    </div>
  );
}
