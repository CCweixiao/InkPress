"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list";

/** 列表 / 网格 视图切换（胶囊式，与项目既有 tab 风格一致） */
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={cn(
          "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
          value === "grid"
            ? "bg-background shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="网格视图"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        网格
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={cn(
          "flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors",
          value === "list"
            ? "bg-background shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        )}
        title="列表视图"
      >
        <List className="h-3.5 w-3.5" />
        列表
      </button>
    </div>
  );
}
