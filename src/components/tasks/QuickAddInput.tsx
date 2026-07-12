"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { TaskPriority } from "./types";
import { PRIORITY_CONFIG } from "./types";

interface QuickAddInputProps {
  onAdd: (title: string, priority: TaskPriority, dueDate: string | null) => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  compact?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  enablePriority?: boolean;
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
    [/#(紧急优先级|紧急|p4|urgent)/gi, 4],
    [/#(高优先级|高|p3|high)/gi, 3],
    [/#(中优先级|中|p2|medium)/gi, 2],
    [/#(低优先级|低|p1|low)/gi, 1],
    [/#(无优先级|无|p0|none)/gi, 0],
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

export function QuickAddInput({ onAdd, onCancel, compact, placeholder, autoFocus, enablePriority = true }: QuickAddInputProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activePriorityIndex, setActivePriorityIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hashIndex = enablePriority ? value.lastIndexOf("#") : -1;
  const hashQuery = hashIndex >= 0 && !/\s/.test(value.slice(hashIndex + 1))
    ? value.slice(hashIndex + 1).toLowerCase()
    : null;
  const priorityOptions = ([4, 3, 2, 1, 0] as TaskPriority[]).filter((priority) => {
    if (hashQuery === null) return false;
    const config = PRIORITY_CONFIG[priority];
    const aliases = priority === 4 ? "紧急 p4 urgent" : priority === 3 ? "高 高优先级 p3 high" : priority === 2 ? "中 p2 medium" : priority === 1 ? "低 p1 low" : "无 无优先级 p0 none";
    return `${config.label} ${aliases}`.toLowerCase().includes(hashQuery);
  });
  const priorityMenuOpen = focused && hashQuery !== null && priorityOptions.length > 0;

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = async () => {
    if (!value.trim() || saving) return;

    const { cleanText: afterDate, date } = parseNaturalDate(value);
    const { cleanText: finalTitle, priority } = enablePriority
      ? parsePriority(afterDate)
      : { cleanText: afterDate, priority: 0 as TaskPriority };

    if (finalTitle.trim()) {
      setSaving(true);
      try {
        const created = await onAdd(finalTitle.trim(), priority, date);
        // 失败时保留已输入内容，用户可以修改后重试。
        if (created !== false) setValue("");
      } catch {
        // 网络或接口异常时保留输入内容，便于用户重试。
      } finally {
        setSaving(false);
      }
    }
  };

  const selectPriority = (priority: TaskPriority) => {
    if (hashIndex < 0) return;
    const label = priority === 0 ? "无" : PRIORITY_CONFIG[priority].label;
    setValue(`${value.slice(0, hashIndex)}#${label} `);
    setActivePriorityIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 看板卡片本身支持键盘拖拽（Enter 可激活）。输入任务时必须隔离事件，
    // 否则会错误触发拖拽浮层并改变任务排序。
    e.stopPropagation();
    if (priorityMenuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActivePriorityIndex((index) => e.key === "ArrowDown"
        ? (index + 1) % priorityOptions.length
        : (index - 1 + priorityOptions.length) % priorityOptions.length);
      return;
    }
    if (priorityMenuOpen && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      selectPriority(priorityOptions[Math.min(activePriorityIndex, priorityOptions.length - 1)]);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
    if (e.key === "Escape") {
      setValue("");
      onCancel?.();
    }
  };

  return (
    <Popover open={priorityMenuOpen}>
      <PopoverAnchor asChild>
        <div
      className={cn(
        "relative flex items-center gap-2 rounded-lg border transition-all duration-200",
        focused
          ? "z-40 border-primary shadow-sm ring-1 ring-primary/20"
          : "border-border",
        compact ? "px-2 py-1.5" : "px-3 py-2.5"
      )}
      onPointerDown={(event) => event.stopPropagation()}
        >
          <Plus className={cn("shrink-0 text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            maxLength={50}
            disabled={saving}
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
      </PopoverAnchor>
      {priorityMenuOpen && (
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-[80] max-h-64 w-64 overflow-y-auto overscroll-contain rounded-xl border-slate-200 bg-white p-2 text-slate-950 shadow-2xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:ring-white/10"
        >
          <div className="px-2 pb-1.5 pt-0.5 text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">设置优先级</div>
          {priorityOptions.map((priority, index) => {
            const config = PRIORITY_CONFIG[priority];
            return (
              <button
                key={priority}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectPriority(priority)}
                onMouseEnter={() => setActivePriorityIndex(index)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors", index === activePriorityIndex ? "bg-blue-50 text-slate-950 dark:bg-blue-950/70 dark:text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800")}
              >
                <Flag className={cn("h-4 w-4", config.color)} />
                <span>{config.label}优先级</span>
                <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">#{priority === 0 ? "无" : config.label}</span>
              </button>
            );
          })}
        </PopoverContent>
      )}
    </Popover>
  );
}
