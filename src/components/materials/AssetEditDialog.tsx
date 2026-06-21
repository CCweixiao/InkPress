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
import { Badge } from "@/components/ui/badge";
import type { Asset } from "@/types/asset";
import { parseTags } from "@/lib/asset";

/** 编辑素材元数据（描述 / 标签）。名称为系统生成的 UUID，不可改。 */
export function AssetEditDialog({
  asset,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: Asset | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (asset: Asset) => void;
}) {
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && asset) {
      setDescription(asset.description ?? "");
      setTagsInput(parseTags(asset.tagsJson).join(", "));
      setError("");
    }
  }, [open, asset]);

  if (!asset) return null;

  async function save() {
    setError("");
    setLoading(true);
    const tags = tagsInput
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`/api/materials/${asset!.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, tags }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.formErrors?.[0] || data.error || "保存失败");
        return;
      }
      onOpenChange(false);
      onSaved?.(data.asset as Asset);
    } finally {
      setLoading(false);
    }
  }

  const previewTags = tagsInput
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>编辑素材信息</DialogTitle>
          <DialogDescription>
            补充描述与标签，AI 生成文章时会据此判断在何处插入该素材。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 预览缩略 + 名称（只读） */}
          <div className="flex items-center gap-3 rounded-md border border-border p-2">
            <div className="shrink-0">
              {asset.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded bg-muted" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">素材名（系统生成）</div>
              <div className="text-sm font-mono truncate">{asset.name}</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：封面主视觉，深色科技感背景"
              rows={3}
              maxLength={500}
            />
            <p className="text-[11px] text-muted-foreground">
              描述越具体，AI 自动插图越精准。
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>标签（逗号分隔）</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="封面, 主视觉, 科技"
            />
            {previewTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {previewTags.map((t) => (
                  <Badge key={t} variant="secondary">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>

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
