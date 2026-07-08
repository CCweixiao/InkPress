"use client";

import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TagInput } from "./TagInput";
import { useSnippetCreateForm } from "./use-snippet-create-form";
import type { SnippetItem } from "./types";

interface SnippetCreateBarProps {
  onCreated: (snippet: SnippetItem) => void;
  existingTags?: string[];
}

export function SnippetCreateBar({ onCreated, existingTags }: SnippetCreateBarProps) {
  const form = useSnippetCreateForm({ onCreated, existingTags });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void form.submit();
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          value={form.content}
          onChange={(e) => form.setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={form.handlePaste}
          placeholder={
            form.pasting ? "上传图片中…" : "记录一个灵感…（Ctrl+Enter 发送 · 可粘贴图片）"
          }
          aria-label="记录灵感"
          rows={2}
          className="w-full rounded-xl border border-border bg-muted/30 px-4 py-3 pr-12 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
        />
        <Button
          size="icon"
          variant="ghost"
          className="absolute right-2 bottom-2 h-8 w-8 text-muted-foreground hover:text-primary"
          onClick={() => void form.submit()}
          disabled={!form.canSubmit}
        >
          {form.pasting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      <TagInput
        value={form.tags}
        onChange={form.setTags}
        suggestions={form.existingTags ?? []}
        placeholder="标签…（回车或逗号添加）"
      />
    </div>
  );
}
