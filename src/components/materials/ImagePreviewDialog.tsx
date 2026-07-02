"use client";

import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const STEP = 0.25;

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * 图片预览弹窗：缩略图点击后放大查看。
 * - 缩放：＋/− 按钮（也可点中间百分比复位到 1x）；范围 0.5x–4x。
 * - 平移：缩放 > 1x 时可拖拽图片平移（pointer 事件 + setPointerCapture）。
 * - 切换图片 / 重新打开时自动复位到 1x。
 */
export function ImagePreviewDialog({
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
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // 拖拽起点：记录起始 client 坐标与当时的 pos，移动时据此差分更新。
  const dragRef = useRef<{
    sx: number;
    sy: number;
    px: number;
    py: number;
  } | null>(null);

  // 打开 / 切换图片时复位缩放与位移。
  useEffect(() => {
    if (open) {
      setZoom(1);
      setPos({ x: 0, y: 0 });
    }
  }, [open, url]);

  function applyZoom(next: number) {
    const z = clampZoom(next);
    setZoom(z);
    if (z <= 1) setPos({ x: 0, y: 0 });
  }

  function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
    if (zoom <= 1) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLImageElement>) {
    const start = dragRef.current;
    if (!start) return;
    setPos({
      x: start.px + (e.clientX - start.sx),
      y: start.py + (e.clientY - start.sy),
    });
  }
  function endDrag() {
    dragRef.current = null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-4xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{name ?? "图片预览"}</DialogTitle>

        {/* 工具条：文件名 + 缩放控件 + 关闭（统一收口，避免与右上角 X 重叠） */}
        <div className="flex items-center justify-between gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
          <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {name ?? ""}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => applyZoom(zoom - STEP)}
              disabled={zoom <= MIN_ZOOM}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              title="缩小"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => applyZoom(1)}
              className="w-12 text-center text-[11px] text-muted-foreground hover:text-foreground"
              title="点击复位到 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => applyZoom(zoom + STEP)}
              disabled={zoom >= MAX_ZOOM}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              title="放大"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
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

        {/* 图片区：深色底，overflow hidden（panning 用 transform，不靠滚动条） */}
        <div className="flex max-h-[78vh] min-h-[40vh] items-center justify-center overflow-hidden bg-neutral-900 dark:bg-neutral-950">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={name ?? ""}
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={cn(
                "max-h-[78vh] max-w-full select-none object-contain transition-transform",
                zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-default"
              )}
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                touchAction: "none",
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
