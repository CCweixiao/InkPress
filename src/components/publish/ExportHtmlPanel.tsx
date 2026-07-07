"use client";

import { useEffect, useState } from "react";
import { Copy, Check, Loader2 } from "lucide-react";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ThemeOption } from "@/components/editor/EditorWorkspace";
import type { ChannelMeta } from "@/lib/publish/channels/meta";

/**
 * 导出可粘贴 HTML 面板（export-html 渠道：知乎/掘金/博客园/通用）。
 *
 * 调 /api/preview 传 channel 参数，拿到该渠道 finalize 后的全内联 HTML，
 * 展示预览 + 一键复制。主题切换时自动重新生成。
 */
export function ExportHtmlPanel({
  articleId,
  themes,
  defaultThemeId,
  channel,
}: {
  articleId: string;
  themes: ThemeOption[];
  defaultThemeId: string | null;
  channel: ChannelMeta;
}) {
  const [themeId, setThemeId] = useState<string>(
    defaultThemeId ?? themes[0]?.id ?? ""
  );
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function fetchHtml() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, themeId, channel: channel.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setHtml(data.html);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  // 主题或渠道变化时重新生成（首次挂载也触发）。
  // 异步数据获取：fetch + setState 在 await 之后，非同步级联渲染。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHtml();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId, channel.id]);

  async function copyHtml() {
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择 HTML 复制");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>导出到{channel.label}</DialogTitle>
        <DialogDescription>{channel.publishHint}</DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
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

        {loading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            正在生成 {channel.label} 格式…
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {html && !loading && (
          <div className="space-y-2">
            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border bg-white p-4">
              <div
                className="wechat-article-content"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
            <Button onClick={copyHtml} className="w-full">
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "已复制到剪贴板" : `复制 HTML（${html.length} 字符）`}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
