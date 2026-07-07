"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "./types";
import { PRIORITY_CONFIG } from "./types";
import type { TaskPriority } from "./types";

interface CalendarViewProps {
  tasks: Task[];
  onToggleStatus: (id: string, status: TaskStatus) => void;
  onUpdate: (id: string, data: Partial<Task>) => void;
}

export function CalendarView({ tasks, onToggleStatus, onUpdate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const calendarDays = useMemo(() => {
    const days: (number | null)[] = [];
    // Fill in empty days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    return days;
  }, [daysInMonth, firstDayOfMonth]);

  const getTasksForDay = (day: number) => {
    return tasks.filter((task) => {
      if (!task.dueDate) return false;
      const dueDate = new Date(task.dueDate);
      return (
        dueDate.getFullYear() === year &&
        dueDate.getMonth() === month &&
        dueDate.getDate() === day
      );
    });
  };

  const today = new Date();
  const isToday = (day: number) =>
    day === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();

  const navigateMonth = (delta: number) => {
    setCurrentDate(new Date(year, month + delta, 1));
  };

  const monthNames = [
    "一月", "二月", "三月", "四月", "五月", "六月",
    "七月", "八月", "九月", "十月", "十一月", "十二月",
  ];
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div className="space-y-4">
      {/* Calendar header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateMonth(-1)}
          className="p-2 hover:bg-accent rounded-lg transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-medium">
          {year}年 {monthNames[month]}
        </h2>
        <button
          onClick={() => navigateMonth(1)}
          className="p-2 hover:bg-accent rounded-lg transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Week days header */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-xs text-muted-foreground py-2 font-medium">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="min-h-[80px]" />;
          }

          const dayTasks = getTasksForDay(day);
          const hasOverdue = dayTasks.some(
            (t) => t.status !== "done" && new Date(t.dueDate!) < today
          );

          return (
            <div
              key={day}
              className={cn(
                "min-h-[80px] p-1.5 rounded-lg border transition-colors",
                isToday(day)
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:bg-accent/30"
              )}
            >
              <div
                className={cn(
                  "text-xs font-medium mb-1",
                  isToday(day) ? "text-primary" : "text-muted-foreground"
                )}
              >
                {day}
              </div>
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => onToggleStatus(task.id, task.status)}
                    className={cn(
                      "w-full text-left text-[11px] px-1 py-0.5 rounded truncate transition-all",
                      task.status === "done"
                        ? "line-through text-muted-foreground bg-muted/50"
                        : "bg-accent/50 hover:bg-accent"
                    )}
                    title={task.title}
                  >
                    {task.priority > 0 && (
                      <span className="mr-0.5">
                        {PRIORITY_CONFIG[task.priority as TaskPriority].emoji}
                      </span>
                    )}
                    {task.title}
                  </button>
                ))}
                {dayTasks.length > 3 && (
                  <span className="text-[10px] text-muted-foreground px-1">
                    +{dayTasks.length - 3} 更多
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tasks without due date */}
      {tasks.filter((t) => !t.dueDate && t.status !== "done").length > 0 && (
        <div className="border-t border-border pt-3">
          <h3 className="text-sm text-muted-foreground mb-2">无截止日期</h3>
          <div className="flex flex-wrap gap-2">
            {tasks
              .filter((t) => !t.dueDate && t.status !== "done")
              .slice(0, 10)
              .map((task) => (
                <span
                  key={task.id}
                  className="text-xs px-2 py-1 bg-muted rounded-md"
                >
                  {task.title}
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
