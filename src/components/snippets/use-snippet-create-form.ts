"use client";

import { useCallback, useState, type ClipboardEvent } from "react";
import type { SnippetItem } from "./types";

interface UseSnippetCreateFormOptions {
  onCreated: (snippet: SnippetItem) => void;
  existingTags?: string[];
}

/**
 * 素材块「创建」表单逻辑（content + tags + 粘贴图片 + 提交）。
 * 抽自 SnippetCreateBar，与全局快捷弹窗 SnippetQuickDialog 共用（DRY）。
 * - submit(): POST 文本素材，成功清空 + onCreated，返回是否成功
 * - handlePaste(): 粘贴图片 → /api/upload → kind=image 素材（逐个 onCreated）；非图 return
 * 客户端安全：仅 fetch + useState，无 prisma。
 */
export function useSnippetCreateForm({
  onCreated,
  existingTags,
}: UseSnippetCreateFormOptions) {
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pasting, setPasting] = useState(false);

  const submit = async (): Promise<boolean> => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting || pasting) return false;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, tags }),
      });
      if (!res.ok) return false;
      const { snippet } = (await res.json()) as { snippet: SnippetItem };
      onCreated(snippet);
      setContent("");
      setTags([]);
      return true;
    } catch {
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length === 0) return;
    e.preventDefault();
    setPasting(true);
    try {
      const caption = content.trim();
      for (const file of files) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          const upRes = await fetch("/api/upload", { method: "POST", body: fd });
          if (!upRes.ok) continue;
          const { asset } = await upRes.json();
          const snipRes = await fetch("/api/snippets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "image",
              imageUrl: asset.url,
              imageAssetId: asset.id,
              content: caption || file.name,
            }),
          });
          if (snipRes.ok) {
            const { snippet } = await snipRes.json();
            onCreated(snippet);
          }
        } catch {
          /* 单个文件失败静默，继续下一个 */
        }
      }
      setContent("");
    } finally {
      setPasting(false);
    }
  };

  const reset = useCallback(() => {
    setContent("");
    setTags([]);
  }, []);

  const canSubmit = content.trim().length > 0 && !isSubmitting && !pasting;

  return {
    content,
    setContent,
    tags,
    setTags,
    isSubmitting,
    pasting,
    canSubmit,
    submit,
    handlePaste,
    reset,
    existingTags,
  };
}
