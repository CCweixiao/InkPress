"use client";

import { useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, Clock3, Flag, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task, TaskPriority, TaskStatus } from "./types";
import { PRIORITY_CONFIG } from "./types";

interface CalendarViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
}

const MONTH_NAMES = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const PRIORITY_BORDER: Record<TaskPriority, string> = { 0: "#94a3b8", 1: "#3b82f6", 2: "#eab308", 3: "#f97316", 4: "#ef4444" };

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CalendarView({ tasks, onToggleStatus }: CalendarViewProps) {
  const today = useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today));
  const [overviewOpen, setOverviewOpen] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const calendarDays = [
    ...Array.from({ length: firstDayOfMonth }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ] as (number | null)[];

  const taskMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((task) => {
      if (!task.dueDate) return;
      const key = dateKey(new Date(task.dueDate));
      map.set(key, [...(map.get(key) ?? []), task]);
    });
    return map;
  }, [tasks]);
  const selectedTasks = taskMap.get(selectedDate) ?? [];
  const selectedDateValue = new Date(`${selectedDate}T00:00:00`);

  const selectDay = (day: number, closeOverview = false) => {
    const date = new Date(year, month, day);
    setSelectedDate(dateKey(date));
    if (closeOverview) setOverviewOpen(false);
  };
  const navigateMonth = (delta: number) => setCurrentDate(new Date(year, month + delta, 1));
  const goToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(dateKey(today));
    setOverviewOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="relative flex items-center justify-between">
        <button onClick={() => navigateMonth(-1)} className="rounded-lg p-2 transition-colors hover:bg-accent" title="上个月"><ChevronLeft className="h-4 w-4" /></button>
        <button onClick={() => setOverviewOpen((open) => !open)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-semibold transition-colors hover:bg-accent" aria-expanded={overviewOpen}>
          <CalendarDays className="h-4 w-4 text-primary" />{year}年 {MONTH_NAMES[month]}<ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", overviewOpen && "rotate-180")} />
        </button>
        <button onClick={() => navigateMonth(1)} className="rounded-lg p-2 transition-colors hover:bg-accent" title="下个月"><ChevronRight className="h-4 w-4" /></button>

        {overviewOpen && (
          <div className="absolute left-1/2 top-11 z-40 w-[340px] -translate-x-1/2 rounded-2xl border border-border bg-background p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <button onClick={() => setCurrentDate(new Date(year - 1, month, 1))} className="rounded-md p-1.5 hover:bg-accent" title="上一年"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-sm font-semibold">{year} 年</span>
              <button onClick={() => setCurrentDate(new Date(year + 1, month, 1))} className="rounded-md p-1.5 hover:bg-accent" title="下一年"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_NAMES.map((name, index) => <button key={name} onClick={() => setCurrentDate(new Date(year, index, 1))} className={cn("rounded-lg px-2 py-1.5 text-xs transition-colors", index === month ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>{name}</button>)}
            </div>
            <div className="my-3 h-px bg-border" />
            <div className="grid grid-cols-7 gap-1 text-center">{WEEK_DAYS.map((day) => <span key={day} className="py-1 text-[10px] text-muted-foreground">{day}</span>)}{calendarDays.map((day, index) => day === null ? <span key={`mini-empty-${index}`} /> : <button key={day} onClick={() => selectDay(day, true)} className={cn("flex h-7 items-center justify-center rounded-md text-[11px] hover:bg-accent", selectedDate === dateKey(new Date(year, month, day)) && "bg-primary text-primary-foreground hover:bg-primary")}>{day}</button>)}</div>
            <button onClick={goToday} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"><RotateCcw className="h-3 w-3" />回到今天</button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1">{WEEK_DAYS.map((day) => <div key={day} className="py-1.5 text-center text-xs font-medium text-muted-foreground">{day}</div>)}</div>

      <div className="grid grid-cols-7 gap-1.5">
        {calendarDays.map((day, index) => {
          if (day === null) return <div key={`empty-${index}`} className="min-h-[96px]" />;
          const key = dateKey(new Date(year, month, day));
          const dayTasks = taskMap.get(key) ?? [];
          const isToday = key === dateKey(today);
          const isSelected = key === selectedDate;
          return (
            <button key={day} onClick={() => selectDay(day)} className={cn("min-h-[96px] min-w-0 rounded-xl border p-2 text-left transition-all hover:border-primary/40 hover:bg-accent/25", isToday ? "border-primary/60 bg-primary/5" : "border-border/70", isSelected && "ring-2 ring-primary/25 border-primary")}>
              <div className="mb-1.5 flex items-center justify-between"><span className={cn("flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold", isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{day}</span>{dayTasks.length > 0 && <span className="text-[9px] text-muted-foreground">{dayTasks.length} 项</span>}</div>
              <div className="space-y-1">
                {dayTasks.slice(0, 2).map((task) => <div key={task.id} title={task.title} className={cn("flex min-w-0 items-center gap-1.5 rounded-md border-l-2 bg-muted/70 px-1.5 py-1 text-[10px]", task.status === "done" && "opacity-60 line-through")} style={{ borderLeftColor: PRIORITY_BORDER[task.priority as TaskPriority] }}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: task.list?.color ?? "#94a3b8" }} /><span className="min-w-0 flex-1 truncate">{task.title}</span></div>)}
                {dayTasks.length > 2 && <div className="rounded-md bg-primary/10 px-1.5 py-1 text-center text-[10px] font-medium text-primary">+{dayTasks.length - 2} 更多</div>}
              </div>
            </button>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3"><div><h3 className="text-sm font-semibold">{selectedDateValue.getMonth() + 1}月{selectedDateValue.getDate()}日任务</h3><p className="mt-0.5 text-[11px] text-muted-foreground">{selectedTasks.length > 0 ? `共 ${selectedTasks.length} 项，点击圆圈可更新完成状态` : "当前日期没有截止任务"}</p></div><span className="rounded-full bg-background px-2 py-1 text-xs text-muted-foreground shadow-sm">{selectedTasks.length}</span></div>
        {selectedTasks.length > 0 ? <div className="divide-y divide-border/70">{selectedTasks.map((task) => {
          const priority = PRIORITY_CONFIG[task.priority as TaskPriority];
          return <div key={task.id} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/30"><button onClick={() => onToggleStatus(task.id, task.status)} className="mt-0.5 shrink-0" title={task.status === "done" ? "标记为未完成" : "标记为已完成"}>{task.status === "done" ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <Circle className="h-5 w-5 text-muted-foreground group-hover:text-primary" />}</button><div className="min-w-0 flex-1"><p className={cn("break-words text-sm font-medium leading-5", task.status === "done" && "text-muted-foreground line-through")}>{task.title}</p><div className="mt-1.5 flex flex-wrap items-center gap-1.5">{task.dueTime && <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"><Clock3 className="h-3 w-3" />{task.dueTime}</span>}{task.priority > 0 && <span className={cn("flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px]", priority.color)}><Flag className="h-3 w-3 fill-current" />{priority.label}优先级</span>}{task.list && <span className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ color: task.list.color, backgroundColor: `${task.list.color}18` }}>{task.list.name}</span>}{task.tags?.map((tag) => <span key={tag.id} className="rounded-md px-1.5 py-0.5 text-[10px]" style={{ color: tag.color, backgroundColor: `${tag.color}18` }}>#{tag.name}</span>)}</div></div></div>;
        })}</div> : <div className="flex flex-col items-center py-8 text-muted-foreground"><CalendarDays className="mb-2 h-7 w-7 opacity-40" /><p className="text-xs">选择其他日期查看任务</p></div>}
      </section>

      {tasks.some((task) => !task.dueDate && task.status !== "done") && <div className="border-t border-border pt-3"><h3 className="mb-2 text-xs font-medium text-muted-foreground">无截止日期</h3><div className="flex flex-wrap gap-2">{tasks.filter((task) => !task.dueDate && task.status !== "done").slice(0, 10).map((task) => <span key={task.id} className="max-w-[240px] truncate rounded-md bg-muted px-2 py-1 text-xs" title={task.title}>{task.title}</span>)}</div></div>}
    </div>
  );
}
