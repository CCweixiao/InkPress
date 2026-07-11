"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRESET_TAG_COLORS } from "@/lib/tasks/tag-colors";

export interface TagInfo {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

interface TagEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑模式传入；新建模式传 null。 */
  tag: TagInfo | null;
  /** 新建时预选的父标签 id；null = 一级。 */
  defaultParentId?: string | null;
  /** 可选父标签列表（仅一级标签 + "无（一级标签）"）。 */
  parentOptions: TagInfo[];
  onSaved: () => void;
}

export function TagEditDialog({
  open,
  onOpenChange,
  tag,
  defaultParentId,
  parentOptions,
  onSaved,
}: TagEditDialogProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("#6b7280");
  const [parentId, setParentId] = useState<string>("__none__");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? "");
      setColor(tag?.color ?? "#6b7280");
      setParentId(tag?.parentId ?? defaultParentId ?? "__none__");
      setError(null);
    }
  }, [open, tag, defaultParentId]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError("名称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      color,
      parentId: parentId === "__none__" ? null : parentId,
    };
    try {
      const url = tag ? `/api/tags/${tag.id}` : "/api/tags";
      const method = tag ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "保存失败");
        setSaving(false);
        return;
      }
      onSaved();
      onOpenChange(false);
      setSaving(false);
    } catch {
      setError("网络错误");
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tag) return;
    if (!confirm(`确认删除标签「${tag.name}」？\n子标签会提升为一级，关联任务保留（仅摘掉该标签）。`)) {
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "删除失败");
      setSaving(false);
      return;
    }
    onSaved();
    onOpenChange(false);
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tag ? "编辑标签" : "新建标签"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tag-name">名称</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="标签名"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>颜色</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full border-2 transition-transform ${
                    color === c ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`选择颜色 ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>父标签</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger>
                <SelectValue placeholder="选择父标签" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">无（一级标签）</SelectItem>
                {parentOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {tag && (
            <Button variant="destructive" onClick={handleDelete} disabled={saving} className="mr-auto">
              删除
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
