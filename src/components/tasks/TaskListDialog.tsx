"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899",
] as const;

interface TaskListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId?: string | null;
  folders?: { id: string; name: string }[];
  onSaved: () => void;
  // 编辑模式（可选）
  list?: { id: string; name: string; color: string; folderId: string | null } | null;
}

export function TaskListDialog({ open, onOpenChange, folderId, folders = [], onSaved, list }: TaskListDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PRESET_COLORS[0]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(list?.name ?? "");
      setColor(list?.color ?? PRESET_COLORS[0]);
      setSelectedFolderId(list?.folderId ?? folderId ?? null);
    }
  }, [open, list, folderId]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    if (list) {
      await fetch(`/api/tasks/lists/${list.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId }),
      });
    } else {
      await fetch("/api/tasks/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color, folderId: selectedFolderId }),
      });
    }
    onSaved();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!list) return;
    if (!confirm(`删除「${list.name}」？其下任务将移入垃圾箱。`)) return;
    await fetch(`/api/tasks/lists/${list.id}`, { method: "DELETE" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={() => onOpenChange(false)} />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 w-96 bg-background border border-border rounded-xl shadow-2xl p-4">
        <h3 className="font-medium mb-3">{list ? "编辑清单" : "新建清单"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="清单名称"
          className="w-full px-3 py-2 bg-muted rounded-md text-sm outline-none mb-3"
        />
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-1.5">颜色</p>
          <div className="flex gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn("w-6 h-6 rounded-full transition-transform", color === c && "ring-2 ring-offset-2 ring-primary scale-110")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        {folders.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted-foreground mb-1.5">所属文件夹</p>
            <select
              value={selectedFolderId ?? ""}
              onChange={(e) => setSelectedFolderId(e.target.value || null)}
              className="w-full px-3 py-2 bg-muted rounded-md text-sm outline-none"
            >
              <option value="">（顶层独立清单）</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex justify-between mt-4">
          {list ? (
            <button onClick={handleDelete} className="text-xs text-red-500 hover:underline">删除清单</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md">取消</button>
            <button onClick={handleSave} disabled={!name.trim()} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50">保存</button>
          </div>
        </div>
      </div>
    </>
  );
}
