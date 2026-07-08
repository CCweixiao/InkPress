"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SnippetItem } from "./types";

interface SnippetCreateBarProps {
  onCreated: (snippet: SnippetItem) => void;
}

export function SnippetCreateBar({ onCreated }: SnippetCreateBarProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pasting, setPasting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/snippets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (res.ok) {
        const { snippet } = await res.json();
        onCreated(snippet);
        setContent("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 粘贴图片：上传 /api/upload → 用返回 url+assetId 创建 kind=image 素材。
   * 当前输入框文字作配文（无则用文件名）。多个图片逐个上传。
   * 非图片粘贴（纯文字）走默认行为，不拦截。
   */
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={
          pasting ? "上传图片中…" : "记录一个灵感…（Ctrl+Enter 发送 · 可粘贴图片）"
        }
        aria-label="记录灵感"
        rows={2}
        className="w-full rounded-xl border border-border bg-muted/30 px-4 py-3 pr-12 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
      />
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 bottom-2 h-8 w-8 text-muted-foreground hover:text-primary"
        onClick={handleSubmit}
        disabled={!content.trim() || isSubmitting || pasting}
      >
        {pasting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
