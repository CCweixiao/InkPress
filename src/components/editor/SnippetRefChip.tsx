"use client";

import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** 托盘里的灵感引用 chip（不可编辑，× 可删）。 */
export function SnippetRefChip({
  displayText,
  color,
  onDelete,
}: {
  displayText: string;
  color: string | null;
  onDelete: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
      )}
    >
      <Sparkles className="h-3 w-3 shrink-0" />
      <span className="max-w-[12rem] truncate">{displayText}</span>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onDelete();
        }}
        aria-label={`移除引用 ${displayText}`}
        className="shrink-0 rounded-full hover:bg-primary/20"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
