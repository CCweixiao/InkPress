"use client";

import { useState } from "react";
import { parseAttachments, type SignedAttachment } from "@/lib/tickets/attach";
import { ImagePreview } from "./image-preview";

interface AttachmentGridProps {
  /** DB 原始字段值（JSON string 或已解析数组） */
  raw: string | SignedAttachment[] | null | undefined;
  /** 已签名附件数组（server 端签发 URL 后传入，优先使用） */
  signed?: SignedAttachment[];
}

/**
 * 渲染附件图片网格。点击缩略图全屏预览。
 */
export function AttachmentGrid({ raw, signed }: AttachmentGridProps) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewAlt, setPreviewAlt] = useState("");

  const list: SignedAttachment[] =
    signed ?? (Array.isArray(raw) ? (raw as SignedAttachment[]) : parseAttachments(raw as string));

  if (list.length === 0) return null;

  const openPreview = (att: SignedAttachment) => {
    if (!att.url) return;
    setPreviewSrc(att.url);
    setPreviewAlt(att.name);
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((att) =>
          att.url ? (
            <button
              key={att.key}
              type="button"
              onClick={() => openPreview(att)}
              className="block overflow-hidden rounded-md border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.url}
                alt={att.name}
                className="h-20 w-20 cursor-zoom-in object-cover transition-opacity hover:opacity-80"
              />
            </button>
          ) : (
            <span
              key={att.key}
              className="inline-flex h-8 items-center rounded-md border bg-muted px-2 text-xs text-muted-foreground"
            >
              {att.name}
            </span>
          )
        )}
      </div>
      {previewSrc && (
        <ImagePreview
          src={previewSrc}
          alt={previewAlt}
          onClose={() => setPreviewSrc(null)}
        />
      )}
    </>
  );
}
