"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
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

export function PublishDialog({
  open,
  onOpenChange,
  articleId,
  title,
  digest,
  themes,
  defaultThemeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  articleId: string;
  title: string;
  digest: string;
  themes: ThemeOption[];
  defaultThemeId: string | null;
}) {
  const [summary, setSummary] = useState(digest);
  const [themeId, setThemeId] = useState<string>(defaultThemeId ?? themes[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // 先保存摘要/主题到文章
      await fetch(`/api/articles/${articleId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ digest: summary, themeId, status: "ready" }),
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
