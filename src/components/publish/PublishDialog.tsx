"use client";

import { useState } from "react";
import { Send, Loader2, ImagePlus, ImageIcon } from "lucide-react";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";
import { PublishPreview } from "./PublishPreview";

export function PublishDialog({
  open,
  onOpenChange,
  articleId,
  title,
  digest,
  coverMediaId,
  themes,
  defaultThemeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  title: string;
  digest: string;
  coverMediaId: string | null;
  themes: ThemeOption[];
  defaultThemeId: string | null;
}) {
  const [summary, setSummary] = useState(digest);
  const [themeId, setThemeId] = useState<string>(defaultThemeId ?? themes[0]?.id ?? "");
  const [cover, setCover] = useState<string | null>(coverMediaId);
  const [coverUploading, setCoverUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUploadCover(file: File) {
    setCoverUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("media", file);
      fd.append("kind", "cover");
      const res = await fetch("/api/wechat/upload-material", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "封面上传失败");
      setCover(data.mediaId);
      // 持久化到文章
      await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coverMediaId: data.mediaId }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "封面上传失败");
    } finally {
      setCoverUploading(false);
    }
  }

  async function handlePublish() {
    setLoading(true);
    setError(null);
    setResult(null);
    if (!cover) {
      setError("请先上传封面图");
      setLoading(false);
      return;
    }
    try {
      // 先保存摘要/主题/封面到文章
      await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          digest: summary,
          themeId,
          coverMediaId: cover,
          status: "ready",
        }),
      });
      // 推送草稿箱
      const res = await fetch("/api/wechat/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, themeId, digest: summary }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "推送失败");
      setResult(data.message || "已推送到公众号草稿箱");
    } catch (e) {
      setError(e instanceof Error ? e.message : "推送失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发布到公众号草稿箱</DialogTitle>
          <DialogDescription>
            选择排版主题，确认后将文章转为公众号格式并推送至草稿箱（发布需在公众号后台手动操作）。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="rounded-md bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-700">
            ✓ {result}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>文章标题</Label>
              <Input value={title} readOnly className="bg-muted/50" />
            </div>
            <div className="space-y-1.5">
              <Label>摘要（可选，≤120 字）</Label>
              <Input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={120}
                placeholder="留空则由公众号自动截取"
              />
            </div>
            <div className="space-y-1.5">
              <Label>封面图（必填）</Label>
              {cover ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <ImageIcon className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs text-emerald-700 flex-1 truncate">
                    封面已上传（media_id 已保存）
                  </span>
                  <button
                    onClick={() => setCover(null)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    移除
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-4 text-sm text-muted-foreground hover:bg-accent cursor-pointer">
                  {coverUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      上传中…
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-4 w-4" />
                      点击上传封面（建议 900×383）
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={coverUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUploadCover(f);
                    }}
                  />
                </label>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>排版主题</Label>
              <Select value={themeId} onValueChange={setThemeId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择主题" />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 发布前公众号效果预览（服务端 juice 全量转换） */}
            <PublishPreview articleId={articleId} themeId={themeId} />

            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                取消
              </Button>
              <Button onClick={handlePublish} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                推送草稿箱
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
