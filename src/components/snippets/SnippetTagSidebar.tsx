"use client";

import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { getTagColorClasses, isValidTagColor } from "@/lib/snippets/tag-colors";
import { TagColorPicker } from "./TagColorPicker";

interface SnippetTagSidebarProps {
  tags: { name: string; count: number; color: string | null }[];
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  onSetTagColor: (name: string, color: string | null) => void;
}

export function SnippetTagSidebar({
  tags,
  activeTags,
  onToggleTag,
  onSetTagColor,
}: SnippetTagSidebarProps) {
  return (
    <aside className="hidden md:block w-48 shrink-0">
      <div className="sticky top-20 space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-2">
          标签
        </h3>
        {tags.map(({ name, count, color }) => {
          const active = activeTags.includes(name);
          const cls = getTagColorClasses(color);
          return (
            <div key={name} className="flex items-center gap-1 rounded-md">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="p-1.5 rounded hover:bg-muted shrink-0"
                    aria-label={`${name} 标签颜色`}
                    title="设置标签颜色"
                  >
                    <span
                      className={cn("block h-3 w-3 rounded-full", cls.dot)}
                    />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-3">
                  <TagColorPicker
                    value={isValidTagColor(color) ? color : null}
                    onSelect={(c) => onSetTagColor(name, c)}
                  />
                </PopoverContent>
              </Popover>
              <button
                onClick={() => onToggleTag(name)}
                className={cn(
                  "flex-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md border text-sm transition-colors text-left",
                  active
                    ? cls.active
                    : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Hash className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">{name}</span>
                <span className="text-xs opacity-60">{count}</span>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
