"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { TagInput } from "./TagInput";
import type { SnippetItem } from "./types";

interface SnippetEditInlineProps {
  snippet: SnippetItem;
  existingTags?: string[];
  onSave: (updated: SnippetItem) => void;
  onCancel: () => void;
}

/**
 * 卡片原地编辑态：content + kind 专属字段 + tags。
 * Ctrl+Enter 保存（PATCH /api/snippets/[id]），Esc 取消。
 * 不改 kind 本身；image 仅改 caption（不替换图）。
 */
export function SnippetEditInline({
  snippet,
  existingTags,
  onSave,
  onCancel,
}: SnippetEditInlineProps) {
  const [content, setContent] = useState(snippet.content);
  const [tags, setTags] = useState<string[]>(() => snippet.tags);
  const [quoteSource, setQuoteSource] = useState(snippet.quoteSource ?? "");
  const [linkUrl, setLinkUrl] = useState(snippet.linkUrl ?? "");
  const [linkTitle, setLinkTitle] = useState(snippet.linkTitle ?? "");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/snippets/${snippet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          tags,
          quoteSource: quoteSource || null,
          linkUrl: linkUrl || null,
          linkTitle: linkTitle || null,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const { snippet: updated } = (await res.json()) as { snippet: SnippetItem };
      onSave(updated);
    } catch {
      setErrorMsg("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="space-y-2" onKeyDown={handleKeyDown}>
      {snippet.kind === "quote" && (
        <input
          value={quoteSource}
          onChange={(e) => setQuoteSource(e.target.value)}
          placeholder="引用出处（可选）"
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      )}
      {snippet.kind === "link" && (
        <div className="space-y-1">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="链接 URL"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="链接标题（可选）"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={snippet.kind === "image" ? "图片配文…" : "内容…"}
        rows={snippet.kind === "image" ? 2 : 3}
        autoFocus
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <TagInput
        value={tags}
        onChange={setTags}
        suggestions={existingTags ?? []}
        placeholder="标签…（回车或逗号添加）"
      />
      {errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
        >
          取消（Esc）
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !content.trim()}
          className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          保存（Ctrl+Enter）
        </button>
      </div>
    </div>
  );
}
