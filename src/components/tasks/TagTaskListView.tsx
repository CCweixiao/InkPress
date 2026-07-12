"use client";

import { useMemo } from "react";
import { Calendar, Check, CheckSquare2, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "./types";

interface TagTaskListViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onOpenTask: (task: Task) => void;
  selectedTaskId?: string | null;
}

type SectionGroup = {
  key: string;
  sectionName: string;
  tasks: Task[];
};

type ListGroup = {
  id: string;
  name: string;
  color: string;
  sections: SectionGroup[];
};

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function TaskRows({ tasks, depth, onToggleStatus, onOpenTask, selectedTaskId }: {
  tasks: Task[];
  depth: number;
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onOpenTask: (task: Task) => void;
  selectedTaskId?: string | null;
}) {
  return (
    <>
      {tasks.map((task) => {
        const done = task.status === "done" || task.status === "archived";
        const selected = task.id === selectedTaskId;
        return (
          <div key={task.id}>
            <div
              className={cn(
                "group flex min-h-11 items-center gap-3 border-b border-border/60 py-2 pr-3 [content-visibility:auto]",
                selected ? "bg-slate-100/70 dark:bg-slate-800/55" : "hover:bg-muted/55"
              )}
              style={{ paddingLeft: `${12 + depth * 22}px` }}
            >
              <button
                type="button"
                onClick={() => onToggleStatus(task.id, task.status)}
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border-2",
                  done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/45 hover:border-primary"
                )}
                title={done ? "标记为待办" : "标记为完成"}
              >
                {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </button>
              <button type="button" onClick={() => onOpenTask(task)} className={cn("min-w-0 flex-1 truncate text-left text-sm", done && "text-muted-foreground line-through")}>{task.title}</button>
              <div className="flex shrink-0 items-center gap-1.5">
                {task.dueDate && <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"><Calendar className="h-3 w-3" />{formatDate(task.dueDate)}</span>}
                {task.tags.slice(0, 2).map((tag) => <span key={tag.id} className="rounded-md px-1.5 py-0.5 text-[11px]" style={{ color: tag.color, backgroundColor: `${tag.color}18` }}>{tag.name}</span>)}
              </div>
            </div>
            {task.children && task.children.length > 0 && <TaskRows tasks={task.children} depth={depth + 1} onToggleStatus={onToggleStatus} onOpenTask={onOpenTask} selectedTaskId={selectedTaskId} />}
          </div>
        );
      })}
    </>
  );
}

/** 标签筛选结果：以根任务的清单和自定义分组为上下文，保留完整子任务树。 */
export function TagTaskListView({ tasks, onToggleStatus, onOpenTask, selectedTaskId }: TagTaskListViewProps) {
  const lists = useMemo<ListGroup[]>(() => {
    const map = new Map<string, ListGroup & { sectionMap: Map<string, SectionGroup> }>();
    for (const task of tasks) {
      const listId = task.listId ?? "unassigned";
      const list = map.get(listId) ?? {
        id: listId,
        name: task.list?.name ?? "未归属清单",
        color: task.list?.color ?? "#94a3b8",
        sections: [],
        sectionMap: new Map<string, SectionGroup>(),
      };
      map.set(listId, list);

      const sectionName = task.section?.name ?? "未分组";
      const sectionKey = task.sectionId ?? "unsectioned";
      const section = list.sectionMap.get(sectionKey) ?? { key: sectionKey, sectionName, tasks: [] };
      section.tasks.push(task);
      list.sectionMap.set(sectionKey, section);
    }
    return [...map.values()]
      .map(({ sectionMap, ...list }) => ({
        ...list,
        sections: [...sectionMap.values()].sort((a, b) => a.sectionName.localeCompare(b.sectionName, "zh-CN")),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-border/70 text-sm text-muted-foreground">
        <CheckSquare2 className="mb-2 h-5 w-5 opacity-50" />
        暂无匹配该标签的任务
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto overscroll-contain pr-2">
      <div className="space-y-5 pb-4">
        {lists.map((list) => (
          <section key={list.id}>
            <div className="mb-2 flex items-center gap-2 px-1 text-sm">
              <FolderKanban className="h-4 w-4" style={{ color: list.color }} />
              <span className="font-semibold">{list.name}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">{list.sections.reduce((count, section) => count + section.tasks.length, 0)}</span>
            </div>
            <div className="space-y-3 border-l border-border/70 pl-3">
              {list.sections.map((section) => (
                <div key={section.key}>
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: list.color }} />
                    <span>{section.sectionName}</span>
                    <span className="tabular-nums">{section.tasks.length}</span>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
                    <TaskRows tasks={section.tasks} depth={0} onToggleStatus={onToggleStatus} onOpenTask={onOpenTask} selectedTaskId={selectedTaskId} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
