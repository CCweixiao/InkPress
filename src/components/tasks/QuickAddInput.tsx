"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Flag, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "./types";
import { PRIORITY_CONFIG } from "./types";

interface QuickAddInputProps {
  onAdd: (title: string, priority: TaskPriority, dueDate: string | null) => void;
  onCancel?: () => void;
  compact?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/** 解析自然语言中的日期 */
function parseNaturalDate(text: string): { cleanText: string; date: string | null } {
  const now = new Date();
  let date: Date | null = null;
  let cleanText = text;

  const patterns: [RegExp, (...args: string[]) => Date][] = [
    [/今天/g, () => now],
    [/明天/g, () => { const d = new Date(now); d.setDate(d.getDate() + 1); return d; }],
    [/后天/g, () => { const d = new Date(now); d.setDate(d.getDate() + 2); return d; }],
    [/下周一/g, () => { const d = new Date(now); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d; }],
    [/下周/g, () => { const d = new Date(now); d.setDate(d.getDate() + 7); return d; }],
    [/(\d{1,2})月(\d{1,2})[日号]/g, (_m: string, month: string, day: string) => { const d = new Date(now.getFullYear(), parseInt(month) - 1, parseInt(day)); return d; }],
  ];

  for (const [pattern, getDate] of patterns) {
    if (pattern.test(cleanText)) {
      date = typeof getDate === "function" ? getDate() : getDate;
      cleanText = cleanText.replace(pattern, "").trim();
      break;
    }
  }

  return {
    cleanText,
    date: date ? date.toISOString() : null,
  };
}

/** 解析优先级标签 */
function parsePriority(text: string): { cleanText: string; priority: TaskPriority } {
  const priorityPatterns: [RegExp, TaskPriority][] = [
    [/#(紧急|p4|urgent)/gi, 4],
    [/#(高优先级|高|p3|high)/gi, 3],
    [/#(中|p2|medium)/gi, 2],
    [/#(低|p1|low)/gi, 1],
  ];

  let cleanText = text;
  let priority: TaskPriority = 0;

  for (const [pattern, p] of priorityPatterns) {
    if (pattern.test(cleanText)) {
      priority = p;
      cleanText = cleanText.replace(pattern, "").trim();
      break;
    }
  }

  return { cleanText, priority };
}

export function QuickAddInput({ onAdd, onCancel, compact, placeholder, autoFocus }: QuickAddInputProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = () => {
    if (!value.trim()) return;

    const { cleanText: afterDate, date } = parseNaturalDate(value);
    const { cleanText: finalTitle, priority } = parsePriority(afterDate);

    if (finalTitle.trim()) {
      onAdd(finalTitle.trim(), priority, date);
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setValue("");
      onCancel?.();
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border transition-all duration-200",
        focused
          ? "border-primary shadow-sm ring-1 ring-primary/20"
          : "border-border",
        compact ? "px-2 py-1.5" : "px-3 py-2.5"
      )}
    >
      <Plus className={cn("shrink-0 text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? "添加任务... (支持 #高优先级 明天 等自然语言)"}
        className={cn(
          "flex-1 bg-transparent border-none outline-none placeholder:text-muted-foreground/60",
          compact ? "text-sm" : "text-sm"
        )}
      />
      {value && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd>
        </div>
      )}
    </div>
  );
}
