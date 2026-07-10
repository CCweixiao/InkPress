"use client";

import { useState, useEffect } from "react";
import { Tag as TagIcon, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { TaskTagInfo } from "./types";

interface TagPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function TagPicker({ selectedIds, onChange }: TagPickerProps) {
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
          tags.map((tag) => {
            const checked = selectedIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggle(tag.id)}
                className={cn(
                  "flex items-center gap-2 w-full px-2 py-1.5 rounded-sm text-sm hover:bg-accent text-left"
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
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
