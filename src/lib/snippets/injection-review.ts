import crypto from "node:crypto";

export type ComposerTextSegment = { type: "text"; text: string };
export type ComposerSnippetSegment = {
  type: "snippet";
  id: string;
  title: string;
};
export type ComposerSegment = ComposerTextSegment | ComposerSnippetSegment;
export type ComposerDocument = ComposerSegment[];

export type SnippetFingerprintInput = {
  id: string;
  title: string;
  content: string;
  kind: string;
  tags?: string[];
  quoteSource?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
};

export type AppliedSnippetFingerprint = {
  id: string;
  contentHash: string;
};

export type SnippetReviewProgressStep = {
  id: "context" | "redundancy" | "semantic" | "result";
  label: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
};

export function buildSnippetReviewProgress(
  status: "running" | "pending" | "error"
): SnippetReviewProgressStep[] {
  const finished = status === "pending";
  const failed = status === "error";
  return [
    {
      id: "context",
      label: "整理写作上下文",
      description: "读取本轮输入、文章正文与近期正式对话",
      status: "completed",
    },
    {
      id: "redundancy",
      label: "检查素材版本",
      description: "根据已应用灵感 ID 与内容指纹识别重复素材",
      status: "completed",
    },
    {
      id: "semantic",
      label: "分析语义相关性",
      description: "由独立审核 Agent 判断契合度、风险与使用角度",
      status: finished ? "completed" : failed ? "failed" : "running",
    },
    {
      id: "result",
      label: "生成审核结论",
      description: "汇总契合、关联不足与冗余素材，等待用户确认",
      status: finished ? "completed" : "pending",
    },
  ];
}

export function mergeComposerHistory(
  messageHistory: ComposerDocument[],
  reviews: Array<{ composer: ComposerDocument; createdAt: string }>
): ComposerDocument[] {
  const merged = [
    ...messageHistory,
    ...[...reviews]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((review) => review.composer),
  ];
  const seen = new Set<string>();
  return merged
    .filter((document) => {
      const key = JSON.stringify(normalizeComposerDocument(document));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-50);
}

export function hasAssistantTimelineContent({
  messageCount,
  proposalCount,
  reviewCount,
}: {
  messageCount: number;
  proposalCount: number;
  reviewCount: number;
}): boolean {
  return messageCount + proposalCount + reviewCount > 0;
}

type TimelineMessage = {
  role: string;
  metadata?: unknown;
};

type TimelineReview = {
  status: string;
  composer: ComposerDocument;
};

export type SnippetReviewTimelineEntry<
  TMessage extends TimelineMessage,
  TReview extends TimelineReview,
> =
  | { type: "message"; message: TMessage }
  | { type: "review"; review: TReview };

function composerFromMessage(message: TimelineMessage): ComposerDocument | null {
  if (!message.metadata || typeof message.metadata !== "object") return null;
  const composer = (message.metadata as { composer?: unknown }).composer;
  return Array.isArray(composer) ? (composer as ComposerDocument) : null;
}

function composerKey(composer: ComposerDocument): string {
  return JSON.stringify(normalizeComposerDocument(composer));
}

/**
 * 审核是主 Agent 的前置门禁。时间线先显示用户请求，再显示对应审核，
 * 随后才允许出现 Agent 回复；未进入主 Agent 的审核保留在时间线末端。
 */
export function buildSnippetReviewTimeline<
  TMessage extends TimelineMessage,
  TReview extends TimelineReview,
>(
  messages: TMessage[],
  reviews: TReview[]
): SnippetReviewTimelineEntry<TMessage, TReview>[] {
  const remaining = new Set(reviews);
  const appliedByComposer = new Map<string, TReview[]>();
  for (const review of reviews) {
    if (review.status !== "applied") continue;
    const key = composerKey(review.composer);
    appliedByComposer.set(key, [...(appliedByComposer.get(key) ?? []), review]);
  }

  const timeline: SnippetReviewTimelineEntry<TMessage, TReview>[] = [];
  for (const message of messages) {
    timeline.push({ type: "message", message });
    if (message.role === "user") {
      const composer = composerFromMessage(message);
      const matches = composer ? appliedByComposer.get(composerKey(composer)) : null;
      const review = matches?.shift();
      if (review) {
        remaining.delete(review);
        timeline.push({ type: "review", review });
      }
    }
  }
  for (const review of reviews) {
    if (remaining.has(review)) timeline.push({ type: "review", review });
  }
  return timeline;
}

export function isSameActiveSnippetReview(
  review: { status: string; runtimeText: string },
  runtimeText: string
): boolean {
  return (
    (review.status === "running" || review.status === "pending") &&
    canonicalReviewText(review.runtimeText) === canonicalReviewText(runtimeText)
  );
}

function canonicalReviewText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function dedupeActiveSnippetReviews<
  T extends { status: string; runtimeText: string },
>(reviewsNewestFirst: T[]): T[] {
  const activeKeys = new Set<string>();
  return reviewsNewestFirst.filter((review) => {
    if (review.status !== "running" && review.status !== "pending") return true;
    const key = canonicalReviewText(review.runtimeText);
    if (activeKeys.has(key)) return false;
    activeKeys.add(key);
    return true;
  });
}

export function normalizeComposerDocument(
  document: ComposerDocument
): ComposerDocument {
  const normalized: ComposerDocument = [];
  const seenSnippetIds = new Set<string>();
  for (const segment of document) {
    if (segment.type === "snippet") {
      if (!segment.id || seenSnippetIds.has(segment.id)) continue;
      seenSnippetIds.add(segment.id);
      normalized.push({
        type: "snippet",
        id: segment.id,
        title: segment.title.trim() || "未命名灵感",
      });
      continue;
    }
    if (!segment.text) continue;
    const previous = normalized[normalized.length - 1];
    if (previous?.type === "text") {
      previous.text += segment.text;
    } else {
      normalized.push({ type: "text", text: segment.text });
    }
  }
  return normalized;
}

export function composerDocumentToPlainText(document: ComposerDocument): string {
  return normalizeComposerDocument(document)
    .map((segment) =>
      segment.type === "text"
        ? segment.text
        : `[灵感：${segment.title}]`
    )
    .join("");
}

export function composerDocumentToRuntimeText(document: ComposerDocument): {
  text: string;
  runtimeText: string;
  snippetIds: string[];
} {
  const normalized = normalizeComposerDocument(document);
  const snippetIds: string[] = [];
  const text: string[] = [];
  const runtimeText: string[] = [];
  for (const segment of normalized) {
    if (segment.type === "text") {
      text.push(segment.text);
      runtimeText.push(segment.text);
    } else {
      snippetIds.push(segment.id);
      text.push(`[灵感：${segment.title}]`);
      runtimeText.push(`{{snippet:${segment.id}}}`);
    }
  }
  return { text: text.join(""), runtimeText: runtimeText.join(""), snippetIds };
}

export function fingerprintSnippet(input: SnippetFingerprintInput): string {
  const stable = JSON.stringify({
    title: input.title.trim(),
    content: input.content.trim(),
    kind: input.kind,
    tags: [...(input.tags ?? [])].map((tag) => tag.trim()).filter(Boolean).sort(),
    quoteSource: input.quoteSource?.trim() || null,
    linkUrl: input.linkUrl?.trim() || null,
    linkTitle: input.linkTitle?.trim() || null,
    linkDescription: input.linkDescription?.trim() || null,
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

export function findRedundantSnippetIds(
  current: AppliedSnippetFingerprint[],
  previouslyApplied: ReadonlyMap<string, string>
): string[] {
  return current
    .filter((item) => previouslyApplied.get(item.id) === item.contentHash)
    .map((item) => item.id);
}
