"use client";

import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * 发布前公众号效果预览：
 * 调用 /api/preview 获取服务端 juice 全量转换后的微信安全 HTML，
 * 在弹窗里以公众号样式渲染（即推送草稿箱后的真实效果）。
 */
export function PublishPreview({
  articleId,
  themeId,
}: {
  articleId: string;
  themeId: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function fetchPreview() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setHtml(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, themeId: themeId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "预览生成失败");
      setHtml(data.html);
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={fetchPreview}
        >
          <Eye className="h-4 w-4" />
          预览公众号效果
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>公众号效果预览</DialogTitle>
          <DialogDescription>
            下方为转换后的最终效果（与推送草稿箱内容一致）。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            正在转换为公众号格式…
          </div>
        ) : error ? (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-white dark:bg-neutral-900 p-4">
            <div
              className="wechat-article-content"
              dangerouslySetInnerHTML={{ __html: html ?? "" }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
