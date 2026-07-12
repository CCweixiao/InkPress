"use client";

import { useState, useEffect } from "react";
import { Tag as TagIcon, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TaskTagInfo } from "./types";

interface TagPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** 最多可选标签数，默认 5 */
  max?: number;
}

export function TagPicker({ selectedIds, onChange, max = 5 }: TagPickerProps) {
  const [tags, setTags] = useState<TaskTagInfo[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/tags")
        .then((r) => r.json())
        .then((data) => setTags(data.tags ?? []))
        .catch(() => setTags([]));
    }
  }, [open]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((t) => t !== id));
    } else {
      if (selectedIds.length >= max) return;
      onChange([...selectedIds, id]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="p-1 text-muted-foreground hover:text-foreground rounded" title="标签">
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
              <span className={cn("tabular-nums", selectedIds.length >= max && "text-orange-500 font-medium")}>
                {selectedIds.length}/{max}
              </span>
            </div>
            {tags.map((tag) => {
              const checked = selectedIds.includes(tag.id);
              const disabled = !checked && selectedIds.length >= max;
              return (
                <button
                  key={tag.id}
                  onClick={() => toggle(tag.id)}
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
