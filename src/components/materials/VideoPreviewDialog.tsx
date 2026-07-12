"use client";

import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 视频预览弹窗：缩略图点击后打开内联播放器。
 * - 顶部工具条：文件名 + 关闭按钮
 * - 中间：<video controls autoPlay>，最大高 78vh
 * 图片预览请用 ImagePreviewDialog（支持缩放/平移）。
 */
export function VideoPreviewDialog({
  url,
  name,
  open,
  onOpenChange,
}: {
  url: string | null;
  name?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-4xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{name ?? "视频预览"}</DialogTitle>

        <div className="flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {name ?? ""}
          </span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="ml-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="关闭（Esc）"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex max-h-[78vh] min-h-[40vh] items-center justify-center overflow-hidden bg-neutral-900 dark:bg-neutral-950">
          {url ? (
            <video
              src={url}
              controls
              autoPlay
              className="max-h-[78vh] max-w-full"
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
