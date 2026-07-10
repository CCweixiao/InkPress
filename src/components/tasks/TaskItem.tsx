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
import { PRIORITY_CONFIG, STATUS_CONFIG } from "./types";
import { TagPicker } from "./TagPicker";

interface TaskItemProps {
  task: Task;
  depth?: number;
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task> & { tagIds?: string[] }) => void;
  onDelete: (id: string) => void;
  onAddSubtask: (parentId: string) => void;
  dragHandleProps?: Record<string, unknown>;
}

export function TaskItem({
  task,
  depth = 0,
  onToggleStatus,
  onUpdate,
  onDelete,
  onAddSubtask,
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
    <div className={cn("group", animatingDone && "task-complete-animation")}>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-150",
          "hover:bg-accent/50",
          isDone && "opacity-60",
          depth > 0 && "ml-6"
        )}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        {/* Drag handle */}
        <span
          className={cn(
            "cursor-grab text-muted-foreground/40 hover:text-muted-foreground transition-opacity",
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

        {/* Priority indicator */}
        {task.priority > 0 && (
          <span className={cn("text-xs shrink-0", PRIORITY_CONFIG[task.priority as TaskPriority].color)}>
            <Flag className="h-3.5 w-3.5 fill-current" />
          </span>
        )}

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
              "flex-1 text-sm cursor-text select-none",
              isDone && "line-through text-muted-foreground"
            )}
            onDoubleClick={() => setEditing(true)}
          >
            {task.title}
          </span>
        )}

        {/* Tags */}
        {task.tags?.length > 0 && (
          <div className="flex gap-1">
            {task.tags.slice(0, 2).map((t) => (
              <span
                key={t.id}
                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded shrink-0"
                style={{ backgroundColor: t.color + "22", color: t.color }}
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

        {/* Due date */}
        {task.dueDate && (
          <span
            className={cn(
              "text-xs flex items-center gap-1 shrink-0",
              isOverdue ? "text-red-500" : "text-muted-foreground"
            )}
          >
            <Calendar className="h-3 w-3" />
            {formatDueDate(task.dueDate)}
          </span>
        )}

        {/* Progress for subtasks */}
        {hasChildren && (
          <span className="text-xs text-muted-foreground shrink-0">
            {completedChildren}/{totalChildren}
          </span>
        )}

        {/* Actions */}
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            showActions ? "opacity-100" : "opacity-0"
          )}
        >
          <TagPicker
            selectedIds={task.tags?.map((t) => t.id) ?? []}
            onChange={(ids) => onUpdate(task.id, { tagIds: ids })}
          />
          <button
            onClick={() => onAddSubtask(task.id)}
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            title="添加子任务"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 text-muted-foreground hover:text-red-500 rounded"
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
        <div className="mt-0.5">
          {task.children!.map((child) => (
            <TaskItem
              key={child.id}
              task={child}
              depth={depth + 1}
              onToggleStatus={onToggleStatus}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onAddSubtask={onAddSubtask}
            />
          ))}
        </div>
      )}
    </div>
  );
}
