"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Eye,
  FileSearch,
  Loader2,
  Maximize2,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { AgentStepBlock } from "@/components/ai/AgentStepBlock";
import { Markdown } from "@/components/ai/Markdown";
import { MarkdownFullscreenDialog } from "@/components/ai/MarkdownFullscreenDialog";

type ProposalSummary = {
  id: string;
  proposalKind?: "article" | "technical-document";
  title?: string | null;
  summary: string;
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待审查",
  applying: "应用中",
  applied: "已应用",
  rejected: "已放弃",
  superseded: "已失效",
};

function toolNameFromPart(part: Record<string, unknown>) {
  if (part.type === "dynamic-tool" && typeof part.toolName === "string") {
    return part.toolName;
  }
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return typeof part.toolName === "string" ? part.toolName : "";
}

function proposalIdFromOutput(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const id = (value as { proposalId?: unknown }).proposalId;
  return typeof id === "string" ? id : "";
}

async function svgToPng(svg: string) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = Math.max(1, image.naturalWidth * scale);
    canvas.height = Math.max(1, image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建图表画布。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("图表 PNG 转换失败。"))),
        "image/png"
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function materializeMermaid(markdown: string, articleId: string) {
  const matches = [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
  if (!matches.length) return markdown;
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  let result = markdown;
  for (let index = 0; index < matches.length; index++) {
    const full = matches[index][0];
    const source = matches[index][1].trim();
    const rendered = await mermaid.render(`proposal-mermaid-${crypto.randomUUID()}`, source);
    const png = await svgToPng(rendered.svg);
    const form = new FormData();
    form.append("file", new File([png], `mermaid-${index + 1}.png`, { type: "image/png" }));
    form.append("articleId", articleId);
    form.append("description", `文章 Mermaid 图表 ${index + 1}`);
    form.append("tags", "mermaid,diagram");
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
  onApplied,
}: {
  proposalId: string;
  fallback?: ProposalSummary;
  onApplied: (result: Record<string, unknown>) => void;
}) {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [status, setStatus] = useState(fallback?.status ?? "pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

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
    setStatus("applied");
    setDetail((current) => (current ? { ...current, status: "applied" } : current));
    setDiffOpen(false);
    const applied = data.article ?? data.technicalDocument;
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
            <div className="text-xs font-semibold">
              {(detail?.proposalKind ?? fallback?.proposalKind) ===
              "technical-document"
                ? "技术文档修改提案"
                : "文章修改提案"}
            </div>
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
          {status === "pending" && (
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
                应用修改
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={reject}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
                放弃
              </Button>
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
}: {
  data: {
    id: string;
    displayName: string;
    locator: string;
    approvalToken: string;
  };
  onApproved: () => Promise<void>;
}) {
  const [sourceStatus, setSourceStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/ai/code-sources/${data.id}/status`)
      .then((response) => response.json())
      .then((result) => {
        if (result.source?.status) setSourceStatus(result.source.status);
      })
      .catch(() => undefined);
  }, [data.id]);

  async function decide(
    action: "approve" | "reject",
    scope: "session" | "trusted" = "session"
  ) {
    setBusy(true);
    setError("");
    const response = await fetch(
      `/api/ai/code-sources/${data.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          approvalToken: data.approvalToken,
          action,
          scope,
        }),
      }
    );
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(result.error || "代码源授权失败。");
      return;
    }
    setSourceStatus(action === "approve" ? "approved" : "rejected");
    if (action === "approve") await onApproved();
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs">
      <div className="flex items-start gap-2">
        <FileSearch className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-amber-950">授权只读代码探索</div>
          <div className="mt-1 text-amber-900">{data.displayName}</div>
          <div className="mt-1 break-all font-mono text-[10px] text-amber-700">
            {data.locator}
          </div>
          <p className="mt-2 leading-5 text-amber-800">
            仅允许读取源码、符号与 Git 历史；不会修改、构建或执行项目。
          </p>
        </div>
      </div>
      {error && <p className="mt-2 text-red-600">{error}</p>}
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
              <Check className="h-3.5 w-3.5 text-emerald-600" />
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

export function WritingAssistant({
  articleId,
  targetKind = "article",
  targetId,
  providerId,
  modelId,
  onApplyArticle,
  onApplyTechnicalDocument,
  onFlushArticle,
  onFlushTarget,
  onApplyDigest,
}: {
  articleId?: string;
  targetKind?: "article" | "technical-document";
  targetId?: string;
  currentMarkdown: string;
  providerId: string;
  modelId: string;
  onApplyArticle?: (article: {
    title: string;
    contentMd: string;
    digest: string | null;
  }) => void;
  onApplyTechnicalDocument?: (document: {
    title: string;
    markdown: string;
    snapshotHash: string;
  }) => void;
  onFlushArticle?: () => Promise<void>;
  onFlushTarget?: () => Promise<void>;
  /** Agent 摘要生成后镜像到编辑器 digest 字段（复用编辑器自动保存链路落盘）。 */
  onApplyDigest?: (digest: string) => void;
}) {
  const resolvedTargetId = targetId ?? articleId ?? "";
  const [input, setInput] = useState("");
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [fullscreenText, setFullscreenText] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(
    () => new DefaultChatTransport<UIMessage>({ api: "/api/ai/chat" }),
    []
  );

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/ai/chat?targetKind=${targetKind}&targetId=${resolvedTargetId}`
    );
    const data = await response.json();
    if (response.ok) setProposals(data.proposals ?? []);
    return data;
  }, [resolvedTargetId, targetKind]);

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
    onFinish: () => void refresh(),
  });

  useEffect(() => {
    let active = true;
    refresh()
      .then((data) => {
        if (active) setMessages(data.messages ?? []);
      })
      .finally(() => active && setInitializing(false));
    return () => {
      active = false;
    };
  }, [refresh, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: status === "streaming" ? "auto" : "smooth",
    });
  }, [messages, status, proposals]);

  const requestBody = {
    target: { kind: targetKind, id: resolvedTargetId },
    providerId: providerId || null,
    modelId: modelId || null,
  };

  async function submit() {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    await (onFlushTarget ?? onFlushArticle)?.();
    setInput("");
    await sendMessage({ text }, { body: requestBody });
  }

  async function clearConversation() {
    if (!window.confirm("清空当前目标的 Agent 对话与未处理提案？")) return;
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
    }
  }

  const busy = status === "streaming" || status === "submitted";

  // 扫描已完成的 propose_article_revision 工具结果，取最新的 direct 模式输出。
  // 工具 output 是可靠来源（part.state 为 output/output-streaming 即已就绪），
  // 不依赖 data-article-draft 流式 part 的时序。
  const latestDirectArticle = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (let j = messages[i].parts.length - 1; j >= 0; j--) {
        const p = messages[i].parts[j] as unknown as Record<string, unknown>;
        const name = toolNameFromPart(p);
        if (name !== "propose_article_revision") continue;
        const out = p.output as
          | { mode?: unknown; markdown?: unknown; title?: unknown; digest?: unknown }
          | undefined;
        if (out?.mode === "direct" && typeof out.markdown === "string") {
          return {
            markdown: out.markdown,
            title: typeof out.title === "string" ? out.title : null,
            digest: typeof out.digest === "string" ? out.digest : null,
          };
        }
      }
    }
    return null;
  }, [messages]);

  // 扫描 set_article_digest 推送的摘要事件，取最新一条。
  const latestDigest = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      for (let j = messages[i].parts.length - 1; j >= 0; j--) {
        const p = messages[i].parts[j] as unknown as Record<string, unknown>;
        if (
          p.type === "data-article-digest" &&
          p.data &&
          typeof p.data === "object"
        ) {
          const d = (p.data as { digest?: unknown }).digest;
          if (typeof d === "string") return d;
        }
      }
    }
    return null;
  }, [messages]);

  // 记录已应用过的 direct 文章 markdown，避免重复写入（流式期间多次 messages 更新）。
  const appliedDirectRef = useRef<string | null>(null);

  // direct 模式：工具结果就绪后直接写入编辑器（首次生成，无需确认）。
  // 仅在流式期间应用，避免历史会话加载时覆盖用户已编辑的内容。
  useEffect(() => {
    if (!busy || !latestDirectArticle || !onApplyArticle) return;
    if (appliedDirectRef.current === latestDirectArticle.markdown) return;
    appliedDirectRef.current = latestDirectArticle.markdown;
    onApplyArticle({
      title: latestDirectArticle.title ?? "",
      contentMd: latestDirectArticle.markdown,
      digest: latestDirectArticle.digest ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDirectArticle, busy]);

  // 摘要：工具结果就绪后直接写入编辑器 digest（仅流式期间应用，避免历史会话覆盖）。
  const appliedDigestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!busy || !latestDigest || !onApplyDigest) return;
    if (appliedDigestRef.current === latestDigest) return;
    appliedDigestRef.current = latestDigest;
    onApplyDigest(latestDigest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestDigest, busy]);

  const proposalIdsInMessages = new Set(
    messages.flatMap((message) =>
      message.parts
        .map((part) =>
          proposalIdFromOutput(
            (part as unknown as Record<string, unknown>).output
          )
        )
        .filter(Boolean)
    )
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">专业写作 Agent</div>
            <div className="text-[11px] text-muted-foreground">
              自动识别意图、加载 Skill、研究并扫描素材
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="重新生成上一条回复"
            disabled={!messages.length || busy}
            onClick={async () => {
              await (onFlushTarget ?? onFlushArticle)?.();
              await regenerate({ body: requestBody });
            }}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            title="清空会话"
            onClick={clearConversation}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {initializing ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            加载写作会话…
          </div>
        ) : messages.length === 0 && proposals.length === 0 ? (
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
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "space-y-2",
                  message.role === "user" && "flex flex-col items-end"
                )}
              >
                {message.parts.map((rawPart, index) => {
                  const part = rawPart as unknown as Record<string, unknown>;
                  if (part.type === "text" && typeof part.text === "string") {
                    if (message.role === "user") {
                      return (
                        <div
                          key={index}
                          className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-primary px-3 py-2 text-xs leading-5 text-primary-foreground"
                        >
                          {part.text}
                        </div>
                      );
                    }
                    // assistant 文本：markdown 渲染 + 全屏按钮
                    return (
                      <div
                        key={index}
                        className="group relative rounded-md text-foreground"
                      >
                        <Markdown className="text-xs leading-5">{part.text}</Markdown>
                        <button
                          type="button"
                          title="全屏查看"
                          onClick={() => setFullscreenText(part.text as string)}
                          className="absolute -right-1 -top-1 rounded-md border bg-background p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          <Maximize2 className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  }
                  if (
                    part.type === "reasoning" &&
                    typeof part.text === "string"
                  ) {
                    return (
                      <ReasoningBlock
                        key={index}
                        text={part.text as string}
                        state={typeof part.state === "string" ? part.state : undefined}
                      />
                    );
                  }
                  if (
                    part.type === "data-code-source-approval" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    return (
                      <CodeSourceApprovalCard
                        key={index}
                        data={
                          part.data as {
                            id: string;
                            displayName: string;
                            locator: string;
                            approvalToken: string;
                          }
                        }
                        onApproved={async () => {
                          await (onFlushTarget ?? onFlushArticle)?.();
                          await regenerate({ body: requestBody });
                        }}
                      />
                    );
                  }
                  if (
                    part.type === "data-code-source-ready" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div
                        key={index}
                        className="rounded-md border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-[11px] text-emerald-900"
                      >
                        <div className="flex items-center gap-1.5 font-medium">
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          代码源已就绪：{String(data.displayName ?? "")}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-emerald-700">
                          {String(data.locator ?? "")}
                          {data.ref ? ` · ${String(data.ref)}` : ""}
                        </div>
                      </div>
                    );
                  }
                  if (
                    part.type === "data-git-range" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div
                        key={index}
                        className="rounded-md border border-violet-200 bg-violet-50/60 px-2.5 py-2 text-[11px]"
                      >
                        <div className="font-medium text-violet-950">
                          Git 范围：{String(data.requestedRange ?? "")}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-violet-700">
                          {String(data.baseCommit ?? "").slice(0, 10)} →{" "}
                          {String(data.headCommit ?? "").slice(0, 10)}
                        </div>
                      </div>
                    );
                  }
                  if (
                    part.type === "data-commit-evidence" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div key={index} className="rounded-md border px-2.5 py-2 text-[11px]">
                        <span className="mr-2 font-mono text-primary">
                          {String(data.shortSha ?? data.sha ?? "").slice(0, 10)}
                        </span>
                        {String(data.subject ?? "")}
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {String(data.author ?? "")} · {String(data.authoredAt ?? "")}
                        </div>
                      </div>
                    );
                  }
                  if (
                    part.type === "data-change-evidence-summary" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div key={index} className="rounded-md border px-2.5 py-2 text-[11px]">
                        已分析 {Number(data.commits ?? 0)} 个提交、{" "}
                        {Number(data.changedFiles ?? 0)} 个文件，整理为{" "}
                        {Number(data.featureGroups ?? 0)} 组功能变化
                        {data.truncated ? " · 部分结果已截断" : ""}
                      </div>
                    );
                  }
                  if (
                    part.type === "data-agent-step" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    return (
                      <AgentStepBlock
                        key={index}
                        data={part.data as Record<string, unknown>}
                      />
                    );
                  }
                  if (
                    part.type === "data-context-usage" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div key={index} className="text-[10px] text-muted-foreground">
                        上下文约 {Number(data.estimatedTokens ?? 0).toLocaleString()} /{" "}
                        {Number(data.budgetTokens ?? 0).toLocaleString()} tokens
                        {data.compressed ? " · 已压缩历史对话" : ""}
                      </div>
                    );
                  }
                  if (
                    part.type === "data-code-explore-step" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div
                        key={index}
                        className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 px-2.5 py-2 text-[11px]"
                      >
                        <FileSearch className="mt-0.5 h-3.5 w-3.5 text-blue-700" />
                        <div>
                          <div className="font-medium text-blue-950">
                            {String(data.title ?? "代码探索")}
                          </div>
                          <div className="mt-0.5 text-blue-700">
                            {String(data.detail ?? "")}
                          </div>
                        </div>
                      </div>
                    );
                  }
                  if (
                    part.type === "data-project-snapshot" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div key={index} className="rounded-md border px-2.5 py-2 text-[11px]">
                        代码快照 {String(data.snapshotHash ?? "").slice(0, 10)} ·{" "}
                        {Number(data.symbols ?? 0)} 个符号 · {Number(data.edges ?? 0)} 条关系
                        {data.truncated ? " · 部分结果已截断" : ""}
                      </div>
                    );
                  }
                  if (
                    part.type === "data-source-evidence" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div key={index} className="truncate text-[10px] text-muted-foreground">
                        {String(data.path ?? "")}#L{String(data.startLine ?? "")}
                        {data.endLine !== data.startLine ? `-L${String(data.endLine ?? "")}` : ""}
                      </div>
                    );
                  }
                  if (
                    part.type === "source-url" &&
                    typeof part.url === "string"
                  ) {
                    return (
                      <a
                        key={index}
                        href={part.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate rounded-md border px-2 py-1.5 text-[11px] text-primary hover:bg-accent"
                      >
                        {typeof part.title === "string" ? part.title : part.url}
                      </a>
                    );
                  }
                  const toolName = toolNameFromPart(part);
                  if (!toolName) return null;
                  // 首次生成（direct 模式）：正文已直接写入编辑器，不渲染提案卡片
                  const draftMode = (part.output as { mode?: unknown } | undefined)?.mode;
                  if (toolName === "propose_article_revision" && draftMode === "direct") {
                    return null;
                  }
                  const proposalId =
                    (toolName === "propose_article_revision" ||
                      toolName === "propose_technical_document_revision")
                      ? proposalIdFromOutput(part.output)
                      : "";
                  if (proposalId) {
                    return (
                      <ProposalCard
                        key={index}
                        proposalId={proposalId}
                        onApplied={(result) => {
                          if (targetKind === "article") {
                            onApplyArticle?.(
                              result as {
                                title: string;
                                contentMd: string;
                                digest: string | null;
                              }
                            );
                          } else {
                            onApplyTechnicalDocument?.(
                              result as {
                                title: string;
                                markdown: string;
                                snapshotHash: string;
                              }
                            );
                          }
                        }}
                      />
                    );
                  }
                  // 工具调用：用可展开的 ToolCallBlock（默认收起，点击查看输入输出）
                  return <ToolCallBlock key={index} part={part} />;
                })}
              </div>
            ))}
            {proposals
              .filter((proposal) => !proposalIdsInMessages.has(proposal.id))
              .map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposalId={proposal.id}
                  fallback={proposal}
                  onApplied={(result) => {
                    if (targetKind === "article") {
                      onApplyArticle?.(
                        result as {
                          title: string;
                          contentMd: string;
                          digest: string | null;
                        }
                      );
                    } else {
                      onApplyTechnicalDocument?.(
                        result as {
                          title: string;
                          markdown: string;
                          snapshotHash: string;
                        }
                      );
                    }
                  }}
                />
              ))}
          </>
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Agent 正在规划并执行…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{error.message || "请求失败，请稍后重试。"}</span>
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="rounded-xl border bg-background p-2 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="让 Agent 研究、创作或调整文章…"
            className="min-h-20 w-full resize-none bg-transparent px-1 text-xs outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Enter 发送 · Shift+Enter 换行
            </span>
            {busy ? (
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => stop()}
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7"
                disabled={!input.trim()}
                onClick={() => void submit()}
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <MarkdownFullscreenDialog
        open={fullscreenText !== null}
        onOpenChange={(open) => !open && setFullscreenText(null)}
        text={fullscreenText ?? ""}
        title="AI 输出内容"
      />
    </div>
  );
}
