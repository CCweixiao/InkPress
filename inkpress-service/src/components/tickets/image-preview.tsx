"use client";

import { useCallback, useEffect, useState } from "react";

interface ImagePreviewProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/** 全屏图片预览（lightbox），点击背景或按 Esc 关闭 */
export function ImagePreview({ src, alt, onClose }: ImagePreviewProps) {
  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [handleClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={handleClose}
    >
      <button
        type="button"
        onClick={handleClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-2xl text-white hover:bg-white/30"
        aria-label="关闭"
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}

/** Hook：管理预览状态 */
export function useImagePreview() {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const open = useCallback((src: string, alt: string) => setPreview({ src, alt }), []);
  const close = useCallback(() => setPreview(null), []);
  return { preview, open, close };
}
