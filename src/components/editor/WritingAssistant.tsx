"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Copy,
  Eye,
  FileSearch,
  Globe2,
  Loader2,
  Maximize2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArticleProfileBadge } from "@/components/ai/ArticleProfileBadge";
import { getArticleProfile } from "@/lib/ai/article-type-profile";
import { cn } from "@/lib/utils";
import {
  ArticleDiffDialog,
  type ProposalDetail,
} from "./ArticleDiffDialog";
import {
  InlineText,
  buildRows,
  foldRows,
  summarizeRows,
} from "./article-diff-utils";
import { ReasoningBlock } from "@/components/ai/ReasoningBlock";
import { ToolCallBlock } from "@/components/ai/ToolCallBlock";
import { ToolGroupBlock } from "@/components/ai/ToolGroupBlock";
import { AgentStepBlock } from "@/components/ai/AgentStepBlock";
import { SubAgentTaskBlock } from "@/components/ai/SubAgentTaskBlock";
import { AgentErrorBlock } from "@/components/ai/AgentErrorBlock";
import { ToolApprovalCard } from "@/components/ai/ToolApprovalCard";
import { RetryIndicator } from "@/components/ai/RetryIndicator";
import {
  getToolName,
  getPartGroupType,
} from "@/components/ai/tool-helpers";
import {
  ModelSelector,
  TokenMeter,
  useModelSelection,
  type ContextUsage,
  type LastTurnUsage,
} from "./agent-composer-parts";
import { ChatComposer } from "./ChatComposer";
import { Markdown } from "@/components/ai/Markdown";
import { MarkdownFullscreenDialog } from "@/components/ai/MarkdownFullscreenDialog";
import {
  getRecoveredTurnNotice,
  shouldPollRecoveringTurn,
} from "@/lib/ai/recovery-state";
import { mergeFinishedMessages } from "@/lib/ai/chat-message-merge";
import { dedupeAdjacentAssistantTextParts } from "@/lib/ai/chat-message-display";
import { findAssistantCheckpointBefore } from "@/lib/ai/agent-checkpoint";
import {
  isArticleProposalPart,
  moveProposalPartsToEnd,
} from "@/lib/ai/message-order";
import {
  composerDocumentToRuntimeText,
  buildSnippetReviewTimeline,
  hasAssistantTimelineContent,
  mergeComposerHistory,
  type ComposerDocument,
} from "@/lib/snippets/injection-review";
import {
  SnippetReviewCard,
  type SnippetReviewRecord,
} from "./SnippetReviewCard";

type ProposalSummary = {
  id: string;
  proposalKind?: "article";
  title?: string | null;
  summary: string;
  status: string;
  createdAt?: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待审查",
  applying: "应用中",
  applied: "已应用",
  rejected: "已放弃",
  superseded: "已失效",
};

function proposalIdFromOutput(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const id = (value as { proposalId?: unknown }).proposalId;
  return typeof id === "string" ? id : "";
}

function readLastTurnUsagePart(part: unknown): NonNullable<LastTurnUsage> | null {
  if (!part || typeof part !== "object") return null;
  const p = part as { type?: unknown; data?: unknown };
  if (p.type !== "data-turn-usage" || !p.data || typeof p.data !== "object") {
    return null;
  }
  const data = p.data as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    reasoningTokens?: unknown;
    totalTokens?: unknown;
  };
  const inputTokens = Number(data.inputTokens ?? 0);
  const outputTokens = Number(data.outputTokens ?? 0);
  const reasoningTokens = Number(data.reasoningTokens ?? 0);
  const totalTokens = Number(
    data.totalTokens ?? inputTokens + outputTokens + reasoningTokens
  );
  if (
    ![inputTokens, outputTokens, reasoningTokens, totalTokens].every(
      Number.isFinite
    )
  ) {
    return null;
  }
  if (inputTokens + outputTokens + reasoningTokens + totalTokens <= 0) {
    return null;
  }
  return { inputTokens, outputTokens, reasoningTokens, totalTokens };
}

/** 自闭合 mermaid SVG 中的 HTML void 元素（<br> 等），避免 XML 严格解析报错 */
function xmlSafeSvg(svg: string): string {
  return svg.replace(/<(br|hr|img|input|meta|link)([^>]*?)(?<!\/)>/gi, "<$1$2/>");
}

async function materializeMermaid(markdown: string, articleId: string) {
  const matches = [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
  if (!matches.length) return markdown;
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    flowchart: { htmlLabels: false },
  });
  let result = markdown;
  for (let index = 0; index < matches.length; index++) {
    const full = matches[index][0];
    const source = matches[index][1].trim();
    const rendered = await mermaid.render(`proposal-mermaid-${crypto.randomUUID()}`, source);
    const svg = xmlSafeSvg(rendered.svg);
    const form = new FormData();
    form.append("file", new File([svg], `mermaid-${index + 1}.svg`, { type: "image/svg+xml" }));
    form.append("articleId", articleId);
    form.append("description", `文章 Mermaid 图表 ${index + 1}`);
    form.append("tags", "mermaid,diagram");
    form.append("convertSvgToPng", "1"); // Mermaid 图表显式声明转 PNG（公众号不支持 SVG）
    const response = await fetch("/api/upload", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.asset?.url) {
      throw new Error(data.error || "Mermaid 图表上传失败。");
    }
    result = result.replace(full, `![Mermaid 图表 ${index + 1}](${data.asset.url})`);
  }
  return result;
}

function DiffPreview({
  detail,
  onOpenFull,
}: {
  detail: ProposalDetail;
  onOpenFull: () => void;
}) {
  const shown = useMemo(() => {
    const rows = foldRows(buildRows(detail.baseMarkdown, detail.markdown), true);
    return rows.filter((row) => row.kind !== "same");
  }, [detail]);
  const changeCount = shown.filter((row) => row.kind !== "fold").length;
  const capped = shown.slice(0, 30);
  return (
    <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950 font-mono text-[11px] leading-5 text-slate-100">
      <div className="max-h-64 overflow-y-auto">
        {capped.length === 0 ? (
          <div className="px-3 py-2 text-slate-500">无明显改动</div>
        ) : (
          capped.map((row, i) =>
            row.kind === "fold" ? (
              <div key={i} className="border-y border-slate-800 bg-slate-900/80 py-0.5 text-center text-slate-500">
                … 已折叠 {row.foldedCount} 行 …
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  "grid grid-cols-[16px_1fr] px-2",
                  row.kind === "added" && "border-l-2 border-l-emerald-500/60 bg-emerald-950/40",
                  row.kind === "removed" && "border-l-2 border-l-red-500/60 bg-red-950/40",
                  row.kind === "modified" && "border-l-2 border-l-amber-500/60 bg-amber-950/30"
                )}
              >
                <span className="select-none text-center text-slate-500">
                  {row.kind === "added" ? "+" : row.kind === "removed" ? "-" : "~"}
                </span>
                <pre className="whitespace-pre-wrap break-words pr-2">
                  {row.kind === "modified" ? (
                    <InlineText oldText={row.oldText ?? ""} newText={row.newText ?? ""} side="new" />
                  ) : (
                    row.newText ?? row.oldText ?? ""
                  )}
                </pre>
              </div>
            )
          )
        )}
      </div>
      <div className="border-t border-slate-800 px-3 py-1 text-center text-slate-500">
        {changeCount > 30 && `还有 ${changeCount - 30} 处改动 · `}
        <button type="button" onClick={onOpenFull} className="text-primary hover:underline">
          查看完整 diff
        </button>
      </div>
    </div>
  );
}

function ProposalCard({
  proposalId,
  fallback,
  profileId,
  onApplied,
  onBeforeApply,
}: {
  proposalId: string;
  fallback?: ProposalSummary;
  profileId?: string | null;
  onApplied: (result: Record<string, unknown>) => void;
  onBeforeApply?: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [status, setStatus] = useState(fallback?.status ?? "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const profile = getArticleProfile(profileId);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/ai/proposals/${proposalId}`);
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setDetail(data.proposal);
      setStatus(data.proposal.status);
    }
  }, [proposalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function apply() {
    setBusy(true);
    setError("");
    let markdown: string | undefined;
    try {
      // 先落盘本地编辑，令 apply 与 autosave 使用同一 revision 顺序。
      await onBeforeApply?.();
      if (
        detail?.proposalKind === "article" &&
        detail.targetId &&
        /```mermaid\s*\n/.test(detail.markdown)
      ) {
        markdown = await materializeMermaid(detail.markdown, detail.targetId);
      }
    } catch (renderError) {
      setBusy(false);
      setError(
        renderError instanceof Error
          ? renderError.message
          : "Mermaid 图表转换失败，提案未应用。"
      );
      return;
    }
    const response = await fetch(`/api/ai/proposals/${proposalId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(markdown ? { markdown } : {}),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setStatus(data.status ?? status);
      setError(data.error || "应用提案失败。");
      await refresh();
      return;
    }
    setStatus(data.status ?? "applied");
    setDetail((current) => (current ? { ...current, status: "applied" } : current));
    setDiffOpen(false);
    const applied = data.article;
    if (applied && typeof applied === "object") {
      onApplied(applied as Record<string, unknown>);
    }
  }

  async function reject() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/ai/proposals/${proposalId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setStatus(data.status ?? status);
      setError(data.error || "放弃提案失败。");
      await refresh();
      return;
    }
    setStatus("rejected");
    setDetail((current) => (current ? { ...current, status: "rejected" } : current));
    setDiffOpen(false);
  }

  const statusTone =
    status === "applied"
      ? "text-emerald-600"
      : status === "rejected" || status === "superseded"
        ? "text-muted-foreground"
        : "text-primary";

  return (
    <>
      <div className="rounded-lg border border-primary/25 bg-primary/[0.035] p-3 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="rounded-md bg-primary/10 p-1.5 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">文章修改提案</div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {detail?.summary ?? fallback?.summary ?? "正在加载提案详情…"}
            </p>
          </div>
          <span className={cn("shrink-0 text-[11px]", statusTone)}>
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>

        {detail && (
          <div className="space-y-2">
            {(() => {
              const { added, removed, modified } = summarizeRows(
                buildRows(detail.baseMarkdown, detail.markdown)
              );
              const additions = added + modified;
              const deletions = removed + modified;
              const total = additions + deletions || 1;
              return (
                <div className="rounded-md border bg-background px-2.5 py-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-emerald-600">+{additions} 新增</span>
                    <span className="font-medium text-red-600">-{deletions} 删除</span>
                    <span className="ml-auto text-muted-foreground">
                      {detail.stats.oldLines}→{detail.stats.newLines} 行
                    </span>
                  </div>
                  <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="bg-emerald-500"
                      style={{ width: `${(additions / total) * 100}%` }}
                    />
                    <div
                      className="bg-red-500"
                      style={{ width: `${(deletions / total) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })()}
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex w-full items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", previewOpen && "rotate-180")}
              />
              {previewOpen ? "收起改动预览" : "展开改动预览"}
            </button>
            {previewOpen && (
              <DiffPreview detail={detail} onOpenFull={() => setDiffOpen(true)} />
            )}
            <div className="rounded-md border bg-background px-2.5 py-2 text-[11px]">
              <div className="font-medium">审稿清单 · {profile.name}</div>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {profile.checklist.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!detail}
            onClick={() => setDiffOpen(true)}
          >
            <Eye className="h-3.5 w-3.5" />
            全屏审查
          </Button>
          {(status === "pending" || status === "error" || status === "applying") && (
            <>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={apply}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {status === "pending" ? "应用修改" : "重试同步"}
              </Button>
              {status === "pending" && <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={reject}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
                放弃
              </Button>}
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={!detail}
            onClick={() => {
              if (!detail) return;
              navigator.clipboard.writeText(detail.markdown);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Clipboard className="h-3.5 w-3.5" />
            )}
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
      </div>
      <ArticleDiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        proposal={detail}
        onApply={apply}
        onReject={reject}
        applying={busy}
      />
    </>
  );
}

function CodeSourceApprovalCard({
  data,
  onApproved,
  onStatusChange,
  onApprovalFailed,
}: {
  data: {
    id: string;
    displayName: string;
    locator: string;
    approvalToken: string;
  };
  onApproved: () => Promise<void>;
  /** 授权状态变化时通知父级（用于锁定 composer 等）。 */
  onStatusChange?: (status: string) => void;
  /** 授权失败且无法恢复时解锁 composer。 */
  onApprovalFailed?: () => void;
}) {
  const [sourceStatus, setSourceStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activeToken, setActiveToken] = useState(data.approvalToken);

  useEffect(() => {
    setActiveToken(data.approvalToken);
  }, [data.approvalToken]);

  useEffect(() => {
    fetch(`/api/ai/code-sources/${data.id}/status`)
      .then((response) => response.json())
      .then((result) => {
        if (result.source?.status) {
          setSourceStatus(result.source.status);
          onStatusChange?.(result.source.status);
        }
      })
      .catch(() => undefined);
  }, [data.id, onStatusChange]);

  async function refreshApprovalToken(): Promise<string | null> {
    const response = await fetch(
      `/api/ai/code-sources/${data.id}/refresh-token`,
      { method: "POST" }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.approvalToken !== "string") {
      return null;
    }
    setActiveToken(result.approvalToken);
    return result.approvalToken;
  }

  async function decide(
    action: "approve" | "reject",
    scope: "session" | "trusted" = "session",
    tokenOverride?: string,
    allowTokenRefresh = true
  ) {
    const token = tokenOverride ?? activeToken;
    setBusy(true);
    setError("");
    const response = await fetch(
      `/api/ai/code-sources/${data.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvalToken: token,
          action,
          scope,
        }),
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        typeof result.error === "string" ? result.error : "代码源授权失败。";
      if (
        allowTokenRefresh &&
        response.status === 409 &&
        message.includes("令牌无效")
      ) {
        const refreshed = await refreshApprovalToken();
        if (refreshed) {
          await decide(action, scope, refreshed, false);
          return;
        }
      }
      setBusy(false);
      setError(message);
      onApprovalFailed?.();
      return;
    }
    setBusy(false);
    setSourceStatus(action === "approve" ? "approved" : "rejected");
    onStatusChange?.(action === "approve" ? "approved" : "rejected");
    if (action === "approve") await onApproved();
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-amber-950 dark:text-amber-100">授权只读代码探索</div>
          <div className="mt-1 text-amber-900 dark:text-amber-200">{data.displayName}</div>
          <div className="mt-1 break-all font-mono text-[10px] text-amber-700 dark:text-amber-400">
            {data.locator}
          </div>
          <p className="mt-2 leading-5 text-amber-800 dark:text-amber-200">
            仅允许读取源码、符号与 Git 历史；不会修改、构建或执行项目。
          </p>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-red-600 dark:text-red-400">
          {error}
          {error.includes("令牌无效") && (
            <span className="block mt-1 text-amber-800 dark:text-amber-200">
              已尝试刷新令牌；若仍失败，请重新发送探索请求或点击「拒绝」解除锁定。
            </span>
          )}
        </p>
      )}
      {sourceStatus === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void decide("approve", "session")}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            仅本会话允许
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void decide("approve", "trusted")}
          >
            允许并长期信任
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void decide("reject")}
          >
            拒绝
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {sourceStatus === "approved" ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              已授权
            </>
          ) : (
            <>
              <X className="h-3.5 w-3.5" />
              已拒绝或撤销
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Agent part 渲染注册表（声明式：每条 part → { match, render }）
// 替换原 message.parts.map 内的 if/else 链；新增 part 类型只需加一条规则，
// matcher 顺序即优先级（特化 matcher 必须在通用 tool matcher 之前）。
// ────────────────────────────────────────────────────────────────────────────

type AgentPart = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";

function codeSourceApprovalKey(part: AgentPart): string | null {
  if (part.type !== "data-code-source-approval" || !isObj(part.data)) return null;
  const data = part.data as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id.trim() : "";
  if (id) return `id:${id}`;
  const locator = typeof data.locator === "string" ? data.locator.trim() : "";
  if (locator) return `locator:${locator}`;
  return null;
}

function codeSourceApprovalOccurrenceKey(input: {
  messageId: string;
  partIndex: number;
  approvalKey: string;
}) {
  return `${input.messageId}:${input.partIndex}:${input.approvalKey}`;
}

export type RenderCtx = {
  role: "user" | "assistant" | "system";
  targetKind: "article";
  setFullscreenText: (text: string | null) => void;
  onApplyArticle?: (article: {
    title: string;
    contentMd: string;
    digest: string | null;
    contentRevision: number;
  }) => void;
  onFlushArticle?: () => Promise<void>;
  resumeAfterApproval: () => Promise<void>;
  /** 代码源授权状态变化（pending 时父级锁定 composer）。 */
  onApprovalStatusChange?: (status: string) => void;
  /** 授权失败且无法恢复时解锁 composer。 */
  onApprovalFailed?: () => void;
  /** 工具审批（P3 canUseTool 闸门）状态变化（pending 时锁定 composer）。 */
  onToolApprovalStatusChange?: (status: string) => void;
  /** 当前文章类型 profile，用于提案卡审稿 checklist。 */
  profileId?: string | null;
  /** 当前消息在 messages 中的下标（用户消息重新执行需据此截断）。 */
  messageIndex: number;
  /** 重新执行用户消息：编辑后丢弃其后消息并重跑（codex edit & retry）。 */
  rerun?: (index: number, editedText: string) => void;
  /** Agent 是否忙碌（忙碌时禁用重新执行）。 */
  busy: boolean;
  /**
   * 本条消息是否已「定格」（不再随活动流变化）。
   * 仅「正在流式的最新助手消息」为非 settled；其余（历史消息、用户取消/出错/完成后）均为 settled。
   * settled 时，仍停留在 running/streaming 视觉态的步骤/工具/思考应渲染为「已中断」而非持续旋转。
   */
  settled: boolean;
};

export type PartRenderer = {
  match: (part: AgentPart) => boolean;
  render: (part: AgentPart, ctx: RenderCtx) => ReactNode;
};

/** 代码源就绪提示（② 就绪阶段）。 */
function CodeSourceReadyNotice({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-[11px] text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
      <div className="flex items-center gap-1.5 font-medium">
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        代码源已就绪：{String(data.displayName ?? "")}
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
        {String(data.locator ?? "")}
        {data.ref ? ` · ${String(data.ref)}` : ""}
      </div>
    </div>
  );
}

/** 上下文用量提示（meta 阶段）。 */
function ContextUsageLine({ data }: { data: Record<string, unknown> }) {
  if (!data.compressed) return null;
  const pre = Number(data.compactPreTokens ?? 0);
  const post = Number(data.compactPostTokens ?? data.estimatedTokens ?? 0);
  return (
    <div className="text-[10px] text-sky-700 dark:text-sky-300">
      Claude Agent 已自动压缩上下文
      {pre > 0 && post > 0
        ? `：${pre.toLocaleString()} → ${post.toLocaleString()} tokens`
        : ""}
    </div>
  );
}

/**
 * 用户消息气泡 + 右下角操作（codex 式）：复制 / 重新执行（编辑后重发）。
 * 重新执行进入内联编辑态，提交时由 ctx.rerun 截断其后消息并重跑。
 */
function UserMessageBubble({
  text,
  messageIndex,
  onRerun,
  busy,
}: {
  text: string;
  messageIndex: number;
  onRerun?: (index: number, editedText: string) => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  useEffect(() => {
    setDraft(text);
  }, [text]);
  const displayParts = text.split(/(\[灵感：[^\]]+\])/g).filter(Boolean);

  if (editing) {
    return (
      <div className="flex w-full max-w-[88%] flex-col items-end">
        <textarea
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!busy && draft.trim()) {
                setEditing(false);
                onRerun?.(messageIndex, draft.trim());
              }
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setDraft(text);
            }
          }}
          className="min-h-16 w-full resize-none rounded-xl rounded-br-sm border bg-background px-3 py-2 text-xs leading-5 outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-1 flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => {
              setEditing(false);
              setDraft(text);
            }}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="h-6 text-[11px]"
            disabled={busy || !draft.trim()}
            onClick={() => {
              setEditing(false);
              onRerun?.(messageIndex, draft.trim());
            }}
          >
            <RotateCcw className="h-3 w-3" />
            重新发送
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end">
      <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm border border-transparent bg-primary px-3 py-2 text-xs leading-5 text-primary-foreground dark:border-blue-300/10 dark:bg-[#20354d] dark:text-slate-100">
        {displayParts.map((part, index) =>
          /^\[灵感：[^\]]+\]$/.test(part) ? (
            <span
              key={`${part}-${index}`}
              className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-white/25 bg-white/15 px-2 py-0.5 align-middle text-[11px] font-medium dark:border-blue-200/15 dark:bg-black/15 dark:text-blue-100"
            >
              <Sparkles className="h-3 w-3 shrink-0" />
              <span className="truncate">{part.slice(4, -1)}</span>
            </span>
          ) : (
            <Fragment key={`${index}-${part}`}>{part}</Fragment>
          )
        )}
      </div>
      {onRerun && (
        <div className="mt-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            title="复制"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              } catch {
                /* 剪贴板不可用时静默 */
              }
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            title="重新执行（编辑后重发）"
            disabled={busy}
            onClick={() => setEditing(true)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

type EvidenceKind =
  | "git-range"
  | "commit"
  | "change-summary"
  | "explore"
  | "snapshot"
  | "source"
  | "web-source";

/** 证据 chip（⑥ 证据阶段）：6 类证据 part 合并为一个组件，按 kind 切换样式。 */
function EvidenceChip({
  kind,
  data,
}: {
  kind: EvidenceKind;
  data: Record<string, unknown>;
}) {
  switch (kind) {
    case "git-range":
      return (
        <div className="rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-2 text-[11px] dark:border-violet-900 dark:bg-violet-950/40">
          <div className="font-medium text-violet-950 dark:text-violet-100">
            Git 范围：{String(data.requestedRange ?? "")}
          </div>
          <div className="mt-1 font-mono text-[10px] text-violet-700 dark:text-violet-300">
            {String(data.baseCommit ?? "").slice(0, 10)} →{" "}
            {String(data.headCommit ?? "").slice(0, 10)}
          </div>
        </div>
      );
    case "commit":
      return (
        <div className="rounded-md border px-2.5 py-2 text-[11px]">
          <span className="mr-2 font-mono text-primary">
            {String(data.shortSha ?? data.sha ?? "").slice(0, 10)}
          </span>
          {String(data.subject ?? "")}
          <div className="mt-1 text-[10px] text-muted-foreground">
            {String(data.author ?? "")} · {String(data.authoredAt ?? "")}
          </div>
        </div>
      );
    case "change-summary":
      return (
        <div className="rounded-md border px-2.5 py-2 text-[11px]">
          已分析 {Number(data.commits ?? 0)} 个提交、{" "}
          {Number(data.changedFiles ?? 0)} 个文件，整理为{" "}
          {Number(data.featureGroups ?? 0)} 组功能变化
          {data.truncated ? " · 部分结果已截断" : ""}
        </div>
      );
    case "explore":
      return (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-2.5 py-2 text-[11px] dark:border-blue-900 dark:bg-blue-950/40">
          <FileSearch className="mt-0.5 h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
          <div>
            <div className="font-medium text-blue-950 dark:text-blue-100">
              {String(data.title ?? "代码探索")}
            </div>
            <div className="mt-0.5 text-blue-700 dark:text-blue-300">
              {String(data.detail ?? "")}
            </div>
          </div>
        </div>
      );
    case "snapshot":
      return (
        <div className="rounded-md border px-2.5 py-2 text-[11px]">
          代码快照 {String(data.snapshotHash ?? "").slice(0, 10)} ·{" "}
          {data.files != null ? `${Number(data.files)} 个文件 · ` : ""}
          {Number(data.symbols ?? 0)} 个符号 · {Number(data.edges ?? 0)} 条关系
          {data.mode === "fallback-index" ? " · 静态索引模式" : ""}
          {data.evidenceTruncated
            ? ` · 证据包 ${Number(data.evidenceSymbols ?? 0)}/${Number(data.evidenceEdges ?? 0)}`
            : ""}
          {data.truncated ? " · 索引已触顶" : ""}
        </div>
      );
    case "source":
      return (
        <div className="truncate text-[10px] text-muted-foreground">
          {String(data.path ?? "")}#L{String(data.startLine ?? "")}
          {data.endLine !== data.startLine
            ? `-L${String(data.endLine ?? "")}`
            : ""}
        </div>
      );
    case "web-source":
      return (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-2.5 py-2 text-[11px] dark:border-blue-900 dark:bg-blue-950/40">
          <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-700 dark:text-blue-400" />
          <div className="min-w-0 flex-1">
            <a
              href={String(data.url ?? "#")}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-medium text-blue-950 hover:underline dark:text-blue-100"
            >
              {String(data.title ?? data.url ?? "网络来源")}
            </a>
            {data.snippet ? (
              <div className="mt-0.5 line-clamp-2 text-blue-700 dark:text-blue-300">
                {String(data.snippet)}
              </div>
            ) : null}
          </div>
        </div>
      );
  }
}

/** 工具类 part 渲染：提案卡片 / 通用工具块。 */
function renderToolPart(part: AgentPart, ctx: RenderCtx): ReactNode {
  const toolName = getToolName(part);
  const proposalId =
    toolName === "propose_article_revision"
      ? proposalIdFromOutput(part.output)
      : "";
  if (proposalId) {
    return (
      <ProposalCard
        proposalId={proposalId}
        profileId={ctx.profileId}
        onBeforeApply={ctx.onFlushArticle}
        onApplied={(result) => {
          ctx.onApplyArticle?.(
            result as {
              title: string;
              contentMd: string;
              digest: string | null;
              contentRevision: number;
            }
          );
        }}
      />
    );
  }
  return <ToolCallBlock part={part} settled={ctx.settled} />;
}

/** AI 输出文本的操作按钮：复制原文 + 全屏放大（hover 显露，与用户消息操作行风格一致）。 */
function AiOutputActions({
  text,
  onFullscreen,
}: {
  text: string;
  onFullscreen: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="absolute -right-1 -top-1 flex items-center gap-0.5 rounded-md border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
      <button
        type="button"
        title="复制原文"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* 剪贴板不可用时静默 */
          }
        }}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </button>
      <button
        type="button"
        title="全屏查看"
        onClick={() => onFullscreen(text)}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Maximize2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// 顺序即优先级：特化 matcher（text/reasoning/data-*）必须在通用 tool matcher 之前。
export const PART_RENDERERS: PartRenderer[] = [
  {
    match: (p) => p.type === "text" && typeof p.text === "string",
    render: (p, ctx) => {
      const text = p.text as string;
      if (ctx.role === "user") {
        return (
          <UserMessageBubble
            text={text}
            messageIndex={ctx.messageIndex}
            onRerun={ctx.rerun}
            busy={ctx.busy}
          />
        );
      }
      return (
        <div className="group relative rounded-md text-foreground">
          <Markdown className="text-xs leading-5">{text}</Markdown>
          <AiOutputActions text={text} onFullscreen={ctx.setFullscreenText} />
        </div>
      );
    },
  },
  {
    match: (p) => p.type === "reasoning" && typeof p.text === "string",
    render: (p, ctx) => (
      <ReasoningBlock
        text={p.text as string}
        state={typeof p.state === "string" ? p.state : undefined}
        settled={ctx.settled}
      />
    ),
  },
  {
    match: (p) => p.type === "data-code-source-approval" && isObj(p.data),
    render: (p, ctx) => (
      <CodeSourceApprovalCard
        data={
          p.data as {
            id: string;
            displayName: string;
            locator: string;
            approvalToken: string;
          }
        }
        onApproved={ctx.resumeAfterApproval}
        onStatusChange={ctx.onApprovalStatusChange}
        onApprovalFailed={ctx.onApprovalFailed}
      />
    ),
  },
  {
    match: (p) => p.type === "data-tool-approval" && isObj(p.data),
    render: (p, ctx) => (
      <ToolApprovalCard
        data={
          p.data as {
            grantId: string;
            toolName: string;
            displayName?: string;
            input: Record<string, unknown>;
            url?: string;
            domain?: string;
            riskAssessment?: {
              url: string;
              domain: string;
              isHttps: boolean;
              isKnownAuthority: boolean;
              isLikelyOfficial: boolean;
              isDeveloperSource: boolean;
              isRepositorySource: boolean;
              riskLevel: "low" | "medium" | "high";
              signals: string[];
              warnings: string[];
            } | null;
            batch?: {
              enabled?: boolean;
              pendingCount?: number;
              scope?: string;
            };
            approvalToken: string;
          }
        }
        onStatusChange={ctx.onToolApprovalStatusChange}
      />
    ),
  },
  {
    match: (p) => p.type === "data-agent-retry" && isObj(p.data),
    render: (p, ctx) => (
      <RetryIndicator data={p.data as Record<string, unknown>} settled={ctx.settled} />
    ),
  },
  {
    match: (p) => p.type === "data-code-source-ready" && isObj(p.data),
    render: (p) => (
      <CodeSourceReadyNotice data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "data-git-range" && isObj(p.data),
    render: (p) => (
      <EvidenceChip kind="git-range" data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "data-commit-evidence" && isObj(p.data),
    render: (p) => (
      <EvidenceChip kind="commit" data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "data-change-evidence-summary" && isObj(p.data),
    render: (p) => (
      <EvidenceChip
        kind="change-summary"
        data={p.data as Record<string, unknown>}
      />
    ),
  },
  {
    match: (p) => p.type === "data-code-explore-step" && isObj(p.data),
    render: (p) => (
      <EvidenceChip kind="explore" data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "data-project-snapshot" && isObj(p.data),
    render: (p) => (
      <EvidenceChip kind="snapshot" data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "data-source-evidence" && isObj(p.data),
    render: (p) => (
      <EvidenceChip kind="source" data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "data-web-source" && isObj(p.data),
    render: (p) => (
      <EvidenceChip kind="web-source" data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => p.type === "source-url" && typeof p.url === "string",
    render: (p) => (
      <a
        href={p.url as string}
        target="_blank"
        rel="noreferrer"
        className="block truncate rounded-md border px-2 py-1.5 text-[11px] text-primary hover:bg-accent"
      >
        {typeof p.title === "string" ? p.title : (p.url as string)}
      </a>
    ),
  },
  {
    match: (p) => p.type === "data-agent-step" && isObj(p.data),
    render: (p, ctx) => (
      <AgentStepBlock
        data={p.data as Record<string, unknown>}
        settled={ctx.settled}
      />
    ),
  },
  {
    match: (p) => p.type === "data-context-usage" && isObj(p.data),
    render: (p) => (
      <ContextUsageLine data={p.data as Record<string, unknown>} />
    ),
  },
  {
    match: (p) => getToolName(p) !== "",
    render: (p, ctx) => renderToolPart(p, ctx),
  },
];

/** 按 part 找到首个命中的 renderer 并渲染；未命中返回 null。 */
export function renderAgentPart(part: AgentPart, ctx: RenderCtx): ReactNode {
  for (const renderer of PART_RENDERERS) {
    if (renderer.match(part)) return renderer.render(part, ctx);
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// 工具调用分组聚合
// 将连续的只读探索 / 网络搜索工具合并为 ToolGroupBlock，其余按原序独立渲染。
// 阈值：同类连续 ≥2 才分组，单工具走 ToolCallBlock 避免过度包装。
// ────────────────────────────────────────────────────────────────────────────

export type RenderItem =
  | {
      kind: "tool-group";
      groupType: "explore" | "web";
      parts: AgentPart[];
      key: string;
    }
  | {
      kind: "sub-agent-task";
      parts: AgentPart[];
      key: string;
    }
  | { kind: "single"; part: AgentPart; key: string };

export function aggregateParts(parts: AgentPart[]): RenderItem[] {
  const items: RenderItem[] = [];
  const subTaskParts = new Map<string, AgentPart[]>();
  const emittedSubTasks = new Set<string>();
  const toolCallToSubTask = new Map<string, string>();
  let activeSubTaskId: string | null = null;
  let bucket: {
    groupType: "explore" | "web";
    parts: AgentPart[];
    start: number;
  } | null = null;

  const flush = () => {
    if (!bucket) return;
    // 阈值 <2 不分组，回退为独立 single 渲染。
    if (bucket.parts.length < 2) {
      for (let j = 0; j < bucket.parts.length; j++) {
        items.push({
          kind: "single",
          part: bucket.parts[j],
          key: `single-${bucket.start + j}`,
        });
      }
    } else {
      const end = bucket.start + bucket.parts.length - 1;
      items.push({
        kind: "tool-group",
        groupType: bucket.groupType,
        parts: bucket.parts,
        key: `group-${bucket.start}-${end}`,
      });
    }
    bucket = null;
  };

  const shouldFoldIntoActiveSubTask = (part: AgentPart, groupType: unknown) => {
    if (!activeSubTaskId) return false;
    const type = String(part.type ?? "");
    if (type === "data-tool-approval" || type === "data-code-source-approval") {
      return false;
    }
    if (type === "text" || type === "reasoning") return false;
    if (getToolName(part)) return true;
    if (groupType) return true;
    return type === "source-url";
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type === "data-agent-step" && isObj(part.data)) {
      const data = part.data as Record<string, unknown>;
      const subTaskId = data.subTaskId;
      if (typeof subTaskId === "string" && subTaskId) {
        flush();
        const taskParts = subTaskParts.get(subTaskId) ?? [];
        taskParts.push(part);
        subTaskParts.set(subTaskId, taskParts);
        if (!emittedSubTasks.has(subTaskId)) {
          emittedSubTasks.add(subTaskId);
          items.push({
            kind: "sub-agent-task",
            parts: taskParts,
            key: `sub-agent-task-${subTaskId}`,
          });
        }
        const status = String(data.status ?? "completed");
        activeSubTaskId = status === "running" ? subTaskId : null;
        continue;
      }
    }
    const toolCallId =
      typeof part.toolCallId === "string" ? part.toolCallId : "";
    const mappedSubTaskId = toolCallId
      ? toolCallToSubTask.get(toolCallId) ?? null
      : null;
    const groupType = getPartGroupType(part);
    const belongsToActiveSubTask =
      shouldFoldIntoActiveSubTask(part, groupType) ||
      Boolean(mappedSubTaskId);
    if (belongsToActiveSubTask) {
      flush();
      const subTaskId = mappedSubTaskId ?? activeSubTaskId;
      if (subTaskId) {
        const taskParts = subTaskParts.get(subTaskId) ?? [];
        taskParts.push(part);
        subTaskParts.set(subTaskId, taskParts);
        if (toolCallId) toolCallToSubTask.set(toolCallId, subTaskId);
      }
      continue;
    }
    if (!groupType) {
      flush();
      items.push({ kind: "single", part, key: `single-${i}` });
      continue;
    }
    if (!bucket || bucket.groupType !== groupType) {
      flush();
      bucket = { groupType, parts: [], start: i };
    }
    bucket.parts.push(part);
  }
  flush();
  return items;
}

/** 从消息 parts 收集 propose_article_revision 等工具产出的 proposalId。 */
function collectProposalIds(parts: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const part of parts) {
    const id = proposalIdFromOutput(
      (part as Record<string, unknown>).output
    );
    if (id) ids.add(id);
  }
  return ids;
}

type AgentMessageRowProps = {
  message: UIMessage;
  messageIndex: number;
  settled: boolean;
  isLastAssistant: boolean;
  showUserDivider: boolean;
  targetKind: "article";
  busy: boolean;
  setFullscreenText: (text: string | null) => void;
  onApplyArticle?: RenderCtx["onApplyArticle"];
  onFlushArticle?: RenderCtx["onFlushArticle"];
  onRerun: NonNullable<RenderCtx["rerun"]>;
  onResumeAfterApproval: RenderCtx["resumeAfterApproval"];
  onApprovalStatusChange?: RenderCtx["onApprovalStatusChange"];
  onApprovalFailed?: RenderCtx["onApprovalFailed"];
  onToolApprovalStatusChange?: RenderCtx["onToolApprovalStatusChange"];
  profileId?: string | null;
  visibleCodeSourceApprovalOccurrences: ReadonlySet<string>;
};

/**
 * 单条会话消息行（memo）。
 * 流式期间仅「活动助手消息」的 parts 引用会变；历史行 parts 不变则跳过重渲染，
 * 把每 chunk 的渲染成本从 O(全部消息×parts) 降到 O(1)。
 */
const AgentMessageRow = memo(function AgentMessageRow({
  message,
  messageIndex,
  settled,
  isLastAssistant,
  showUserDivider,
  targetKind,
  busy,
  setFullscreenText,
  onApplyArticle,
  onFlushArticle,
  onRerun,
  onResumeAfterApproval,
  onApprovalStatusChange,
  onApprovalFailed,
  onToolApprovalStatusChange,
  profileId,
  visibleCodeSourceApprovalOccurrences,
}: AgentMessageRowProps) {
  const allParts = message.parts as unknown as AgentPart[];
  const visibleParts = useMemo(
    () =>
      allParts.filter((part, partIndex) => {
        const approvalKey = codeSourceApprovalKey(part);
        if (!approvalKey) return true;
        return visibleCodeSourceApprovalOccurrences.has(
          codeSourceApprovalOccurrenceKey({
            messageId: message.id,
            partIndex,
            approvalKey,
          })
        );
      }),
    [allParts, message.id, visibleCodeSourceApprovalOccurrences]
  );
  // data-agent-retry（SDK 轮内重试会连发多条）只保留最后一条，避免堆积。
  let lastRetryIdx = -1;
  for (let i = visibleParts.length - 1; i >= 0; i -= 1) {
    if (visibleParts[i].type === "data-agent-retry") {
      lastRetryIdx = i;
      break;
    }
  }
  const filteredParts =
    lastRetryIdx >= 0
      ? visibleParts.filter(
          (p, i) => p.type !== "data-agent-retry" || i === lastRetryIdx
        )
      : visibleParts;
  const parts = useMemo(
    () =>
      moveProposalPartsToEnd(
        message.role === "assistant"
          ? dedupeAdjacentAssistantTextParts(filteredParts)
          : filteredParts
      ),
    [filteredParts, message.role]
  );
  const items = useMemo(() => aggregateParts(parts), [parts]);

  const ctx: RenderCtx = useMemo(
    () => ({
      role: message.role,
      targetKind,
      setFullscreenText,
      onApplyArticle,
      onFlushArticle,
      resumeAfterApproval: onResumeAfterApproval,
      onApprovalStatusChange,
      onApprovalFailed,
      onToolApprovalStatusChange,
      profileId,
      messageIndex,
      rerun: onRerun,
      busy,
      settled,
    }),
    [
      message.role,
      targetKind,
      setFullscreenText,
      onApplyArticle,
      onFlushArticle,
      onResumeAfterApproval,
      onApprovalStatusChange,
      onApprovalFailed,
      onToolApprovalStatusChange,
      profileId,
      messageIndex,
      onRerun,
      busy,
      settled,
    ]
  );

  return (
    <div
      className={cn(
        "space-y-2",
        message.role === "user" && "flex flex-col items-end",
        showUserDivider &&
          "mt-3 border-t border-dashed border-border/60 pt-3"
      )}
    >
      {items.map((item) => {
        if (item.kind === "tool-group") {
          return (
            <ToolGroupBlock
              key={item.key}
              parts={item.parts}
              groupType={item.groupType}
              settled={settled}
            />
          );
        }
        if (item.kind === "sub-agent-task") {
          if (!isLastAssistant) return null;
          return (
            <SubAgentTaskBlock
              key={item.key}
              parts={item.parts}
              settled={settled}
            />
          );
        }
        const part = item.part;
        if (!settled && isArticleProposalPart(part)) return null;
        const isProcessPart =
          part.type === "data-agent-step" ||
          part.type === "data-context-usage" ||
          part.type === "data-turn-usage";
        if (isProcessPart && !isLastAssistant) return null;
        return (
          <Fragment key={item.key}>
            {renderAgentPart(part, ctx)}
          </Fragment>
        );
      })}
    </div>
  );
}, (prev, next) => {
  if (prev.message.parts !== next.message.parts) return false;
  if (prev.message.role !== next.message.role) return false;
  if (prev.messageIndex !== next.messageIndex) return false;
  if (prev.showUserDivider !== next.showUserDivider) return false;
  if (prev.isLastAssistant !== next.isLastAssistant) return false;
  if (
    prev.visibleCodeSourceApprovalOccurrences !==
    next.visibleCodeSourceApprovalOccurrences
  ) {
    return false;
  }
  if (prev.targetKind !== next.targetKind) return false;
  if (prev.settled !== next.settled) return false;
  // 已定格的历史行不受 busy 影响；活动行需随 busy 更新 rerun 禁用态等。
  if (!next.settled && prev.busy !== next.busy) return false;
  return true;
});

export function WritingAssistant({
  articleId,
  targetKind = "article",
  targetId,
  currentMarkdown,
  profileId,
  onProfileChange,
  onApplyArticle,
  onFlushArticle,
  onFlushTarget,
  onApplyDigest,
}: {
  articleId?: string;
  targetKind?: "article";
  targetId?: string;
  currentMarkdown: string;
  /** P3 文章类型 profile id（显示 ArticleProfileBadge）。 */
  profileId?: string | null;
  onProfileChange?: (profileId: string) => void;
  onApplyArticle?: (article: {
    title: string;
    contentMd: string;
    digest: string | null;
    contentRevision: number;
  }) => void;
  onFlushArticle?: () => Promise<void>;
  onFlushTarget?: () => Promise<void>;
  /** Agent 摘要已在服务端落盘；回填编辑器并同步版本游标。 */
  onApplyDigest?: (update: { digest: string; contentRevision: number }) => void;
}) {
  const resolvedTargetId = targetId ?? articleId ?? "";
  const { providers, providerId, modelId, select: selectModel } =
    useModelSelection();
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [fullscreenText, setFullscreenText] = useState<string | null>(null);
  const [lastTurnUsage, setLastTurnUsage] = useState<LastTurnUsage>(null);
  const [snippetReviews, setSnippetReviews] = useState<SnippetReviewRecord[]>([]);
  const [reviewingSnippets, setReviewingSnippets] = useState(false);
  const [snippetReviewError, setSnippetReviewError] = useState("");
  const [restoreDraft, setRestoreDraft] = useState<{
    key: string;
    document: ComposerDocument;
  } | null>(null);
  // 用户历史输入缓存：打开会话时从后端全量加载（仅文本，轻量），新发送的输入追加。
  // 上下键在此列表前后历。与消息分页解耦。（historyIndex 已随 ChatComposer 搬出）
  const [inputHistory, setInputHistory] = useState<ComposerDocument[]>([]);
  // 消息分页懒加载
  const [hasMore, setHasMore] = useState(false);
  const [oldestPosition, setOldestPosition] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // 标记本次 messages 变更是「prepend 更早消息」，需保持视觉位置而非滚到底
  const isLoadingMore = useRef(false);
  const prevScrollHeight = useRef(0);
  const prevScrollTop = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 首次（或切换文章后）加载完成时，是否已执行过「瞬时定位到底」；避免每次都用
  // smooth 动画并落在未稳定的 scrollHeight 上、被后续重渲染打断而停在半路。
  const didInitScroll = useRef(false);
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api: "/api/ai/chat" }),
    []
  );
  const setMessagesAfterFinishRef = useRef<
    ((messages: UIMessage[]) => void) | null
  >(null);
  const currentMessagesRef = useRef<UIMessage[]>([]);
  const generationRef = useRef(0);

  // 待代码源授权：锁定 composer，引导用户先完成上方授权卡片操作。
  // composer 锁由两类审批独立贡献（避免互相 reset）：代码源授权 / P3 工具审批。
  const [codeSourceApprovalBlocked, setCodeSourceApprovalBlocked] =
    useState(false);
  const [toolApprovalBlocked, setToolApprovalBlocked] = useState(false);
  const approvalBlocked = codeSourceApprovalBlocked || toolApprovalBlocked;
  // 恢复被中断的回复：页面级导航导致组件重挂载后，服务端可能仍在处理上一轮
  // （客户端断连不中断服务端 onFinish 持久化）。轮询 DB 直到出现 assistant 回复。
  const [recovering, setRecovering] = useState(false);
  const [serverSessionStatus, setServerSessionStatus] = useState<string | null>(
    null
  );
  const [serverSessionError, setServerSessionError] = useState<string | null>(
    null
  );


  const refresh = useCallback(async () => {
    const [response, reviewResponse] = await Promise.all([
      fetch(`/api/ai/chat?targetKind=${targetKind}&targetId=${resolvedTargetId}`),
      fetch(
        `/api/ai/snippet-reviews?kind=${targetKind}&id=${encodeURIComponent(resolvedTargetId)}`
      ),
    ]);
    const data = await response.json().catch(() => ({}));
    const reviewData = await reviewResponse.json().catch(() => ({}));
    let messageHistory: ComposerDocument[] = [];
    let reviews: SnippetReviewRecord[] = [];
    if (response.ok) {
      setProposals(data.proposals ?? []);
      messageHistory = Array.isArray(data.userInputs)
        ? (data.userInputs as unknown[])
            .map((item) =>
              typeof item === "string"
                ? ([{ type: "text", text: item }] as ComposerDocument)
                : (item as ComposerDocument)
            )
            .filter((item) => Array.isArray(item))
        : [];
      // historyIndex 已随 ChatComposer 搬出；composer 内部自管，刷新历史时不在此复位。
      const session = data.session as
        | {
            lastInputTokens?: number;
            lastOutputTokens?: number;
            lastReasoningTokens?: number;
            lastTotalTokens?: number;
            claudeAgentSessionStatus?: string;
            claudeAgentLastError?: string | null;
          }
        | undefined;
      setServerSessionStatus(session?.claudeAgentSessionStatus ?? null);
      setServerSessionError(session?.claudeAgentLastError ?? null);
      if (session) {
        setLastTurnUsage({
          inputTokens: session.lastInputTokens ?? 0,
          outputTokens: session.lastOutputTokens ?? 0,
          reasoningTokens: session.lastReasoningTokens ?? 0,
          totalTokens: session.lastTotalTokens ?? 0,
        });
      }
    }
    if (reviewResponse.ok && Array.isArray(reviewData.reviews)) {
      reviews = (reviewData.reviews as SnippetReviewRecord[]).reverse();
      setSnippetReviews(reviews);
    }
    setInputHistory(mergeComposerHistory(messageHistory, reviews));
    return data;
  }, [resolvedTargetId, targetKind]);

  useEffect(() => {
    if (!snippetReviews.some((review) => review.status === "running")) return;
    let active = true;
    const timer = window.setInterval(async () => {
      const response = await fetch(
        `/api/ai/snippet-reviews?kind=${targetKind}&id=${encodeURIComponent(resolvedTargetId)}`
      );
      const data = await response.json().catch(() => ({}));
      if (!active || !response.ok || !Array.isArray(data.reviews)) return;
      const reviews = (data.reviews as SnippetReviewRecord[]).reverse();
      setSnippetReviews(reviews);
      setInputHistory((current) => mergeComposerHistory(current, reviews));
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [resolvedTargetId, snippetReviews, targetKind]);

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
  } = useChat({
    id: `${targetKind}-agent-${resolvedTargetId}`,
    transport,
    onFinish: async () => {
      const generation = generationRef.current;
      const data = await refresh();
      if (generation !== generationRef.current) return;
      const persisted = Array.isArray(data.messages)
        ? (data.messages as UIMessage[])
        : [];
      setMessagesAfterFinishRef.current?.(
        mergeFinishedMessages(currentMessagesRef.current, persisted)
      );
      setHasMore(Boolean(data.hasMore));
      setOldestPosition(
        data.oldestPosition == null ? null : Number(data.oldestPosition)
      );
    },
    // 流式更新节流：默认每个 chunk 都触发一次 setMessages → 整个会话重渲染。
    // 长对话里每次渲染要全量重扫 messages（latestContextUsage /
    // proposalIdsInMessages 等多个 O(消息×part) memo）并联动编辑器写入，高频 chunk 会把
    // 同步更新堆到 React 的嵌套上限，抛 "Maximum update depth exceeded"。
    // 按 50ms 合并更新，既消除该报错又显著降低长对话的渲染压力。
    experimental_throttle: 50,
  });

  useEffect(() => {
    setMessagesAfterFinishRef.current = setMessages;
    currentMessagesRef.current = messages;
  }, [messages, setMessages]);

  useEffect(() => {
    let active = true;
    // 切换文章 / 重新加载：重置初始滚动标记，加载完成后重新「瞬时定位到底」
    didInitScroll.current = false;
    refresh()
      .then((data) => {
        if (active) {
          setMessages(data.messages ?? []);
          setHasMore(Boolean(data.hasMore));
          setOldestPosition(
            data.oldestPosition == null ? null : Number(data.oldestPosition)
          );
        }
      })
      .finally(() => active && setInitializing(false));
    return () => {
      active = false;
    };
  }, [refresh, setMessages]);

  // 恢复轮询：最后一条是 user 消息时，服务端可能仍在处理上一轮（客户端断连导致），
  // 周期性拉取直到出现 assistant 回复或超时。
  useEffect(() => {
    if (
      !shouldPollRecoveringTurn({
        clientStatus: status,
        sessionStatus: serverSessionStatus,
        messages,
      })
    ) {
      setRecovering(false);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setRecovering(true);

    const poll = async () => {
      if (!active) return;
      const data = await refresh();
      if (!active) return;
      const msgs = (data.messages ?? []) as UIMessage[];
      const nextSessionStatus =
        (data.session as { claudeAgentSessionStatus?: string } | undefined)
          ?.claudeAgentSessionStatus ?? null;
      if (msgs.length > 0 && msgs[msgs.length - 1].role !== "user") {
        setMessages(msgs);
        setHasMore(Boolean(data.hasMore));
        setOldestPosition(
          data.oldestPosition == null ? null : Number(data.oldestPosition)
        );
        setRecovering(false);
        return; // assistant 回复到达，停止轮询
      }
      if (nextSessionStatus !== "running") {
        setMessages(msgs);
        setHasMore(Boolean(data.hasMore));
        setOldestPosition(
          data.oldestPosition == null ? null : Number(data.oldestPosition)
        );
        setRecovering(false);
        return;
      }
      timer = setTimeout(poll, 5000); // 5s 间隔
    };

    timer = setTimeout(poll, 5000);
    const stopTimer = setTimeout(() => {
      active = false;
      setRecovering(false);
    }, 120000); // 最长 120s（24 次）

    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(stopTimer);
    };
  }, [messages, status, serverSessionStatus, refresh, setMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // 刚 prepend 更早消息：补偿新增高度，保持视觉位置（不跳到顶部）
    if (isLoadingMore.current) {
      el.scrollTop = el.scrollHeight - prevScrollHeight.current + prevScrollTop.current;
      isLoadingMore.current = false;
      return;
    }

    // 首次加载完成（已有消息）：本次 commit 后内容高度未必稳定（卡片/markdown/图片
    // 可能引起回流），smooth 动画会落在未稳定的 scrollHeight 上、且易被后续重渲染
    // （refresh 的 setProposals、status 变化等）打断而停在半路。故首次用「瞬时定位
    // + 下一帧校准 + 短延时兜底」，确保稳稳到底，不走动画。
    if (!didInitScroll.current && messages.length > 0) {
      didInitScroll.current = true;
      const jump = () => {
        const node = scrollRef.current;
        if (node) node.scrollTop = node.scrollHeight;
      };
      jump();
      const raf = requestAnimationFrame(jump);
      const timer = window.setTimeout(jump, 120);
      return () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
      };
    }

    // 后续：新消息到达 / 流式输出 —— 平滑滚到最新（流式用瞬时以跟住节奏）
    el.scrollTo({
      top: el.scrollHeight,
      behavior: status === "streaming" ? "auto" : "smooth",
    });
  }, [messages, status, proposals, snippetReviews, reviewingSnippets]);

  // 滚动到顶部时懒加载更早一页消息（游标 = 当前最旧 position）
  const loadMore = useCallback(async () => {
    if (oldestPosition == null || loadingMore) return;
    const el = scrollRef.current;
    if (el) {
      prevScrollHeight.current = el.scrollHeight;
      prevScrollTop.current = el.scrollTop;
    }
    isLoadingMore.current = true;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/ai/chat?targetKind=${targetKind}&targetId=${resolvedTargetId}&before=${oldestPosition}&limit=10`
      );
      const data = await response.json();
      if (response.ok && Array.isArray(data.messages)) {
        const older = data.messages as UIMessage[];
        if (older.length) setMessages((prev) => [...older, ...prev]);
        setHasMore(Boolean(data.hasMore));
        setOldestPosition(
          data.oldestPosition == null ? null : Number(data.oldestPosition)
        );
      }
    } finally {
      setLoadingMore(false);
    }
  }, [oldestPosition, loadingMore, resolvedTargetId, targetKind, setMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (el && el.scrollTop < 40 && hasMore && !loadingMore) {
        void loadMore();
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, loadingMore, loadMore]);

  const requestBody = {
    target: { kind: targetKind, id: resolvedTargetId },
    providerId: providerId || null,
    modelId: modelId || null,
    // 实时编辑区正文：作为权威正文随每次发送/重跑带给后端，避免 DB 读取时序导致 Agent 拿到空/旧正文。
    currentMarkdown: currentMarkdown ?? "",
  };

  const busy = status === "streaming" || status === "submitted";
  const recoveredTurnNotice = getRecoveredTurnNotice({
    clientStatus: status,
    sessionStatus: serverSessionStatus,
    sessionError: serverSessionError,
  });

  async function clearConversation() {
    // PDC §8.3：/clear 文案需明确三件事——清聊天、开新 Claude 会话、不清 Token 消耗大盘。
    if (
      !window.confirm(
        "清空当前对话与未处理提案，并开启新的 Claude 会话？\n（不影响 Token 消耗大盘的历史统计）"
      )
    )
      return;
    generationRef.current += 1;
    await stop();
    const response = await fetch(
      `/api/ai/chat?targetKind=${targetKind}&targetId=${resolvedTargetId}`,
      {
        method: "DELETE",
      }
    );
    if (response.ok) {
      setMessages([]);
      setProposals([]);
      setSnippetReviews([]);
      setInputHistory([]);
      // historyIndex 已随 ChatComposer 搬出；composer 内部自管。
      setHasMore(false);
      setOldestPosition(null);
      // 清空后无任何用量数据：重置上一轮用量，TokenMeter 回到初始状态。
      setLastTurnUsage(null);
    }
  }

  async function createSnippetReview(
    composer: ComposerDocument
  ): Promise<boolean> {
    setReviewingSnippets(true);
    setSnippetReviewError("");
    try {
      const response = await fetch("/api/ai/snippet-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { kind: targetKind, id: resolvedTargetId },
          composer,
          currentMarkdown: currentMarkdown ?? "",
          providerId: providerId || null,
          modelId: modelId || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.review) {
        setSnippetReviewError(data.error || "灵感审核失败，请稍后重试。");
        return false;
      }
      const review = data.review as SnippetReviewRecord;
      setSnippetReviews((current) => {
        const exists = current.some((item) => item.id === review.id);
        return exists
          ? current.map((item) => (item.id === review.id ? review : item))
          : [...current, review];
      });
      setInputHistory((current) => [...current, composer].slice(-50));
      return true;
    } catch {
      setSnippetReviewError("灵感审核请求失败，请检查模型与网络配置。");
      return false;
    } finally {
      setReviewingSnippets(false);
    }
  }

  /**
   * 发送一条普通消息。
   * - text：进 inputHistory（历史干净，不带标记）。
   * - messageOverride：实际发给 Agent runtime 的文本（@ 引用时为带标记 message）；UI 消息仍展示 text。
   * - forceSkillIds：/skill 强制加载。
   * 注：输入清空（setInput/setSlashForcedClosed）与 historyIndex 复位已由 ChatComposer.submit 负责。
   */
  async function sendText(
    text: string,
    forceSkillIds?: string[],
    messageOverride?: string,
    composer?: ComposerDocument
  ) {
    if (!text || busy) return;
    await (onFlushTarget ?? onFlushArticle)?.();
    const historyDocument = composer ?? [{ type: "text" as const, text }];
    setInputHistory((prev) => {
      const previous = prev[prev.length - 1];
      return JSON.stringify(previous) === JSON.stringify(historyDocument)
        ? prev
        : [...prev, historyDocument].slice(-50);
    });
    await sendMessage(
      { text, metadata: { composer: historyDocument } },
      {
        body: {
          ...requestBody,
          ...(forceSkillIds?.length ? { forceSkillIds } : {}),
          ...(messageOverride ? { messageOverride } : {}),
        },
      }
    );
  }

  async function applySnippetReview(review: SnippetReviewRecord) {
    if (busy) {
      throw new Error("Agent 正在执行上一轮任务，请等待完成后再应用灵感。");
    }
    const response = await fetch(`/api/ai/snippet-reviews/${review.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "应用灵感失败。");
    setSnippetReviews((current) =>
      current.map((item) =>
        item.id === review.id ? { ...item, status: "applied" } : item
      )
    );
    const serialized = composerDocumentToRuntimeText(review.composer);
    void Promise.all(
      serialized.snippetIds.map((id) =>
        fetch(`/api/snippets/${id}/usage`, { method: "POST" }).catch(
          () => undefined
        )
      )
    );
    await sendText(
      review.visibleText,
      undefined,
      review.runtimeText,
      review.composer
    );
  }

  async function rejectSnippetReview(review: SnippetReviewRecord) {
    const response = await fetch(`/api/ai/snippet-reviews/${review.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "放弃灵感失败。");
    setSnippetReviews((current) =>
      current.map((item) =>
        item.id === review.id ? { ...item, status: "rejected" } : item
      )
    );
    setRestoreDraft({ key: `${review.id}:${Date.now()}`, document: review.composer });
  }

  /** 重新执行用户消息：编辑后丢弃其后消息并重跑（codex edit & retry）。
   *  setMessages 同步写内部消息（改写该用户消息文本 + 截断其后），
   *  随后 regenerate() 重跑最后一条（此刻即该用户消息）。 */
  async function rerun(index: number, editedText: string) {
    if (busy) return;
    const targetMsg = messages[index];
    if (!targetMsg || targetMsg.role !== "user" || !editedText.trim()) return;
    const resumeSessionAt = findAssistantCheckpointBefore(messages, index);
    await (onFlushTarget ?? onFlushArticle)?.();
    setMessages((prev) => {
      const next = prev.slice(0, index + 1);
      next[index] = {
        ...next[index],
        parts: [{ type: "text", text: editedText.trim() }],
      };
      return next;
    });
    await regenerate({
      body: {
        ...requestBody,
        ...(resumeSessionAt
          ? { resumeSessionAt }
          : { restartSession: true }),
      },
    });
  }

  const requestBodyRef = useRef(requestBody);
  const flushTargetRef = useRef(onFlushTarget ?? onFlushArticle);
  const regenerateRef = useRef(regenerate);
  const rerunRef = useRef(rerun);

  useEffect(() => {
    requestBodyRef.current = requestBody;
    flushTargetRef.current = onFlushTarget ?? onFlushArticle;
    regenerateRef.current = regenerate;
    rerunRef.current = rerun;
  }, [onFlushArticle, onFlushTarget, regenerate, requestBody]);

  const stableResumeAfterApproval = useCallback(async () => {
    await flushTargetRef.current?.();
    await regenerateRef.current({ body: requestBodyRef.current });
  }, []);

  const stableRerun = useCallback((index: number, editedText: string) => {
    void rerunRef.current(index, editedText);
  }, []);

  const handleApprovalStatusChange = useCallback((status: string) => {
    setCodeSourceApprovalBlocked(status === "pending");
  }, []);

  const handleApprovalFailed = useCallback(() => {
    setCodeSourceApprovalBlocked(false);
  }, []);

  const handleToolApprovalStatusChange = useCallback((status: string) => {
    setToolApprovalBlocked(status === "pending");
  }, []);

  // 最新一条助手消息的索引：过程步骤（意图/代码源/Skill/素材 + 上下文计量）
  // 仅在此轮展示，历史轮次折叠掉这些过程块，避免多轮时「步骤重复、中间夹着上下文 tokens」。
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  const lastAssistantParts =
    lastAssistantIndex >= 0 ? messages[lastAssistantIndex]?.parts : undefined;

  /** 最新助手消息中的待授权 grant id（有则轮询 status 决定是否锁定 composer）。 */
  const pendingApprovalGrantId = useMemo(() => {
    if (!lastAssistantParts) return null;
    for (const p of lastAssistantParts) {
      const part = p as unknown as Record<string, unknown>;
      if (part.type === "data-code-source-approval" && isObj(part.data)) {
        const id = String((part.data as { id?: unknown }).id ?? "");
        if (id) return id;
      }
    }
    return null;
  }, [lastAssistantParts]);

  useEffect(() => {
    if (!pendingApprovalGrantId) {
      setCodeSourceApprovalBlocked(false);
      return;
    }
    let active = true;
    fetch(`/api/ai/code-sources/${pendingApprovalGrantId}/status`)
      .then((response) => response.json())
      .then((result) => {
        if (active) {
          setCodeSourceApprovalBlocked(result.source?.status === "pending");
        }
      })
      .catch(() => {
        if (active) setCodeSourceApprovalBlocked(false);
      });
    return () => {
      active = false;
    };
  }, [pendingApprovalGrantId]);

  /** P3 工具审批：最新助手消息中的待审批 grant id（轮询 /status 锁定 composer）。 */
  const pendingToolApprovalGrantId = useMemo(() => {
    if (!lastAssistantParts) return null;
    for (const p of lastAssistantParts) {
      const part = p as unknown as Record<string, unknown>;
      if (part.type === "data-tool-approval" && isObj(part.data)) {
        const id = String((part.data as { grantId?: unknown }).grantId ?? "");
        if (id) return id;
      }
    }
    return null;
  }, [lastAssistantParts]);

  useEffect(() => {
    if (!pendingToolApprovalGrantId) {
      setToolApprovalBlocked(false);
      return;
    }
    let active = true;
    fetch(`/api/ai/agent-approvals/${pendingToolApprovalGrantId}/status`)
      .then((response) => response.json())
      .then((result) => {
        if (active) {
          setToolApprovalBlocked(result.status === "pending");
        }
      })
      .catch(() => {
        if (active) setToolApprovalBlocked(false);
      });
    return () => {
      active = false;
    };
  }, [pendingToolApprovalGrantId]);

  // 扫描最近的 data-context-usage（composer token 计量用）——仅最新助手消息。
  // 扫描最近的 data-context-usage（composer token 计量用）——仅最新助手消息。
  // 流式期间 lastAssistantParts 每个 chunk 都是新引用（文本在累积），但 data-context-usage 一旦下发
  // 其值不变。先按 parts 扫出 raw，再按叶子原语 memoize → 值不变时 latestContextUsage 引用稳定，
  // 避免下游 TokenMeter 每 chunk 被新对象引用触发重渲染/重跑。
  const contextUsageRaw = useMemo<ContextUsage>(() => {
    if (!lastAssistantParts) return null;
    for (let j = lastAssistantParts.length - 1; j >= 0; j--) {
      const p = lastAssistantParts[j] as unknown as Record<string, unknown>;
      if (
        p.type === "data-context-usage" &&
        p.data &&
        typeof p.data === "object"
      ) {
        const d = p.data as {
          estimatedTokens?: unknown;
          budgetTokens?: unknown;
          compressed?: unknown;
          articleTokens?: unknown;
          compactPreTokens?: unknown;
          compactPostTokens?: unknown;
          compactTrigger?: unknown;
          compactDurationMs?: unknown;
        };
        return {
          estimatedTokens: Number(d.estimatedTokens ?? 0),
          compressed: Boolean(d.compressed),
          articleTokens: Number(d.articleTokens ?? 0),
          ...(d.budgetTokens === undefined
            ? {}
            : { budgetTokens: Number(d.budgetTokens ?? 0) }),
          ...(d.compactPreTokens === undefined
            ? {}
            : { compactPreTokens: Number(d.compactPreTokens ?? 0) }),
          ...(d.compactPostTokens === undefined
            ? {}
            : { compactPostTokens: Number(d.compactPostTokens ?? 0) }),
          ...(d.compactTrigger === "manual" || d.compactTrigger === "auto"
            ? { compactTrigger: d.compactTrigger }
            : {}),
          ...(d.compactDurationMs === undefined
            ? {}
            : { compactDurationMs: Number(d.compactDurationMs ?? 0) }),
        };
      }
    }
    return null;
  }, [lastAssistantParts]);
  const latestContextUsage = useMemo<ContextUsage>(
    () => contextUsageRaw,
    [
      contextUsageRaw?.estimatedTokens,
      contextUsageRaw?.budgetTokens,
      contextUsageRaw?.compressed,
      contextUsageRaw?.articleTokens,
      contextUsageRaw?.compactPreTokens,
      contextUsageRaw?.compactPostTokens,
      contextUsageRaw?.compactTrigger,
      contextUsageRaw?.compactDurationMs,
    ]
  );

  // 本轮结束时后端会在同一条流里下发 data-turn-usage。直接从最新助手消息读取，
  // 避免等 onFinish 持久化 + refresh 才把上一轮消耗显示到浮窗，造成“下一轮才加”的错觉。
  useEffect(() => {
    if (!lastAssistantParts) return;
    for (let j = lastAssistantParts.length - 1; j >= 0; j -= 1) {
      const usage = readLastTurnUsagePart(lastAssistantParts[j]);
      if (usage) {
        setLastTurnUsage(usage);
        return;
      }
    }
  }, [lastAssistantParts]);

  // 扫描 set_article_digest 推送的摘要事件 —— 仅最新助手消息。
  const latestDigest = useMemo(() => {
    if (!lastAssistantParts) return null;
    for (let j = lastAssistantParts.length - 1; j >= 0; j--) {
      const p = lastAssistantParts[j] as unknown as Record<string, unknown>;
      if (
        p.type === "data-article-digest" &&
        p.data &&
        typeof p.data === "object"
      ) {
        const d = p.data as { digest?: unknown; contentRevision?: unknown };
        if (typeof d.digest === "string" && typeof d.contentRevision === "number") {
          return { digest: d.digest, contentRevision: d.contentRevision };
        }
      }
    }
    return null;
  }, [lastAssistantParts]);

  // 摘要：工具结果就绪后直接写入编辑器 digest（仅流式期间应用，避免历史会话覆盖）。
  const appliedDigestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!busy || !latestDigest || !onApplyDigest) return;
    const key = `${latestDigest.contentRevision}:${latestDigest.digest}`;
    if (appliedDigestRef.current === key) return;
    appliedDigestRef.current = key;
    onApplyDigest(latestDigest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDigest, busy]);

  const prefixProposalIds = useMemo(() => {
    if (!busy || lastAssistantIndex <= 0) return null;
    const ids = new Set<string>();
    for (let i = 0; i < lastAssistantIndex; i++) {
      for (const id of collectProposalIds(messages[i].parts)) {
        ids.add(id);
      }
    }
    return ids;
  }, [busy, lastAssistantIndex, messages]);

  const proposalIdsInMessages = useMemo(() => {
    if (!busy || lastAssistantIndex < 0) {
      const ids = new Set<string>();
      for (const message of messages) {
        for (const id of collectProposalIds(message.parts)) {
          ids.add(id);
        }
      }
      return ids;
    }
    const ids = new Set(prefixProposalIds ?? []);
    for (const id of collectProposalIds(messages[lastAssistantIndex].parts)) {
      ids.add(id);
    }
    return ids;
  }, [messages, busy, lastAssistantIndex, prefixProposalIds]);

  const visibleCodeSourceApprovalOccurrences = useMemo(() => {
    const latestByApproval = new Map<string, string>();
    for (const message of messages) {
      const parts = message.parts as unknown as AgentPart[];
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const approvalKey = codeSourceApprovalKey(parts[partIndex]);
        if (!approvalKey) continue;
        latestByApproval.set(
          approvalKey,
          codeSourceApprovalOccurrenceKey({
            messageId: message.id,
            partIndex,
            approvalKey,
          })
        );
      }
    }
    return new Set(latestByApproval.values());
  }, [messages]);

  const chatTimeline = useMemo(
    () => buildSnippetReviewTimeline(messages, snippetReviews),
    [messages, snippetReviews]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">专业写作 Agent</div>
            <div className="text-[11px] text-muted-foreground">
              自动识别意图、加载 Skill、研究并扫描素材 · 输入 / 查看命令
            </div>
          </div>
          <ArticleProfileBadge
            profileId={profileId}
            onChange={onProfileChange}
          />
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {initializing ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载写作会话…
          </div>
        ) : !hasAssistantTimelineContent({
            messageCount: messages.length,
            proposalCount: proposals.length,
            reviewCount: snippetReviews.length,
          }) ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium">直接描述你的写作任务</div>
            <p className="mx-auto mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
              Agent 会自动选择 Skill、项目、资料工具和文章素材。
            </p>
          </div>
        ) : (
          <>
            {loadingMore && (
              <div className="flex items-center justify-center py-2 text-[11px] text-muted-foreground">
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> 加载更早消息…
              </div>
            )}
            {chatTimeline.map((entry) => {
              if (entry.type === "review") {
                return (
                  <SnippetReviewCard
                    key={`review-${entry.review.id}`}
                    review={entry.review}
                    onApply={applySnippetReview}
                    onReject={rejectSnippetReview}
                  />
                );
              }
              const message = entry.message;
              const idx = messages.indexOf(message);
              return (
                <AgentMessageRow
                  key={message.id}
                  message={message}
                  messageIndex={idx}
                  settled={!(busy && idx === lastAssistantIndex)}
                  isLastAssistant={idx === lastAssistantIndex}
                  showUserDivider={idx > 0 && message.role === "user"}
                  targetKind={targetKind}
                  busy={busy}
                  setFullscreenText={setFullscreenText}
                  onApplyArticle={onApplyArticle}
                  onFlushArticle={onFlushTarget ?? onFlushArticle}
                  onRerun={stableRerun}
                  onResumeAfterApproval={stableResumeAfterApproval}
                  onApprovalStatusChange={handleApprovalStatusChange}
                  onApprovalFailed={handleApprovalFailed}
                  onToolApprovalStatusChange={handleToolApprovalStatusChange}
                  profileId={profileId}
                  visibleCodeSourceApprovalOccurrences={
                    visibleCodeSourceApprovalOccurrences
                  }
                />
              );
            })}
            {proposals
              .filter(
                (proposal) =>
                  // 仅渲染未在内联位置出现、且仍待处理的提案；已应用/放弃的历史提案
                  // 不再堆积在底部。按创建时间升序，保证紧随对应对话尾部、不串序。
                  !proposalIdsInMessages.has(proposal.id) &&
                  proposal.status === "pending"
              )
              .sort((a, b) =>
                (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
              )
              .map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposalId={proposal.id}
                  fallback={proposal}
                  profileId={profileId}
                  onBeforeApply={onFlushTarget ?? onFlushArticle}
                  onApplied={(result) => {
                    onApplyArticle?.(
                      result as {
                        title: string;
                        contentMd: string;
                        digest: string | null;
                        contentRevision: number;
                      }
                    );
                  }}
                />
              ))}
          </>
        )}
        {reviewingSnippets && (
          <div className="flex items-center gap-2 rounded-md border border-primary/15 bg-primary/[0.025] px-3 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            灵感审核 Agent 正在结合对话与文章上下文分析…
          </div>
        )}
        {snippetReviewError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
            {snippetReviewError}
          </div>
        )}
        {(busy || recovering) && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {recovering ? "正在同步上一轮输出…" : "Agent 正在规划并执行…"}
          </div>
        )}
        {!busy && !recovering && recoveredTurnNotice && !error && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-5",
              recoveredTurnNotice.tone === "error"
                ? "border-destructive/25 bg-destructive/5 text-destructive"
                : "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300"
            )}
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{recoveredTurnNotice.message}</span>
          </div>
        )}
        {error && (
          <AgentErrorBlock
            error={error}
            retrying={busy}
            onRetry={async () => {
              await (onFlushTarget ?? onFlushArticle)?.();
              await regenerate({ body: requestBody });
            }}
          />
        )}
      </div>

      <ChatComposer
        disabled={initializing || approvalBlocked || busy || reviewingSnippets}
        streaming={busy}
        approvalBlocked={approvalBlocked}
        placeholder={
          approvalBlocked
            ? "等待代码源授权…请在上方卡片选择「仅本会话允许」或「允许并长期信任」"
            : "让 Agent 研究、创作或调整文章…（输入 / 查看命令 · Enter 发送 · Shift+Enter 换行）"
        }
        inputHistory={inputHistory}
        restoreDraft={restoreDraft}
        onDraftRestored={() => setRestoreDraft(null)}
        onSend={async ({ text, composer, snippetRefs, forceSkillIds }) => {
          if (snippetRefs.length) {
            return createSnippetReview(composer);
          }
          await sendText(text, forceSkillIds, undefined, composer);
          return true;
        }}
        onClearConversation={clearConversation}
        onStop={() => stop()}
      >
        <ModelSelector
          providers={providers}
          providerId={providerId}
          modelId={modelId}
          onSelect={selectModel}
        />
        <TokenMeter
          contextUsage={latestContextUsage}
          lastTurn={lastTurnUsage}
          modelName={
            providers
              .find((p) => p.id === providerId)
              ?.models.find((m) => m.id === modelId)?.name ?? modelId
          }
        />
      </ChatComposer>

      <MarkdownFullscreenDialog
        open={fullscreenText !== null}
        onOpenChange={(open) => !open && setFullscreenText(null)}
        text={fullscreenText ?? ""}
        title="AI 输出内容"
      />
    </div>
  );
}
