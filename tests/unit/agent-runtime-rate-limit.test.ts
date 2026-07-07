import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";

/**
 * P1.5 回归锁定：Claude Agent SDK 可能以 result-error 形式承载 429。
 * 这类错误仍要进入整轮重试，同时把失败 attempt 已产生的 usage 累加进最终轮次汇总。
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

describe("runClaudeAgentRuntime rate-limit result retry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("result-error 为限流时仍整轮重试，并累计失败 attempt usage", async () => {
    vi.stubEnv("INKPRESS_RATE_LIMIT_MAX_RETRIES", "1");
    vi.stubEnv("INKPRESS_RATE_LIMIT_RETRY_WAIT_MS", "0");

    const query = vi
      .fn()
      .mockReturnValueOnce(
        streamOf(
          resultMessage({
            subtype: "error_during_execution",
            is_error: true,
            result: "429 Too Many Requests",
            total_cost_usd: 0.01,
            usage: { input_tokens: 100, output_tokens: 10 },
          })
        )
      )
      .mockReturnValueOnce(
        streamOf(
          resultMessage({
            total_cost_usd: 0.02,
            usage: {
              input_tokens: 200,
              output_tokens: 20,
              cache_read_input_tokens: 30,
            },
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
    const writes: unknown[] = [];
    const outcome = await runClaudeAgentRuntime(
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

    expect(query).toHaveBeenCalledTimes(2);
    expect(writes).toContainEqual(
      expect.objectContaining({ type: "data-agent-retry" })
    );
    expect(outcome.usageSummary).toMatchObject({
      status: "completed",
      source: "sdk-result",
      inputTokens: 300,
      outputTokens: 30,
      cacheReadInputTokens: 30,
      totalTokens: 360,
      costUsd: 0.03,
    });
    expect(outcome.usage).toMatchObject({
      inputTokens: 300,
      outputTokens: 30,
      totalTokens: 330,
    });
  });
});
