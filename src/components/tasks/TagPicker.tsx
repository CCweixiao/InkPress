"use client";

import { useState, useEffect } from "react";
import { Tag as TagIcon, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TaskTagInfo } from "./types";

interface TagPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => boolean | void | Promise<boolean | void>;
  /** 最多可选标签数，默认 5 */
  max?: number;
  disabled?: boolean;
}

export function TagPicker({ selectedIds, onChange, max = 5, disabled = false }: TagPickerProps) {
  const [tags, setTags] = useState<TaskTagInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const activeIds = pendingIds ?? selectedIds;

  useEffect(() => {
    setPendingIds(null);
  }, [selectedIds]);

  useEffect(() => {
    if (open) {
      fetch("/api/tags")
        .then((r) => r.json())
        .then((data) => setTags(data.tags ?? []))
        .catch(() => setTags([]));
    }
  }, [open]);

  const toggle = async (id: string) => {
    if (saving || disabled) return;
    const nextIds = activeIds.includes(id)
      ? activeIds.filter((tagId) => tagId !== id)
      : activeIds.length < max ? [...activeIds, id] : null;
    if (!nextIds) return;

    setPendingIds(nextIds);
    setSaving(true);
    try {
      const updated = await onChange(nextIds);
      if (updated === false) setPendingIds(null);
    } catch {
      setPendingIds(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button disabled={disabled} className="rounded p-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50" title={disabled ? "子任务继承父任务标签" : "标签"}>
          <TagIcon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-3 text-center">
            请先在标签管理中创建标签
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-muted-foreground border-b border-border mb-1">
              <span>选择标签</span>
              <span className={cn("tabular-nums", activeIds.length >= max && "text-orange-500 font-medium")}>
                {activeIds.length}/{max}
              </span>
            </div>
            {tags.map((tag) => {
              const checked = activeIds.includes(tag.id);
              const disabled = saving || (!checked && activeIds.length >= max);
              return (
                <button
                  key={tag.id}
                  onClick={() => void toggle(tag.id)}
                  disabled={disabled}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-sm hover:bg-accent text-left transition-colors",
                    disabled && "opacity-40 cursor-not-allowed hover:bg-transparent"
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1 truncate">{tag.name}</span>
                  {checked && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              );
            })}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
