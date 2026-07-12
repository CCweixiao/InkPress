"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyError } from "@/lib/ai/error-classify";
import { cn } from "@/lib/utils";

/**
 * 回合级错误块（设计文档 §2.7）。
 * 把 useChat 的 error 归类为中文短句 + 修复建议，可展开原始错误，提供重试。
 * 工具级错误（output-error）仍由 ToolCallBlock 就地红框展示，不走这里。
 */
export function AgentErrorBlock({
  error,
  onRetry,
  retrying = false,
  canRetry = true,
}: {
  error: Error | { message?: string } | string;
  onRetry?: () => void;
  retrying?: boolean;
  canRetry?: boolean;
}) {
  const classified = useMemo(() => classifyError(error), [error]);
  const [expanded, setExpanded] = useState(false);
  const hasRaw = classified.raw && classified.raw !== classified.label;
  const showInlineRaw = classified.category === "unknown" && hasRaw;
  const inlineRaw =
    showInlineRaw && classified.raw.length > 160
      ? `${classified.raw.slice(0, 160)}…`
      : classified.raw;

  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{classified.label}</div>
        <div className="mt-0.5 text-red-600/90 dark:text-red-300/80">
          {classified.suggestion}
        </div>
        {showInlineRaw && (
          <div className="mt-1 rounded bg-red-100/60 px-2 py-1 font-mono text-[10px] leading-4 text-red-800 dark:bg-red-950 dark:text-red-200">
            原始错误：{inlineRaw}
          </div>
        )}
        {hasRaw && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-red-500 hover:underline"
            >
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "收起诊断信息" : "展开诊断信息"}
            </button>
            {expanded && (
              <div className="mt-1 space-y-1">
                <div className="text-[10px] font-medium text-red-500 dark:text-red-400">
                  {classified.statusCode ? `HTTP ${classified.statusCode} · ` : ""}
                  {classified.category}
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-100/70 p-2 text-[10px] leading-5 font-mono text-red-800 dark:bg-red-950 dark:text-red-200">
                  {classified.raw}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
      {canRetry && onRetry && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 text-xs"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          重试
        </Button>
      )}
    </div>
  );
}
