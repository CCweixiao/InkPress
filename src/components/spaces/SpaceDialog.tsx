"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NAME_REGEX } from "@/lib/validation";

export type SpaceForm = {
  id?: string;
  name: string;
  description: string;
  tags: string[];
  pinned?: boolean;
};

/** 新建 / 编辑空间弹窗 */
export function SpaceDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: SpaceForm | null;
  onSaved?: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setTagsInput((initial?.tags ?? []).join(", "));
      setPinned(initial?.pinned ?? false);
      setError("");
    }
  }, [open, initial]);

  async function save() {
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入空间名称");
      return;
    }
    if (trimmedName.length > 20) {
      setError("空间名称不能超过 20 字");
      return;
    }
    if (!NAME_REGEX.test(trimmedName)) {
      setError("空间名称包含不支持的字符");
      return;
    }
    if (description.length > 100) {
      setError("空间描述不能超过 100 字");
      return;
    }
    const tags = tagsInput
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length > 5) {
      setError("最多 5 个标签");
      return;
    }
    if (tags.some((t) => t.length > 10)) {
      setError("单个标签不能超过 10 字");
      return;
    }
    setLoading(true);
    try {
      const isEdit = !!initial?.id;
      const res = await fetch(
        isEdit ? `/api/spaces/${initial!.id}` : "/api/spaces",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description, tags, pinned }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.formErrors?.[0] || data.error || "保存失败");
        return;
      }
      onOpenChange(false);
      onSaved?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "编辑空间" : "新建空间"}</DialogTitle>
          <DialogDescription>
            用空间分类不同主题的文章。可填写名称、描述与标签。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>空间名称 *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：技术分享"
              maxLength={20}
            />
          </div>
          <div className="space-y-1.5">
            <Label>空间描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个空间用来放什么类型的文章…"
              rows={3}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label>标签（逗号分隔）</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="前端, AI, 随笔"
            />
            <p className="text-xs text-muted-foreground">
              {tagsInput
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean).length}
              /5 · 每个标签最多 10 字
            </p>
          </div>
          {/* 置顶开关：置顶后排序优先（默认空间除外，其不可编辑） */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm">置顶此空间（排在非置顶空间之前）</span>
          </label>
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
