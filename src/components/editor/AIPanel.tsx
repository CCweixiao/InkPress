"use client";

import { Bot, FolderOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArticleMaterialsPanel } from "./ArticleMaterialsPanel";
import { WritingAssistant } from "./WritingAssistant";

export type AIPanelMode = "chat" | "materials";

export function AIPanel({
  onApply,
  onApplyArticle,
  currentMarkdown,
  articleId,
  spaceId,
  onModeChange,
  onFlushArticle,
  onApplyDigest,
}: {
  onApply: (md: string) => void;
  onApplyArticle: (article: {
    title: string;
    contentMd: string;
    digest: string | null;
  }) => void;
  currentMarkdown: string;
  articleId: string;
  spaceId?: string | null;
  onModeChange?: (mode: AIPanelMode) => void;
  onFlushArticle: (patch?: {
    title?: string;
    contentMd?: string;
    digest?: string;
  }) => Promise<void>;
  /** Agent 摘要生成后镜像到编辑器 digest 字段。 */
  onApplyDigest?: (digest: string) => void;
}) {
  const [mode, setModeState] = useState<AIPanelMode>("chat");

  function setMode(next: AIPanelMode) {
    setModeState(next);
    onModeChange?.(next);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-3 pb-0">
        <div className="flex gap-1 rounded-md bg-muted p-1">
          <button
            onClick={() => setMode("chat")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors",
              mode === "chat" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            写作助手
          </button>
          <button
            onClick={() => setMode("materials")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors",
              mode === "materials" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            素材
          </button>
        </div>
      </div>

      {mode === "chat" && (
        <WritingAssistant
          articleId={articleId}
          currentMarkdown={currentMarkdown}
          onApplyArticle={onApplyArticle}
          onApplyDigest={onApplyDigest}
          onFlushArticle={onFlushArticle}
        />
      )}

      {mode === "materials" && (
        <div className="flex-1 overflow-y-auto p-3">
          <ArticleMaterialsPanel
            articleId={articleId}
            spaceId={spaceId}
            onInsert={(markdown) =>
              onApply((currentMarkdown ? `${currentMarkdown}\n` : "") + markdown)
            }
          />
        </div>
      )}
    </div>
  );
}
