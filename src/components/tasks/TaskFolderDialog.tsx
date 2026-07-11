"use client";

import { useState, useEffect } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";

interface TaskFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  // 编辑模式（可选）
  folder?: { id: string; name: string } | null;
}

export function TaskFolderDialog({ open, onOpenChange, onSaved, folder }: TaskFolderDialogProps) {
  const [name, setName] = useState("");
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  useEffect(() => {
    if (open) setName(folder?.name ?? "");
  }, [open, folder]);

  if (!open) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    if (folder) {
      await fetch(`/api/tasks/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
    } else {
      await fetch("/api/tasks/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
    }
    onSaved();
    onOpenChange(false);
  };

  const handleDelete = async () => {
    if (!folder) return;
    const ok = await confirmDialog({
      title: "删除文件夹",
      description: `「${folder.name}」将被删除，其下清单提升为顶层独立清单。`,
    });
    if (!ok) return;
    await fetch(`/api/tasks/folders/${folder.id}`, { method: "DELETE" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-50" onClick={() => onOpenChange(false)} />
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 w-80 bg-background border border-border rounded-xl shadow-2xl p-4">
        <h3 className="font-medium mb-3">{folder ? "重命名文件夹" : "新建文件夹"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          placeholder="文件夹名称"
          className="w-full px-3 py-2 bg-muted rounded-md text-sm outline-none"
        />
        <div className="flex justify-between mt-4">
          {folder ? (
            <button onClick={handleDelete} className="text-xs text-red-500 hover:underline">删除</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={() => onOpenChange(false)} className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md">取消</button>
            <button onClick={handleSave} disabled={!name.trim()} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50">保存</button>
          </div>
        </div>
      </div>
      {confirmElement}
    </>
  );
}
