"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  Bot,
  BrainCircuit,
  Check,
  Clipboard,
  Eye,
  FileSearch,
  Globe2,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArticleDiffDialog,
  type ProposalDetail,
} from "./ArticleDiffDialog";

type ProposalSummary = {
  id: string;
  proposalKind?: "article" | "technical-document";
  title?: string | null;
  summary: string;
  status: string;
};

const TOOL_LABELS: Record<string, string> = {
  set_task_plan: "制定执行计划",
  load_skill: "补充加载 Skill",
  read_skill_resource: "读取 Skill 资源",
  web_search: "搜索网络资料",
  web_extract: "读取网页正文",
  project_search: "搜索本地代码项目",
  project_read: "读取项目文件",
  explore_project: "只读探索代码项目",
  article_assets: "筛选文章素材",
  propose_article_revision: "生成文章修改提案",
  propose_technical_document_revision: "生成技术文档提案",
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

function ToolIcon({ name }: { name: string }) {
  if (name.startsWith("web_")) return <Globe2 className="h-3.5 w-3.5" />;
  if (name.startsWith("project_")) return <FileSearch className="h-3.5 w-3.5" />;
  if (name === "load_skill") return <Sparkles className="h-3.5 w-3.5" />;
  return <Wrench className="h-3.5 w-3.5" />;
}

function summarizeTool(toolName: string, output: unknown, errorText?: unknown) {
  if (typeof errorText === "string") return errorText;
  if (!output || typeof output !== "object") return "执行完成";
  const value = output as Record<string, unknown>;
  if (toolName === "set_task_plan" && Array.isArray(value.steps)) {
    return `${value.intent ?? "任务"} · ${value.steps.length} 个步骤`;
  }
  if (toolName === "load_skill") return `已加载 ${value.name ?? value.id ?? "Skill"}`;
  if (toolName === "web_search") {
    return `获得 ${Array.isArray(value.results) ? value.results.length : 0} 条搜索结果`;
  }
  if (toolName === "project_search") {
    return `找到 ${Array.isArray(value.matches) ? value.matches.length : 0} 个匹配`;
  }
  if (toolName === "project_read") return `已读取 ${value.path ?? "项目文件"}`;
  if (toolName === "explore_project") {
    return `证据包包含 ${Array.isArray(value.symbols) ? value.symbols.length : 0} 个符号、${Array.isArray(value.edges) ? value.edges.length : 0} 条关系`;
  }
  if (toolName === "article_assets") {
    return `读取 ${Array.isArray(value.assets) ? value.assets.length : 0} 项素材`;
  }
  if (toolName === "propose_article_revision") return "文章修改提案已生成";
  return "执行完成";
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
          <div className="rounded-md border bg-background px-2.5 py-2 text-[11px] text-muted-foreground">
            {detail.stats.oldLines} → {detail.stats.newLines} 行，约{" "}
            {detail.stats.changedLines} 行变化
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
      />
    </>
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
}) {
  const resolvedTargetId = targetId ?? articleId ?? "";
  const [input, setInput] = useState("");
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [initializing, setInitializing] = useState(true);
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
                    return (
                      <div
                        key={index}
                        className={cn(
                          "whitespace-pre-wrap break-words text-xs leading-5",
                          message.role === "user"
                            ? "max-w-[88%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground"
                            : "text-foreground"
                        )}
                      >
                        {part.text}
                      </div>
                    );
                  }
                  if (
                    part.type === "reasoning" &&
                    typeof part.text === "string"
                  ) {
                    return (
                      <details
                        key={index}
                        className="rounded-md border border-violet-200 bg-violet-50/60"
                      >
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[11px] text-violet-700">
                          <BrainCircuit className="h-3.5 w-3.5" />
                          模型思考
                          {part.state === "streaming" && (
                            <Loader2 className="ml-auto h-3 w-3 animate-spin" />
                          )}
                        </summary>
                        <div className="border-t border-violet-200 px-3 py-2 whitespace-pre-wrap text-[11px] leading-5 text-violet-950">
                          {part.text}
                        </div>
                      </details>
                    );
                  }
                  if (
                    part.type === "data-agent-step" &&
                    part.data &&
                    typeof part.data === "object"
                  ) {
                    const data = part.data as Record<string, unknown>;
                    return (
                      <div
                        key={index}
                        className="flex items-start gap-2 rounded-md border bg-muted/25 px-2.5 py-2 text-[11px]"
                      >
                        <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                        <div>
                          <div className="font-medium">{String(data.title ?? "Agent 步骤")}</div>
                          {Boolean(data.detail) && (
                            <div className="mt-0.5 text-muted-foreground">
                              {String(data.detail)}
                            </div>
                          )}
                        </div>
                      </div>
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
                  const state = String(part.state ?? "");
                  const running =
                    state.includes("streaming") ||
                    state.includes("input") ||
                    state === "call";
                  const failed = state === "output-error";
                  return (
                    <div
                      key={index}
                      className={cn(
                        "flex items-start gap-2 rounded-md border bg-muted/25 px-2.5 py-2 text-[11px]",
                        failed && "border-red-200 bg-red-50"
                      )}
                    >
                      {running ? (
                        <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-primary" />
                      ) : failed ? (
                        <X className="mt-0.5 h-3.5 w-3.5 text-red-600" />
                      ) : (
                        <ToolIcon name={toolName} />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">
                          {TOOL_LABELS[toolName] ?? toolName}
                        </div>
                        {!running && (
                          <div className="mt-0.5 text-muted-foreground">
                            {summarizeTool(toolName, part.output, part.errorText)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
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
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {error.message}
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
    </div>
  );
}
