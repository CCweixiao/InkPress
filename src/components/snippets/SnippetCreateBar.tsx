"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SnippetItem } from "./types";

interface SnippetCreateBarProps {
  onCreated: (snippet: SnippetItem) => void;
}

export function SnippetCreateBar({ onCreated }: SnippetCreateBarProps) {
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        placeholder="记录一个灵感…（Ctrl+Enter 发送）"
        rows={2}
        className="w-full rounded-xl border border-border bg-muted/30 px-4 py-3 pr-12 text-sm resize-none placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
      />
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-2 bottom-2 h-8 w-8 text-muted-foreground hover:text-primary"
        onClick={handleSubmit}
        disabled={!content.trim() || isSubmitting}
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
