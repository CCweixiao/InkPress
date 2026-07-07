"use client";

import { SnippetCard } from "./SnippetCard";
import type { SnippetItem } from "./types";

interface SnippetListProps {
  snippets: SnippetItem[];
  onDeleted: (id: string) => void;
  onUpdated: (snippet: SnippetItem) => void;
}

export function SnippetList({ snippets, onDeleted, onUpdated }: SnippetListProps) {
  if (snippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg text-muted-foreground">
          记录你的第一个灵感片段 ✨
        </p>
        <p className="text-sm text-muted-foreground/60 mt-2">
          在上方输入框中写下你的想法，按 Ctrl+Enter 保存
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {snippets.map((snippet) => (
        <SnippetCard
          key={snippet.id}
          snippet={snippet}
          onDeleted={onDeleted}
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}
