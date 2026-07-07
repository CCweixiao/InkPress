"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  ALLOWED_IMAGE_TYPES,
} from "@/lib/tickets/constants";
import { ImagePreview } from "./image-preview";

export interface UploadedImage {
  key: string;
  name: string;
  size: number;
  contentType: string;
}

/** 带本地预览 URL 的上传项（内部状态） */
interface UploadItem extends UploadedImage {
  previewUrl?: string;
}

interface ImageUploaderProps {
  value: UploadedImage[];
  onChange: (imgs: UploadedImage[]) => void;
}

export function ImageUploader({ value, onChange }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 本地 File 对象引用，用于生成预览 */
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const [items, setItems] = useState<UploadItem[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewAlt, setPreviewAlt] = useState("");

  // 同步外部 value → 内部 items（附加本地预览）
  useEffect(() => {
    const next: UploadItem[] = value.map((v) => {
      const file = fileMapRef.current.get(v.key);
      return file ? { ...v, previewUrl: URL.createObjectURL(file) } : v;
    });
    setItems(next);
    return () => {
      next.forEach((it) => {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      });
    };
  }, [value]);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return `${file.name}：仅支持 JPEG/PNG/WebP/GIF`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `${file.name}：超过 2MB`;
    }
    return null;
  };

  const uploadOne = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      const verr = validateFile(file);
      if (verr) {
        setError(verr);
        return null;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("count", String(value.length));
      const res = await fetch("/api/uploads/ticket-image", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "上传失败");
        return null;
      }
      const uploaded = json.data as UploadedImage;
      fileMapRef.current.set(uploaded.key, file);
      return uploaded;
    },
    [value.length]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (value.length + arr.length > MAX_IMAGES) {
        setError(`最多上传 ${MAX_IMAGES} 张图片`);
        return;
      }
      setError(null);
      setUploading(true);
      // 并发上限 3
      const results: UploadedImage[] = [];
      const queue = [...arr];
      const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length > 0) {
          const file = queue.shift();
          if (!file) break;
          const uploaded = await uploadOne(file);
          if (uploaded) results.push(uploaded);
        }
      });
      await Promise.all(workers);
      if (results.length > 0) {
        onChange([...value, ...results]);
      }
      setUploading(false);
    },
    [value, onChange, uploadOne]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (files.length > 0) {
        void handleFiles(files);
      }
    },
    [handleFiles]
  );

  const removeImage = useCallback(
    async (idx: number) => {
      const target = value[idx];
      // 尝试删除 OSS 对象（避免孤儿）
      if (target?.key) {
        fetch("/api/uploads/ticket-image/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: target.key }),
        }).catch(() => {});
        fileMapRef.current.delete(target.key);
      }
      onChange(value.filter((_, i) => i !== idx));
    },
    [value, onChange]
  );

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onDoubleClick={() => inputRef.current?.click()}
        tabIndex={0}
        className="rounded-lg border-2 border-dashed p-4 text-center text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/50 focus:bg-primary/5 cursor-pointer select-none transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <span>上传中…</span>
        ) : (
          <div className="space-y-1">
            <p>
              单击聚焦后 <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">Ctrl</kbd>
              +<kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">V</kbd> 粘贴截图
            </p>
            <p className="text-xs">
              双击选择图片文件 · 或拖拽到此处（≤{MAX_IMAGES} 张，每张 ≤2MB）
            </p>
          </div>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}

      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((img, i) => (
            <div
              key={img.key}
              className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted"
            >
              {img.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img.previewUrl}
                  alt={img.name}
                  className="h-full w-full cursor-zoom-in object-cover transition-opacity group-hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (img.previewUrl) {
                      setPreviewSrc(img.previewUrl);
                      setPreviewAlt(img.name);
                    }
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center px-1 text-center">
                  <span className="text-[10px] leading-tight text-muted-foreground line-clamp-2 break-all">
                    {img.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeImage(i);
                }}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {previewSrc && (
        <ImagePreview
          src={previewSrc}
          alt={previewAlt}
          onClose={() => setPreviewSrc(null)}
        />
      )}
    </div>
  );
}
