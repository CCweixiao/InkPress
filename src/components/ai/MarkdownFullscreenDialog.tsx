"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Markdown } from "./Markdown";

/**
 * 全屏 Markdown 查看弹窗。
 * 用于把对话中的 assistant 文本放大全屏阅读。复用 ui/dialog，全屏尺寸仿 ArticleDiffDialog。
 */
export function MarkdownFullscreenDialog({
  open,
  onOpenChange,
  text,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text: string;
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[96vh] w-[98vw] max-w-none overflow-hidden rounded-xl p-0 gap-0">
        <DialogTitle className="sr-only">{title ?? "内容查看"}</DialogTitle>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <span className="text-sm font-medium truncate">{title ?? "内容查看"}</span>
        </div>
        <div className="overflow-y-auto px-8 py-6">
          <Markdown className="markdown-fullscreen max-w-3xl mx-auto">{text}</Markdown>
        </div>
      </DialogContent>
    </Dialog>
  );
}
