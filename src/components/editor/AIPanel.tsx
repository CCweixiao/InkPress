"use client";

import { Bot, FolderOpen, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArticleMaterialsPanel } from "./ArticleMaterialsPanel";
import { SnippetInsertPanel } from "./SnippetInsertPanel";
import { WritingAssistant } from "./WritingAssistant";

export type AIPanelMode = "chat" | "materials" | "snippets";

export function AIPanel({
  onApply,
  onApplyArticle,
  currentMarkdown,
  articleId,
  spaceId,
  profileId,
  onProfileChange,
  onModeChange,
  onFlushArticle,
  onApplyDigest,
  onInsertMarkdown,
}: {
  onApply: (md: string) => void;
  onApplyArticle: (article: {
    title: string;
    contentMd: string;
    digest: string | null;
    contentRevision: number;
  }) => void;
  currentMarkdown: string;
  articleId: string;
  spaceId?: string | null;
  /** P3 文章类型 profile id，下传给 WritingAssistant 显示 badge。 */
  profileId?: string | null;
  onProfileChange?: (profileId: string) => void;
  onModeChange?: (mode: AIPanelMode) => void;
  onFlushArticle: (patch?: {
    title?: string;
    contentMd?: string;
    digest?: string;
  }) => Promise<void>;
  /** Agent 摘要生成后镜像到编辑器 digest 字段。 */
  onApplyDigest?: (digest: string) => void;
  /** 灵感 tab snippet 插入回调，下传给 SnippetInsertPanel。Task 6 由 EditorWorkspace 注入。 */
  onInsertMarkdown?: (md: string) => void;
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
          <button
            onClick={() => setMode("snippets")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded py-1.5 text-xs font-medium transition-colors",
              mode === "snippets" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            灵感
          </button>
        </div>
      </div>

      {/* 切 tab 不卸载 WritingAssistant：条件渲染会导致 useChat 的 Chat 实例被 GC，
          流式状态全丢。改用 CSS hidden 让组件常驻，切回来立刻恢复。 */}
      <div className={mode === "chat" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <WritingAssistant
          articleId={articleId}
          profileId={profileId}
          onProfileChange={onProfileChange}
          currentMarkdown={currentMarkdown}
          onApplyArticle={onApplyArticle}
          onApplyDigest={onApplyDigest}
          onFlushArticle={onFlushArticle}
        />
      </div>

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

      {mode === "snippets" && (
        <div className="flex-1 overflow-y-auto p-3">
          <SnippetInsertPanel onInsertMarkdown={onInsertMarkdown ?? (() => {})} />
        </div>
      )}
    </div>
  );
}
