import { describe, expect, it } from "vitest";
import {
  composerDocumentToPlainText,
  composerDocumentToRuntimeText,
  fingerprintSnippet,
  findRedundantSnippetIds,
  buildSnippetReviewProgress,
  buildSnippetReviewTimeline,
  dedupeActiveSnippetReviews,
  hasAssistantTimelineContent,
  isSameActiveSnippetReview,
  mergeComposerHistory,
  normalizeComposerDocument,
  type ComposerDocument,
} from "../../src/lib/snippets/injection-review";
import { parseSnippetReviewAgentOutput } from "../../src/lib/snippets/injection-review-agent";

const document: ComposerDocument = [
  { type: "text", text: "我要写一篇文章，参考 " },
  { type: "snippet", id: "s1", title: "第一条灵感" },
  { type: "text", text: "，然后补充 " },
  { type: "snippet", id: "s2", title: "第二条灵感" },
];

describe("snippet injection review", () => {
  it("serializes structured composer documents without leaking runtime markers", () => {
    expect(composerDocumentToPlainText(document)).toBe(
      "我要写一篇文章，参考 [灵感：第一条灵感]，然后补充 [灵感：第二条灵感]"
    );
    expect(composerDocumentToRuntimeText(document)).toEqual({
      text: "我要写一篇文章，参考 [灵感：第一条灵感]，然后补充 [灵感：第二条灵感]",
      runtimeText:
        "我要写一篇文章，参考 {{snippet:s1}}，然后补充 {{snippet:s2}}",
      snippetIds: ["s1", "s2"],
    });
  });

  it("normalizes adjacent text and removes empty or duplicate snippet segments", () => {
    expect(
      normalizeComposerDocument([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "snippet", id: "s1", title: "一" },
        { type: "snippet", id: "s1", title: "重复" },
        { type: "text", text: "" },
      ])
    ).toEqual([
      { type: "text", text: "ab" },
      { type: "snippet", id: "s1", title: "一" },
    ]);
  });

  it("treats the same id as redundant only when its content fingerprint matches", () => {
    const oldHash = fingerprintSnippet({
      id: "s1",
      title: "标题",
      content: "旧内容",
      kind: "text",
      tags: ["agent"],
    });
    const changedHash = fingerprintSnippet({
      id: "s1",
      title: "标题",
      content: "新内容",
      kind: "text",
      tags: ["agent"],
    });

    expect(
      findRedundantSnippetIds(
        [{ id: "s1", contentHash: oldHash }],
        new Map([["s1", oldHash]])
      )
    ).toEqual(["s1"]);
    expect(
      findRedundantSnippetIds(
        [{ id: "s1", contentHash: changedHash }],
        new Map([["s1", oldHash]])
      )
    ).toEqual([]);
  });

  it("parses a fenced JSON result returned by the isolated review agent", () => {
    expect(
      parseSnippetReviewAgentOutput(
        '```json\n{"summary":"可用","assessments":[{"id":"s1","verdict":"matched","score":82,"reason":"主题一致","suggestion":"用于开篇"}]}\n```'
      )
    ).toEqual({
      summary: "可用",
      assessments: [
        {
          id: "s1",
          verdict: "matched",
          score: 82,
          reason: "主题一致",
          suggestion: "用于开篇",
        },
      ],
    });
  });

  it("repairs a missing comma in otherwise valid review agent JSON", () => {
    expect(
      parseSnippetReviewAgentOutput(
        '{"summary":"可用","assessments":[{"id":"s1","verdict":"matched","score":82,"reason":"主题一致" "suggestion":"用于开篇"}]}'
      )
    ).toEqual({
      summary: "可用",
      assessments: [
        {
          id: "s1",
          verdict: "matched",
          score: 82,
          reason: "主题一致",
          suggestion: "用于开篇",
        },
      ],
    });
  });

  it("returns a user-facing error when review JSON cannot be recovered", () => {
    expect(() => parseSnippetReviewAgentOutput("这不是审核 JSON")).toThrow(
      "灵感审核结果格式异常，请重新审核。"
    );
  });

  it("keeps running and pending snippet inputs in recoverable composer history", () => {
    const plain: ComposerDocument = [{ type: "text", text: "普通消息" }];
    const appliedDuplicate: ComposerDocument = [
      { type: "text", text: "已应用 " },
      { type: "snippet", id: "s1", title: "第一条灵感" },
    ];
    const running: ComposerDocument = [
      { type: "text", text: "审核中 " },
      { type: "snippet", id: "s2", title: "第二条灵感" },
    ];

    expect(
      mergeComposerHistory(
        [plain, appliedDuplicate],
        [
          { composer: appliedDuplicate, createdAt: "2026-07-09T10:01:00.000Z" },
          { composer: running, createdAt: "2026-07-09T10:02:00.000Z" },
        ]
      )
    ).toEqual([plain, appliedDuplicate, running]);
  });

  it("describes persisted review progress for running, completed, and failed jobs", () => {
    expect(buildSnippetReviewProgress("running").map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "running",
      "pending",
    ]);
    expect(buildSnippetReviewProgress("pending").map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(buildSnippetReviewProgress("error").map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "failed",
      "pending",
    ]);
  });

  it("treats a snippet review as timeline content even in an otherwise empty chat", () => {
    expect(
      hasAssistantTimelineContent({
        messageCount: 0,
        proposalCount: 0,
        reviewCount: 1,
      })
    ).toBe(true);
    expect(
      hasAssistantTimelineContent({
        messageCount: 0,
        proposalCount: 0,
        reviewCount: 0,
      })
    ).toBe(false);
  });

  it("deduplicates the same active review but allows resolved or changed input", () => {
    expect(
      isSameActiveSnippetReview(
        { status: "running", runtimeText: "写作 {{snippet:s1}}" },
        " 写作  {{snippet:s1}} "
      )
    ).toBe(true);
    expect(
      isSameActiveSnippetReview(
        { status: "pending", runtimeText: "写作 {{snippet:s1}}" },
        "写作 {{snippet:s1}}"
      )
    ).toBe(true);
    expect(
      isSameActiveSnippetReview(
        { status: "applied", runtimeText: "写作 {{snippet:s1}}" },
        "写作 {{snippet:s1}}"
      )
    ).toBe(false);
    expect(
      isSameActiveSnippetReview(
        { status: "running", runtimeText: "写作 {{snippet:s1}}" },
        "调整后 {{snippet:s1}}"
      )
    ).toBe(false);
  });

  it("collapses duplicate active reviews while preserving resolved history", () => {
    const reviews = [
      { id: "new", status: "pending", runtimeText: "写作 {{snippet:s1}}" },
      { id: "old", status: "running", runtimeText: "写作  {{snippet:s1}} " },
      { id: "done", status: "applied", runtimeText: "写作 {{snippet:s1}}" },
    ];

    expect(dedupeActiveSnippetReviews(reviews).map((review) => review.id)).toEqual([
      "new",
      "done",
    ]);
  });

  it("places an applied snippet review after its user message and before the agent reply", () => {
    const reviewedComposer: ComposerDocument = [
      { type: "text", text: "用这条灵感写文章：" },
      { type: "snippet", id: "s1", title: "Agent 定义" },
    ];
    const messages = [
      {
        id: "user-1",
        role: "user",
        metadata: { composer: reviewedComposer },
      },
      { id: "assistant-1", role: "assistant" },
    ];
    const reviews = [
      {
        id: "review-1",
        status: "applied",
        composer: reviewedComposer,
      },
      {
        id: "review-pending",
        status: "pending",
        composer: [{ type: "snippet", id: "s2", title: "待审核" }] as ComposerDocument,
      },
    ];

    expect(
      buildSnippetReviewTimeline(messages, reviews).map((entry) =>
        entry.type === "message" ? entry.message.id : entry.review.id
      )
    ).toEqual([
      "user-1",
      "review-1",
      "assistant-1",
      "review-pending",
    ]);
  });
});
