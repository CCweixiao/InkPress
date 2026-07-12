import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

/**
 * 回归锁定：Claude Agent SDK 可能以 result-error 形式承载 429。
 * 这类错误不能整轮重试，因为重新调用 query() 会 replay 用户整轮输入。
 * SDK 自身 api_retry 事件仍由 adapter 透传；这里仅禁止 runtime 外层 whole-turn replay。
 */

function resultMessage(overrides: Record<string, unknown>) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "sdk-session-1",
    usage: {},
    ...overrides,
  };
}

async function* streamOf(...messages: unknown[]) {
  for (const message of messages) yield message;
}

describe("runClaudeAgentRuntime rate-limit handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("result-error 为限流时不整轮重试，query 只调用一次并携带失败 usage", async () => {
    vi.stubEnv("INKPRESS_RATE_LIMIT_MAX_RETRIES", "1");
    vi.stubEnv("INKPRESS_RATE_LIMIT_RETRY_WAIT_MS", "0");

    const query = vi
      .fn()
      .mockReturnValue(
        streamOf(
          resultMessage({
            subtype: "error_during_execution",
            is_error: true,
            result: "429 Too Many Requests",
            total_cost_usd: 0.01,
            usage: { input_tokens: 100, output_tokens: 10 },
          })
        )
      );

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));

    const { runClaudeAgentRuntime } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    const { readUsageFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    const writes: unknown[] = [];
    let thrown: unknown;
    try {
      await runClaudeAgentRuntime(
        {
          target: {
            kind: "article",
            id: "article-1",
            title: "Article",
            markdown: "Body",
          },
          sessionId: "session-1",
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            } as UIMessage,
          ],
        },
        { write: (part) => writes.push(part) as never }
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/429 Too Many Requests/);
    expect(query).toHaveBeenCalledTimes(1);
    expect(writes).not.toContainEqual(
      expect.objectContaining({ type: "data-agent-retry" })
    );
    expect(readUsageFromError(thrown)).toMatchObject({
      status: "error",
      source: "sdk-result",
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      costUsd: 0.01,
    });
  });

  it("thrown 429 不整轮重试，query 只调用一次", async () => {
    const query = vi.fn(async function* () {
      throw new Error("rate_limit_error: 429");
    });

    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));

    const { runClaudeAgentRuntime } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    await expect(
      runClaudeAgentRuntime(
        {
          target: {
            kind: "article",
            id: "article-1",
            title: "Article",
            markdown: "Body",
          },
          sessionId: "session-1",
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [{ type: "text", text: "hello" }],
            } as UIMessage,
          ],
        },
        { write: vi.fn() }
      )
    ).rejects.toThrow(/429/);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it("无 assistant 活动的网络错误退避后重试一次", async () => {
    vi.stubEnv("INKPRESS_NETWORK_RETRY_WAIT_MS", "0");
    const query = vi
      .fn()
      .mockImplementationOnce(async function* () {
        throw new TypeError("fetch failed");
      })
      .mockReturnValueOnce(streamOf(resultMessage({ result: "已恢复", usage: {} })));
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));
    const { runClaudeAgentRuntime } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    const writes: unknown[] = [];

    await expect(
      runClaudeAgentRuntime(
        {
          target: { kind: "article", id: "article-1", title: "Article", markdown: "Body" },
          sessionId: "session-1",
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] } as UIMessage],
        },
        { write: (part) => writes.push(part) as never }
      )
    ).resolves.toMatchObject({});

    expect(query).toHaveBeenCalledTimes(2);
    expect(writes).toContainEqual(expect.objectContaining({ type: "data-agent-retry" }));
  });

  it("无 assistant 活动的 Undici socket 错误也会重试一次", async () => {
    vi.stubEnv("INKPRESS_NETWORK_RETRY_WAIT_MS", "0");
    const error = new TypeError("terminated") as TypeError & {
      code: string;
      cause: Error & { code: string };
    };
    error.code = "UND_ERR_SOCKET";
    error.cause = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const query = vi
      .fn()
      .mockImplementationOnce(async function* () {
        throw error;
      })
      .mockReturnValueOnce(streamOf(resultMessage({ result: "已恢复", usage: {} })));
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));
    const { runClaudeAgentRuntime } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    const writes: unknown[] = [];

    await expect(
      runClaudeAgentRuntime(
        {
          target: { kind: "article", id: "article-1", title: "Article", markdown: "Body" },
          sessionId: "session-1",
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] } as UIMessage],
        },
        { write: (part) => writes.push(part) as never }
      )
    ).resolves.toMatchObject({});

    expect(query).toHaveBeenCalledTimes(2);
    expect(writes).toContainEqual(expect.objectContaining({ type: "data-agent-retry" }));
  });

  it("连续网络错误最多自动重试 10 次", async () => {
    vi.stubEnv("INKPRESS_NETWORK_RETRY_WAIT_MS", "0");
    const query = vi.fn(async function* () {
      throw new TypeError("fetch failed");
    });
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));
    const { runClaudeAgentRuntime } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    const writes: unknown[] = [];

    await expect(
      runClaudeAgentRuntime(
        {
          target: { kind: "article", id: "article-1", title: "Article", markdown: "Body" },
          sessionId: "session-1",
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] } as UIMessage],
        },
        { write: (part) => writes.push(part) as never }
      )
    ).rejects.toThrow(/fetch failed/);

    expect(query).toHaveBeenCalledTimes(11);
    expect(
      writes.filter(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "data-agent-retry"
      )
    ).toHaveLength(10);
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: "data-agent-retry",
        data: expect.objectContaining({ attempt: 10, maxRetries: 10 }),
      })
    );
  });

  it("已有 assistant 输出后网络错误不重放整轮", async () => {
    vi.stubEnv("INKPRESS_NETWORK_RETRY_WAIT_MS", "0");
    const query = vi.fn(async function* () {
      yield {
        type: "stream_event",
        uuid: "assistant-1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "开始" } },
      };
      throw new TypeError("fetch failed");
    });
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));
    const { runClaudeAgentRuntime } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );

    await expect(
      runClaudeAgentRuntime(
        {
          target: { kind: "article", id: "article-1", title: "Article", markdown: "Body" },
          sessionId: "session-1",
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] } as UIMessage],
        },
        { write: vi.fn() }
      )
    ).rejects.toThrow(/fetch failed/);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
