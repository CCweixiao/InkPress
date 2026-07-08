"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { MAX_TAG_LEN } from "@/lib/snippets/batch-ops";

interface BatchTagPickerProps {
  /** add：候选用全量已有标签；remove：候选用选中项标签 union（外部算好传入）。 */
  mode: "add" | "remove";
  candidates: string[];
  label: string;
  disabled?: boolean;
  onPick: (tag: string) => void;
}

/**
 * 选择模式下的 tag picker：过滤输入 + 候选列表 +（add 模式）新建行。
 * 单次选一个标签 → onPick → 关闭。加/移除共用。
 */
export function BatchTagPicker({
  mode,
  candidates,
  label,
  disabled,
  onPick,
}: BatchTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () => candidates.filter((t) => (query ? t.toLowerCase().includes(query) : true)),
    [candidates, query]
  );
  const exactExists = candidates.some((t) => t.toLowerCase() === query);
  const canCreate =
    mode === "add" && query.length > 0 && query.length <= MAX_TAG_LEN && !exactExists;

  const pick = (tag: string) => {
    onPick(tag);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="text-xs rounded-md border border-transparent px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={mode === "add" ? "搜索或新建标签" : "搜索标签"}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <div className="mt-1 max-h-52 overflow-auto">
          {filtered.map((t) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // 防 blur 先于 click
                pick(t);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              #{t}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(q.trim());
              }}
              className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              新建「{q.trim()}」
            </button>
          )}
          {filtered.length === 0 && !canCreate && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {mode === "remove" ? "选中项没有标签" : "无匹配标签"}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
