"use client";

import { useState, useEffect, useCallback } from "react";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { PRESET_TAG_COLORS, normalizeColor } from "@/lib/tasks/tag-colors";

interface TagRow {
  id: string;
  name: string;
  color: string;
  _count?: { tasks: number };
}

interface TagManageDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TagManageDialog({ open, onOpenChange }: TagManageDialogProps) {
  const [tags, setTags] = useState<TagRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(PRESET_TAG_COLORS[0]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(PRESET_TAG_COLORS[0]);
  const [error, setError] = useState("");
  const { confirm: confirmDialog, dialog: confirmElement } = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/tags");
    if (res.ok) {
      const data = await res.json();
      setTags(data.tags ?? []);
    }
  }, []);

  useEffect(() => {
    if (open) {
      load();
      setError("");
      setNewName("");
      setNewColor(PRESET_TAG_COLORS[0]);
    }
  }, [open, load]);

  const startEdit = (tag: TagRow) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(normalizeColor(tag.color));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/tags/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), color: editColor }),
    });
    if (res.status === 409) {
      setError("标签名已存在");
      return;
    }
    if (!res.ok) return;
    setEditingId(null);
    setError("");
    await load();
  };

  const handleDelete = async (tag: TagRow) => {
    const ok = await confirmDialog({
      title: "删除标签",
      description: `将解除 ${tag._count?.tasks ?? 0} 个任务的关联，任务本身保留。确定删除「${tag.name}」？`,
    });
    if (!ok) return;
    const res = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    });
    if (res.status === 409) {
      setError("标签名已存在");
      return;
    }
    if (!res.ok) return;
    setNewName("");
    setNewColor(PRESET_TAG_COLORS[0]);
    setError("");
    await load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>标签管理</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {tags.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">暂无标签</p>
          )}
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent">
              {editingId === tag.id ? (
                <>
                  <ColorSwatches value={editColor} onChange={setEditColor} />
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-7 text-sm flex-1"
                    autoFocus
                  />
                  <button onClick={saveEdit} className="p-1 hover:text-primary" title="保存">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1 hover:text-muted-foreground" title="取消">
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: normalizeColor(tag.color) }} />
                  <span className="flex-1 text-sm truncate">{tag.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {tag._count?.tasks ?? 0} 个任务
                  </span>
                  <button onClick={() => startEdit(tag)} className="p-1 text-muted-foreground hover:text-foreground" title="编辑">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(tag)} className="p-1 text-muted-foreground hover:text-red-500" title="删除">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* 新建标签 */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <ColorSwatches value={newColor} onChange={setNewColor} />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="新标签名"
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus className="h-4 w-4" />
            新建
          </Button>
        </div>
      </DialogContent>
      {confirmElement}
    </Dialog>
  );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {PRESET_TAG_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "w-5 h-5 rounded-full border-2 transition-transform",
            value === c ? "border-foreground scale-110" : "border-transparent"
          )}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
      <label className="relative w-5 h-5 rounded-full border border-border cursor-pointer overflow-hidden" title="自定义">
        <span className="absolute inset-0" style={{ backgroundColor: value }} />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}
