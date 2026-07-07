"use client";

import { useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Check, Circle, Clock, Archive } from "lucide-react";
import type { Task, TaskStatus } from "./types";
import { STATUS_CONFIG, PRIORITY_CONFIG } from "./types";
import type { TaskPriority } from "./types";

interface KanbanViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onReorder: (items: { id: string; sortOrder: number; status?: string }[]) => Promise<boolean>;
}

const COLUMNS: { status: TaskStatus; icon: React.ElementType; label: string }[] = [
  { status: "todo", icon: Circle, label: "待办" },
  { status: "in_progress", icon: Clock, label: "进行中" },
  { status: "done", icon: Check, label: "已完成" },
  { status: "archived", icon: Archive, label: "已归档" },
];

function SortableKanbanCard({ task, onUpdate }: { task: Task; onUpdate: (id: string, data: Partial<Task>) => void }) {
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

  const priorityConfig = PRIORITY_CONFIG[task.priority as TaskPriority];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-background border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing",
        "hover:shadow-md transition-shadow duration-150",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <div className="flex items-start gap-2">
        {task.priority > 0 && (
          <span className={cn("text-xs mt-0.5", priorityConfig.color)}>
            {priorityConfig.emoji}
          </span>
        )}
        <span
          className={cn(
            "text-sm flex-1",
            task.status === "done" && "line-through text-muted-foreground"
          )}
        >
          {task.title}
        </span>
      </div>

      {/* Meta info */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {task.dueDate && (
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded",
              new Date(task.dueDate) < new Date() && task.status !== "done"
                ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                : "bg-muted text-muted-foreground"
            )}
          >
            {new Date(task.dueDate).toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}
          </span>
        )}
        {task.tagsJson !== "[]" &&
          (JSON.parse(task.tagsJson) as string[]).slice(0, 2).map((tag) => (
            <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
              {tag}
            </span>
          ))}
        {(task.children?.length ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground">
            {task.children!.filter((c) => c.status === "done").length}/{task.children!.length}
          </span>
        )}
      </div>
    </div>
  );
}

export function KanbanView({ tasks, onToggleStatus, onUpdate, onDelete, onReorder }: KanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const getTasksByStatus = (status: TaskStatus) =>
    tasks.filter((t) => t.status === status);

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

      // Determine target column from the over element
      const overId = over.id as string;
      let targetStatus: TaskStatus | null = null;

      // Check if dropped on a column
      if (["todo", "in_progress", "done", "archived"].includes(overId)) {
        targetStatus = overId as TaskStatus;
      } else {
        // Dropped on another task - get its status
        const overTask = tasks.find((t) => t.id === overId);
        if (overTask) targetStatus = overTask.status;
      }

      if (targetStatus && targetStatus !== activeTask.status) {
        // Move to new column
        const columnTasks = getTasksByStatus(targetStatus);
        const items = [
          { id: activeTask.id, sortOrder: columnTasks.length, status: targetStatus },
        ];
        onReorder(items);
      }
    },
    [tasks, onReorder]
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(({ status, icon: Icon, label }) => {
          const columnTasks = getTasksByStatus(status);
          return (
            <div
              key={status}
              className="flex-1 min-w-[260px] max-w-[350px]"
            >
              <div className="flex items-center gap-2 mb-3 px-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">{label}</h3>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {columnTasks.length}
                </span>
              </div>
              <SortableContext
                id={status}
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className={cn(
                    "space-y-2 p-2 rounded-lg min-h-[200px] transition-colors",
                    "bg-muted/30 border border-dashed border-border/50"
                  )}
                >
                  {columnTasks.map((task) => (
                    <SortableKanbanCard
                      key={task.id}
                      task={task}
                      onUpdate={onUpdate}
                    />
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground/50 text-xs">
                      拖拽任务到这里
                    </div>
                  )}
                </div>
              </SortableContext>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="bg-background border border-primary rounded-lg p-3 shadow-xl opacity-90">
            <span className="text-sm">{activeTask.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
