import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

/* ------------------------------------------------------------------ */
/* Mocks                                                              */
/* ------------------------------------------------------------------ */

// In-memory message store keyed by sessionId.
// Each row mirrors the Prisma AgentChatMessage shape used by chat-persistence.
type MessageRow = {
  id: string;
  sessionId: string;
  role: string;
  partsJson: string;
  metadataJson: string | null;
  position: number;
};

let messageStore: Map<string, MessageRow[]>;

vi.mock("@/lib/db", () => ({
  prisma: {
    agentChatMessage: {
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let rows = (messageStore.get(where.sessionId) ?? []).slice();
        if (where.position?.lt !== undefined) {
          rows = rows.filter((r) => r.position < where.position.lt);
        }
        rows.sort((a, b) =>
          orderBy?.position === "asc"
            ? a.position - b.position
            : b.position - a.position
        );
        if (take !== undefined) rows = rows.slice(0, take);
        return rows;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const rows = messageStore.get(where.sessionId) ?? [];
        let count = 0;
        const remaining = rows.filter((r) => {
          if (
            where === null ||
            typeof where !== "object" ||
            Object.keys(where).length <= 1 // only sessionId
          ) {
            count++;
            return false;
          }
          if (
            where.position?.lte !== undefined &&
            r.position <= where.position.lte
          ) {
            count++;
            return false;
          }
          if (
            where.position?.lt !== undefined &&
            r.position < where.position.lt
          ) {
            count++;
            return false;
          }
          return true;
        });
        messageStore.set(where.sessionId, remaining);
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => {
        const rows = messageStore.get(data.sessionId) ?? [];
        rows.push(data);
        messageStore.set(data.sessionId, rows);
        return data;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = messageStore.get(where.sessionId) ?? [];
        for (const r of rows) {
          if (data.position?.decrement !== undefined) {
            r.position -= data.position.decrement;
          }
        }
        return { count: rows.length };
      }),
    },
    agentChatSession: {
      update: vi.fn(async ({ where, data }: any) => {
        return { id: where.id, ...data };
      }),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === "function") return arg({});
      return undefined;
    }),
  },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

/* ------------------------------------------------------------------ */
/* Imports (after mocks)                                              */
/* ------------------------------------------------------------------ */

import { generateText } from "ai";
import { articleVersionHash } from "../../src/lib/ai/article-version";
import {
  estimateTokens,
  prepareAgentContext,
  summarizeConversation,
} from "../../src/lib/ai/context-manager";
import {
  loadAllAgentMessages,
  mergeAndPersistMessages,
  saveAgentMessages,
} from "../../src/lib/ai/chat-persistence";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function msg(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text" as const, text }] };
}

function seedMessages(sessionId: string, messages: UIMessage[]) {
  messageStore.set(
    sessionId,
    messages.map((m, i) => ({
      id: m.id,
      sessionId,
      role: m.role,
      partsJson: JSON.stringify(m.parts ?? []),
      metadataJson:
        "metadata" in m && (m as any).metadata !== undefined
          ? JSON.stringify((m as any).metadata)
          : null,
      position: i,
    }))
  );
}

const fakeModel = { id: "test", provider: "test" } as any;

beforeEach(() => {
  messageStore = new Map();
  vi.mocked(generateText).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* estimateTokens (existing)                                          */
/* ------------------------------------------------------------------ */

describe("estimateTokens", () => {
  it("counts Chinese text more densely than ASCII text", () => {
    expect(estimateTokens("这是一段中文内容")).toBeGreaterThan(
      estimateTokens("short")
    );
  });
});

/* ------------------------------------------------------------------ */
/* mergeAndPersistMessages                                            */
/* ------------------------------------------------------------------ */

describe("mergeAndPersistMessages", () => {
  const SID = "sess-merge";

  it("append: 前端截断消息 → 用 DB 补全前缀，返回完整历史", async () => {
    // DB has 15 messages; frontend only sent last 3 (simulating remount + pagination)
    const all = Array.from({ length: 15 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`)
    );
    seedMessages(SID, all);

    // Frontend only carries the last 3 (e.g. m12, m13, m14) + new user message m15
    const frontend = [
      msg("m12", "assistant", "msg 12"),
      msg("m13", "user", "msg 13"),
      msg("m14", "assistant", "msg 14"),
      msg("m15", "user", "new question"),
    ];

    const merged = await mergeAndPersistMessages(SID, frontend);

    // Merged should contain all 16 messages (15 DB + 1 new)
    expect(merged).toHaveLength(16);
    expect(merged[0].id).toBe("m0");
    expect(merged[15].id).toBe("m15");

    // DB should also have 16 messages
    const dbAfter = await loadAllAgentMessages(SID);
    expect(dbAfter).toHaveLength(16);
    expect(dbAfter[15].id).toBe("m15");
  });

  it("truncate: 前端最后一条消息 ID 在 DB 中存在 → 截断 DB", async () => {
    // DB has 10 messages; user reruns from message 5 (truncate after it)
    const all = Array.from({ length: 10 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`)
    );
    seedMessages(SID, all);

    // Frontend carries first 6 messages (slice(0, 6)) — last id m5 exists in DB
    const frontend = all.slice(0, 6);

    const merged = await mergeAndPersistMessages(SID, frontend);

    expect(merged).toHaveLength(6);
    expect(merged[5].id).toBe("m5");

    const dbAfter = await loadAllAgentMessages(SID);
    expect(dbAfter).toHaveLength(6);
    expect(dbAfter[5].id).toBe("m5");
  });

  it("新会话: DB 为空 → 直接写入前端消息", async () => {
    const frontend = [
      msg("m0", "user", "hello"),
      msg("m1", "assistant", "hi"),
    ];

    const merged = await mergeAndPersistMessages(SID, frontend);

    expect(merged).toHaveLength(2);
    expect(merged).toEqual(frontend);

    const dbAfter = await loadAllAgentMessages(SID);
    expect(dbAfter).toHaveLength(2);
  });

  it("append: 前端与 DB 无交集（异常）→ 保守写入前端消息", async () => {
    seedMessages(SID, [msg("old0", "user", "old")]);

    // Frontend has completely different IDs (no overlap)
    const frontend = [
      msg("new0", "user", "new question"),
      msg("new1", "assistant", "answer"),
    ];

    const merged = await mergeAndPersistMessages(SID, frontend);

    expect(merged).toEqual(frontend);
    const dbAfter = await loadAllAgentMessages(SID);
    expect(dbAfter.map((m) => m.id)).toEqual(["new0", "new1"]);
  });
});

/* ------------------------------------------------------------------ */
/* summarizeConversation — deleteSummarized                           */
/* ------------------------------------------------------------------ */

describe("summarizeConversation — deleteSummarized", () => {
  const SID = "sess-compact";

  beforeEach(() => {
    vi.mocked(generateText).mockResolvedValue({
      text: "压缩后的摘要",
    } as any);
  });

  it("deleteSummarized=true: 删除旧消息并重编号 position", async () => {
    // 10 messages, keepRecent=4 → cutoff=6 → delete positions 0-5, keep 6-9
    const all = Array.from({ length: 10 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`)
    );
    seedMessages(SID, all);

    await summarizeConversation({
      model: fakeModel,
      sessionId: SID,
      summary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      keepRecent: 4,
      deleteSummarized: true,
    });

    const after = await loadAllAgentMessages(SID);
    // Only 4 messages remain
    expect(after).toHaveLength(4);
    expect(after.map((m) => m.id)).toEqual(["m6", "m7", "m8", "m9"]);
    // Positions in DB renumbered from 0 (check raw store since UIMessage omits position)
    const rawRows = messageStore.get(SID)!.sort((a, b) => a.position - b.position);
    expect(rawRows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it("deleteSummarized=false (默认): 不删消息", async () => {
    const all = Array.from({ length: 10 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `msg ${i}`)
    );
    seedMessages(SID, all);

    await summarizeConversation({
      model: fakeModel,
      sessionId: SID,
      summary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      keepRecent: 4,
    });

    const after = await loadAllAgentMessages(SID);
    expect(after).toHaveLength(10);
  });

  it("无新历史可压缩 → summarizedCount=0，不调用 generateText", async () => {
    const all = Array.from({ length: 3 }, (_, i) =>
      msg(`m${i}`, "user", `msg ${i}`)
    );
    seedMessages(SID, all);

    const result = await summarizeConversation({
      model: fakeModel,
      sessionId: SID,
      summary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      keepRecent: 4,
      deleteSummarized: true,
    });

    expect(result.summarizedCount).toBe(0);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* prepareAgentContext — estimatedTokens reflects retained            */
/* ------------------------------------------------------------------ */

describe("prepareAgentContext — estimatedTokens", () => {
  const SID = "sess-context";

  beforeEach(() => {
    vi.mocked(generateText).mockResolvedValue({
      text: "对话摘要",
    } as any);
  });

  it("压缩后 estimatedTokens 基于 retained 而非全量消息", async () => {
    // 30 messages: first 22 are very long (would inflate full-conversation tokens),
    // last 8 (RECENT_MESSAGE_COUNT) are short.
    const longText = "x".repeat(500);
    const all: UIMessage[] = Array.from({ length: 30 }, (_, i) =>
      msg(
        `m${i}`,
        i % 2 === 0 ? "user" : "assistant",
        i < 22 ? longText : `short ${i}`
      )
    );
    seedMessages(SID, all);

    const articleText = "文章正文";
    const result = await prepareAgentContext({
      model: fakeModel,
      sessionId: SID,
      sessionSummary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      articleText,
      contextBudgetTokens: 50000,
    });

    expect(result.compressed).toBe(true);
    expect(result.retainedMessages).toBe(8);

    // Manual computation: articleTokens + summaryTokens + retained(last 8)Tokens
    const articleTokens = estimateTokens(articleText);
    const summaryTokens = estimateTokens("对话摘要");
    const retainedTokens = all
      .slice(-8)
      .reduce((sum, m) => {
        const text = (m.parts ?? [])
          .filter(
            (p): p is { type: "text"; text: string } => p.type === "text"
          )
          .map((p) => p.text)
          .join("\n");
        return sum + estimateTokens(text);
      }, 0);

    expect(result.estimatedTokens).toBe(
      articleTokens + summaryTokens + retainedTokens
    );

    // Crucially, it should NOT include the 22 long messages' tokens
    const fullConversationTokens = all.reduce((sum, m) => {
      const text = (m.parts ?? [])
        .filter(
          (p): p is { type: "text"; text: string } => p.type === "text"
        )
        .map((p) => p.text)
        .join("\n");
      return sum + estimateTokens(text);
    }, 0);
    const wrongEstimate =
      articleTokens + estimateTokens("") + fullConversationTokens;
    expect(result.estimatedTokens).toBeLessThan(wrongEstimate);
  });

  it("未触发压缩时 estimatedTokens 包含全部消息", async () => {
    const all: UIMessage[] = Array.from({ length: 4 }, (_, i) =>
      msg(`m${i}`, i % 2 === 0 ? "user" : "assistant", `short ${i}`)
    );
    seedMessages(SID, all);

    const articleText = "文章";
    const result = await prepareAgentContext({
      model: fakeModel,
      sessionId: SID,
      sessionSummary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      articleText,
      contextBudgetTokens: 50000,
    });

    expect(result.compressed).toBe(false);
    expect(result.retainedMessages).toBe(4);

    const articleTokens = estimateTokens(articleText);
    const summaryTokens = estimateTokens("");
    const allTokens = all.reduce((sum, m) => {
      const text = (m.parts ?? [])
        .filter(
          (p): p is { type: "text"; text: string } => p.type === "text"
        )
        .map((p) => p.text)
        .join("\n");
      return sum + estimateTokens(text);
    }, 0);

    expect(result.estimatedTokens).toBe(articleTokens + summaryTokens + allTokens);
  });
});

/* ------------------------------------------------------------------ */
/* prepareAgentContext — tool-call messages preserved                 */
/* Regression: pruneMessages("before-last-2-messages") used to strip  */
/* all tool-call-only assistant messages, causing multi-round amnesia */
/* ------------------------------------------------------------------ */

describe("prepareAgentContext — 工具调用消息保留", () => {
  const SID = "sess-tool-preserve";

  /** 模拟写作 Agent 的典型对话：每轮 assistant 只含 tool-call part（无文本）。 */
  function toolCallMessage(
    id: string,
    toolName: string,
    input: Record<string, unknown>,
    output: Record<string, unknown>
  ): UIMessage {
    return {
      id,
      role: "assistant",
      parts: [
        {
          type: `tool-${toolName}` as any,
          toolCallId: `tc-${id}`,
          state: "output-available",
          input,
          output,
        } as any,
      ],
    };
  }

  it("轻量工具（explore_project）多轮调用全部保留", async () => {
    const all: UIMessage[] = [
      msg("u1", "user", "帮我分析这个项目"),
      toolCallMessage("a1", "explore_project", { objective: "分析架构" }, { symbols: 10, edges: 5 }),
      msg("u2", "user", "再深入看看入口"),
      toolCallMessage("a2", "explore_project", { objective: "找入口" }, { symbols: 8, edges: 3 }),
      msg("u3", "user", "总结一下你发现了什么"),
    ];
    seedMessages(SID, all);

    const result = await prepareAgentContext({
      model: fakeModel,
      sessionId: SID,
      sessionSummary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      articleText: "文章正文",
      contextBudgetTokens: 50000,
    });

    expect(result.compressed).toBe(false);
    // explore_project 不是重型工具 → 两轮调用都保留
    const exploreCalls = result.messages.filter(
      (m) =>
        "role" in m &&
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some(
          (p: any) => p.type === "tool-call" && p.toolName === "explore_project"
        )
    );
    expect(exploreCalls.length).toBe(2);
  });

  it("重型工具（propose_article_revision）旧调用被裁剪，最新保留", async () => {
    const all: UIMessage[] = [
      msg("u1", "user", "帮我美化这篇文章"),
      toolCallMessage("a1", "propose_article_revision", { markdown: "A".repeat(5000) }, { summary: "完成美化" }),
      msg("u2", "user", "再精简一些"),
      toolCallMessage("a2", "propose_article_revision", { markdown: "B".repeat(5000) }, { summary: "完成精简" }),
      msg("u3", "user", "上面几轮做了什么操作"),
    ];
    seedMessages(SID + "-heavy", all);

    const result = await prepareAgentContext({
      model: fakeModel,
      sessionId: SID + "-heavy",
      sessionSummary: "",
      summaryUpToPosition: -1,
      uiMessages: all,
      articleText: "文章正文",
      contextBudgetTokens: 50000,
    });

    // propose_article_revision 调用：a1（旧）应被裁剪，a2（近）应保留
    const proposeCalls = result.messages.filter(
      (m) =>
        "role" in m &&
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some(
          (p: any) =>
            p.type === "tool-call" &&
            p.toolName === "propose_article_revision"
        )
    );
    // 只有 a2 保留（在最后 2 条消息范围内）
    expect(proposeCalls.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* articleVersionHash — set_article_digest sync correctness           */
/* ------------------------------------------------------------------ */

describe("articleVersionHash — digest 变化影响 hash", () => {
  it("set_article_digest 更新 digest 后 hash 同步变化", () => {
    const base = {
      title: "标题",
      markdown: "正文",
      digest: "旧摘要",
    };
    const oldHash = articleVersionHash(base);
    const newHash = articleVersionHash({
      ...base,
      digest: "新摘要",
    });
    expect(newHash).not.toBe(oldHash);
  });
});
