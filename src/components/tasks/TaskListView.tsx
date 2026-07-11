"use client";

import { useState } from "react";
import { Plus, ChevronDown, ChevronRight, CheckCircle2 } from "lucide-react";
import { SortableTaskItem } from "./TaskItem";
import { QuickAddInput } from "./QuickAddInput";
import type { Task, TaskStatus, TaskPriority, TaskSectionInfo } from "./types";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";

interface TaskListViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onCreateTask: (data: { title: string; priority?: TaskPriority; dueDate?: string | null; parentId?: string | null }) => Promise<boolean>;
  onOpenTask: (task: Task) => void;
  sections?: TaskSectionInfo[];
  ungroupedName?: string;
  ungroupedVisible?: boolean;
  onReorder: (items: { id: string; sortOrder: number; parentId?: string | null; sectionId?: string | null }[]) => Promise<boolean>;
}

export function TaskListView({
  tasks,
  onToggleStatus,
  onUpdate,
  onDelete,
  onCreateTask,
  onOpenTask,
  sections,
  ungroupedName = "未分组",
  ungroupedVisible = true,
  onReorder,
}: TaskListViewProps) {
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null);
  const [doneCollapsed, setDoneCollapsed] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const handleAddSubtask = (parentId: string) => {
    setAddingSubtaskFor(parentId);
  };

  const handleSubtaskCreated = async (title: string, parentId: string | null) => {
    await onCreateTask({ title, parentId });
    setAddingSubtaskFor(null);
  };

  // Group tasks by status
  const todoTasks = tasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const flattenTasks = (items: Task[]): Task[] => items.flatMap((task) => [task, ...flattenTasks(task.children ?? [])]);
  const allTasks = flattenTasks(tasks);
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const active = allTasks.find((task) => task.id === event.active.id);
    const over = allTasks.find((task) => task.id === event.over?.id);
    if (!active || !over || active.id === over.id || active.parentId !== over.parentId) return;
    if ((active.sectionId ?? null) !== (over.sectionId ?? null)) return;
    if (!sections && (active.status === "done") !== (over.status === "done")) return;
    const siblings = active.parentId
      ? allTasks.filter((task) => task.parentId === active.parentId)
      : tasks.filter((task) => (task.sectionId ?? null) === (active.sectionId ?? null) && (sections || (task.status === "done") === (active.status === "done")));
    const from = siblings.findIndex((task) => task.id === active.id);
    const to = siblings.findIndex((task) => task.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = [...siblings];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    void onReorder(reordered.map((task, sortOrder) => ({ id: task.id, sortOrder, parentId: task.parentId, sectionId: task.sectionId ?? null })));
  };
  const dndProps = { sensors, collisionDetection: closestCenter, onDragStart: (event: { active: { id: string | number } }) => setActiveTask(allTasks.find((task) => task.id === event.active.id) ?? null), onDragEnd: handleDragEnd, onDragCancel: () => setActiveTask(null) };

  if (sections) {
    const groups = [
      ...sections,
      ...(ungroupedVisible ? [{ id: "unsectioned", name: ungroupedName, color: "#94a3b8", sortOrder: 999, listId: "" }] : []),
    ];
    return (
      <DndContext {...dndProps}>
      <div className="space-y-6">
        {groups.map((section) => {
          const sectionTasks = tasks.filter((task) => section.id === "unsectioned" ? !task.sectionId : task.sectionId === section.id);
          return (
            <section key={section.id} className="space-y-2">
              <div className="flex items-center gap-2 border-b border-border/70 px-2 pb-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: section.color }} />
                <h3 className="text-sm font-semibold">{section.name}</h3>
                <span className="rounded-full bg-muted px-1.5 text-[10px] leading-5 text-muted-foreground">{sectionTasks.length}</span>
              </div>
              {sectionTasks.length > 0 ? <SortableContext items={sectionTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><div className="space-y-0.5">{sectionTasks.map((task) => (
                <div key={task.id}>
                  <SortableTaskItem task={task} onToggleStatus={onToggleStatus} onUpdate={onUpdate} onDelete={onDelete} onAddSubtask={handleAddSubtask} onOpen={onOpenTask} />
                  {addingSubtaskFor === task.id && <div className="ml-12 mt-1"><QuickAddInput compact placeholder="添加子任务..." onAdd={(title) => handleSubtaskCreated(title, task.id)} onCancel={() => setAddingSubtaskFor(null)} autoFocus /></div>}
                </div>
              ))}</div></SortableContext> : <div className="px-3 py-4 text-xs text-muted-foreground/60">此分组暂无任务</div>}
            </section>
          );
        })}
        {groups.length === 0 && <div className="py-10 text-center text-xs text-muted-foreground">暂无分组，请在看板视图中添加分组</div>}
      </div>
      <DragOverlay>{activeTask && <div className="rounded-lg border border-primary/30 bg-background px-4 py-3 text-sm font-medium shadow-2xl">{activeTask.title}</div>}</DragOverlay>
      </DndContext>
    );
  }

  return (
    <DndContext {...dndProps}>
    <div className="space-y-5">
      {/* Active tasks section */}
      <div>
        {/* Task list */}
        {todoTasks.length > 0 ? (
          <SortableContext items={todoTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><div className="space-y-0.5">
            {todoTasks.map((task) => (
              <div key={task.id}>
                <SortableTaskItem
                  task={task}
                  onToggleStatus={onToggleStatus}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onAddSubtask={handleAddSubtask}
                  onOpen={onOpenTask}
                />
                {addingSubtaskFor === task.id && (
                  <div className="ml-12 mt-1">
                    <QuickAddInput
                      compact
                      placeholder="添加子任务..."
                      onAdd={(title) =>
                        handleSubtaskCreated(title, task.id)
                      }
                      onCancel={() => setAddingSubtaskFor(null)}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            ))}
          </div></SortableContext>
        ) : (
          <div className="text-center py-6 text-xs text-muted-foreground/60">
            没有待办任务
          </div>
        )}
      </div>

      {/* Completed tasks section (collapsible) */}
      {doneTasks.length > 0 && (
        <div className="border-t border-border pt-3">
          {/* Collapsible section header */}
          <button
            onClick={() => setDoneCollapsed((v) => !v)}
            className="flex items-center gap-2 mb-2 px-3 w-full hover:bg-accent/50 rounded-lg py-1 -my-1 transition-colors group"
          >
            {doneCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
            )}
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            <h3 className="text-sm font-medium text-foreground">已完成</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {doneTasks.length}
            </span>
          </button>

          {/* Task list */}
          {!doneCollapsed && (
            <SortableContext items={doneTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}><div className="space-y-0.5 animate-in fade-in">
              {doneTasks.map((task) => (
                <SortableTaskItem
                  key={task.id}
                  task={task}
                  onToggleStatus={onToggleStatus}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onAddSubtask={handleAddSubtask}
                  onOpen={onOpenTask}
                />
              ))}
            </div></SortableContext>
          )}
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 py-14">
          {/* Decorative gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />
          <div className="relative flex flex-col items-center">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
              <Plus className="h-7 w-7 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">还没有任务</p>
            <p className="text-xs mt-1 text-muted-foreground">
              在上方输入框添加第一个任务
            </p>
          </div>
        </div>
      )}
    </div>
    <DragOverlay>{activeTask && <div className="rounded-lg border border-primary/30 bg-background px-4 py-3 text-sm font-medium shadow-2xl">{activeTask.title}</div>}</DragOverlay>
    </DndContext>
  );
}
