"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ComposerDocument,
  SnippetReviewProgressStep,
} from "@/lib/snippets/injection-review";

export type SnippetReviewAssessment = {
  id: string;
  title: string;
  verdict: "matched" | "insufficient" | "redundant";
  score: number;
  reason: string;
  suggestion: string;
};

export type SnippetReviewRecord = {
  id: string;
  status: "running" | "pending" | "applied" | "rejected" | "error";
  composer: ComposerDocument;
  visibleText: string;
  runtimeText: string;
  analysis: {
    summary?: string;
    assessments?: SnippetReviewAssessment[];
    progress?: SnippetReviewProgressStep[];
  };
  error?: string | null;
  createdAt: string;
};

const VERDICT_LABEL = {
  matched: "相关性契合",
  insufficient: "相关性不足",
  redundant: "素材冗余",
} as const;

export function SnippetReviewCard({
  review,
  onApply,
  onReject,
}: {
  review: SnippetReviewRecord;
  onApply: (review: SnippetReviewRecord) => Promise<void>;
  onReject: (review: SnippetReviewRecord) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"apply" | "reject" | null>(null);
  const [error, setError] = useState("");
  const assessments = review.analysis.assessments ?? [];
  const matched = assessments.filter((item) => item.verdict === "matched").length;
  const insufficient = assessments.filter(
    (item) => item.verdict === "insufficient"
  ).length;
  const redundant = assessments.filter(
    (item) => item.verdict === "redundant"
  ).length;

  async function decide(action: "apply" | "reject") {
    setBusy(action);
    setError("");
    try {
      if (action === "apply") await onApply(review);
      else await onReject(review);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
    } finally {
      setBusy(null);
    }
  }

  const statusLabel =
    review.status === "running"
      ? "分析中"
      : review.status === "applied"
      ? "已应用"
      : review.status === "rejected"
        ? "已放弃"
        : review.status === "error"
          ? "审核失败"
          : "待确认";

  return (
    <div className="overflow-hidden rounded-lg border border-primary/15 bg-background">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 bg-primary/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.05]"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {review.status === "running" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-xs font-semibold">灵感注入审核</span>
              <span
                className={cn(
                  "text-[11px]",
                  review.status === "applied"
                    ? "text-emerald-600"
                    : "text-muted-foreground"
                )}
              >
                {statusLabel}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {matched > 0 && (
                  <span className="text-[10px] text-emerald-600">契合 {matched}</span>
                )}
                {insufficient > 0 && (
                  <span className="text-[10px] text-amber-600">不足 {insufficient}</span>
                )}
                {redundant > 0 && (
                  <span className="text-[10px] text-muted-foreground">冗余 {redundant}</span>
                )}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform",
                    open && "rotate-180"
                  )}
                />
              </div>
            </div>
            <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-muted-foreground">
              {review.analysis.summary || "审核 Agent 已完成本轮素材分析。"}
            </p>
          </div>
      </button>

      {open && (
        <div className="border-t border-border/60">
        {review.analysis.progress?.length ? (
          <div className="mt-3 grid gap-1 rounded-md border border-border/60 bg-background/70 p-2.5">
            {review.analysis.progress.map((step) => (
              <div
                key={step.id}
                className="grid min-w-0 grid-cols-[18px_1fr] items-start gap-2 py-1"
              >
                <div className="mt-0.5 flex h-[18px] items-center justify-center">
                  {step.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : step.status === "completed" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : step.status === "failed" ? (
                    <CircleAlert className="h-3.5 w-3.5 text-destructive" />
                  ) : (
                    <Circle className="h-2.5 w-2.5 text-muted-foreground/50" />
                  )}
                </div>
                <div className="min-w-0">
                  <div
                    className={cn(
                      "text-[11px] font-medium",
                      step.status === "pending"
                        ? "text-muted-foreground"
                        : "text-foreground"
                    )}
                  >
                    {step.label}
                  </div>
                  {(step.status === "running" || step.status === "failed") && (
                    <p className="mt-0.5 break-words text-[10px] leading-4 text-muted-foreground">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="max-h-72 space-y-2 overflow-y-auto p-3">
          {assessments.map((item) => (
            <div key={item.id} className="min-w-0 rounded-md border p-3">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1 break-words text-xs font-medium leading-5 [overflow-wrap:anywhere]">
                  {item.title}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                    item.verdict === "matched"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : item.verdict === "insufficient"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {VERDICT_LABEL[item.verdict]} · {item.score}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {item.reason}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-foreground/80">
                <span className="font-medium">建议：</span>
                {item.suggestion}
              </p>
            </div>
          ))}
        </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 px-3 pb-2 text-xs text-destructive">
          <CircleAlert className="h-3.5 w-3.5" />
          {error}
        </div>
      )}

      {review.status === "pending" && (
        <div className="flex flex-wrap gap-2 border-t border-border/60 p-3">
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy !== null}
            onClick={() => void decide("apply")}
          >
            {busy === "apply" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            应用本轮素材
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy !== null}
            onClick={() => void decide("reject")}
          >
            {busy === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            放弃并调整
          </Button>
        </div>
      )}
      {review.status === "rejected" && (
        <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <X className="h-3.5 w-3.5" />
          本轮输入未进入正式上下文
        </div>
      )}
      {review.status === "error" && (
        <div className="border-t border-border/60 p-3">
          <p className="mb-2 break-words text-xs leading-5 text-destructive">
            {review.error || "审核服务暂时不可用，本轮输入尚未进入正式上下文。"}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy !== null}
            onClick={() => void decide("reject")}
          >
            {busy === "reject" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            恢复输入并调整
          </Button>
        </div>
      )}
    </div>
  );
}
