import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createSdkToUiAdapter } from "../../src/lib/ai/agent-sdk-stream-adapter";

/**
 * P1.5 usage collector 单测（PDC §12.4）。
 * 覆盖：正常 result、错误 result、中断 step fallback、assistant messageId 去重。
 * 不触库，仅断言 adapter.getSummary() 的内存汇总。
 */

function makeAdapter() {
  const parts: Array<Record<string, unknown>> = [];
  const adapter = createSdkToUiAdapter({
    write: (part) => parts.push(part as unknown as Record<string, unknown>),
  });
  return { adapter, parts };
}

const assistant = (messageId: string, usage: Record<string, number>): SDKMessage =>
  ({
    type: "assistant",
    message: { id: messageId, content: [{ type: "text", text: "hi" }], usage },
  }) as unknown as SDKMessage;

const result = (overrides: Partial<Record<string, unknown>> = {}): SDKMessage =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "s1",
    usage: {},
    ...overrides,
  }) as unknown as SDKMessage;

describe("createSdkToUiAdapter usage collector", () => {
  it("正常 result → summary 为 sdk-result / completed，含 cache 与 cost", () => {
    const { adapter } = makeAdapter();
    adapter.consume(
      result({
        total_cost_usd: 0.03,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 10,
        },
        modelUsage: [{ model: "claude-sonnet-4-5", input_tokens: 100 }],
      })
    );
    const summary = adapter.getSummary();
    expect(summary).toBeDefined();
    expect(summary!.source).toBe("sdk-result");
    expect(summary!.status).toBe("completed");
    expect(summary!.inputTokens).toBe(100);
    expect(summary!.outputTokens).toBe(50);
    expect(summary!.cacheReadInputTokens).toBe(200);
    expect(summary!.cacheCreationInputTokens).toBe(10);
    expect(summary!.totalTokens).toBe(360);
    expect(summary!.costUsd).toBe(0.03);
    expect(summary!.modelUsage).toMatchObject([{ model: "claude-sonnet-4-5" }]);
  });

  it("错误 result → 仍产出 summary（status=error, source=sdk-result）", () => {
    const { adapter } = makeAdapter();
    adapter.consume(
      result({
        subtype: "error_max_duration",
        is_error: true,
        total_cost_usd: 0.12,
        usage: { input_tokens: 500, output_tokens: 20 },
        errors: ["超时"],
      })
    );
    const summary = adapter.getSummary();
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("error");
    expect(summary!.source).toBe("sdk-result");
    expect(summary!.inputTokens).toBe(500);
    expect(summary!.costUsd).toBe(0.12);
    expect(adapter.result.isError).toBe(true);
  });

  it("无 result、仅有 assistant step → step fallback（status=partial, source=step-fallback）", () => {
    const { adapter } = makeAdapter();
    adapter.consume(assistant("msg-1", { input_tokens: 80, output_tokens: 30 }));
    adapter.consume(assistant("msg-2", { input_tokens: 20, output_tokens: 10 }));
    adapter.flush();
    const summary = adapter.getSummary();
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("partial");
    expect(summary!.source).toBe("step-fallback");
    // 累加两条不同 messageId 的 step。
    expect(summary!.inputTokens).toBe(100);
    expect(summary!.outputTokens).toBe(40);
  });

  it("同一 messageId 的并行工具 assistant 消息不重复计数（去重，取最大）", () => {
    const { adapter } = makeAdapter();
    // 并行工具调用：同一 messageId 出现两次，output 不同 → 只计一次并取最大。
    adapter.consume(assistant("dup-1", { input_tokens: 100, output_tokens: 30 }));
    adapter.consume(assistant("dup-1", { input_tokens: 100, output_tokens: 60 }));
    adapter.flush();
    const summary = adapter.getSummary();
    expect(summary).toBeDefined();
    expect(summary!.inputTokens).toBe(100); // 未翻倍
    expect(summary!.outputTokens).toBe(60); // 取最大
  });

  it("无任何 usage（既无 result 也无 assistant step）→ getSummary 返回 undefined", () => {
    const { adapter } = makeAdapter();
    adapter.flush();
    expect(adapter.getSummary()).toBeUndefined();
  });
});
