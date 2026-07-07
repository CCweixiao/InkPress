"use client";

import { Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface SnippetTagSidebarProps {
  tags: { name: string; count: number }[];
  activeTag: string | null;
  onSelectTag: (tag: string) => void;
}

export function SnippetTagSidebar({
  tags,
  activeTag,
  onSelectTag,
}: SnippetTagSidebarProps) {
  return (
    <aside className="hidden md:block w-48 shrink-0">
      <div className="sticky top-20 space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 px-2">
          标签
        </h3>
        {tags.map(({ name, count }) => (
          <button
            key={name}
            onClick={() => onSelectTag(name)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left",
              activeTag === name
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Hash className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate flex-1">{name}</span>
            <span className="text-xs opacity-60">{count}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
