import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { UIMessage } from "ai";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createSdkToUiAdapter } from "../../src/lib/ai/agent-sdk-stream-adapter";

/**
 * Claude Agent SDK session 管理 PDC（docs/claude-agent-session-pdc.md）P0 单测。
 *
 * 核心保护：中断后输入「继续」不失忆 ——
 * - adapter 尽早从 system/init 捕获 session id（§2.3/§7.1）；
 * - runtime 在 abort/throw 上挂 sessionId（§7.2）；
 * - route catch 持久化 claudeAgentSessionId（§7.3，源码契约）；
 * - buildClaudeAgentOptions 用 resume、绝不用 continue:true（§7.6，源码契约）。
 */

async function* streamOf(...messages: unknown[]) {
  for (const message of messages) yield message;
}

describe("adapter 尽早捕获 system/init.session_id", () => {
  it("收到 system/init 即把 session_id 写入 result.sessionId", () => {
    const adapter = createSdkToUiAdapter({ write: () => undefined });
    adapter.consume({
      type: "system",
      subtype: "init",
      session_id: "sdk-init-session",
      tools: [],
      mcp_servers: [],
      model: "claude-sonnet-4-5",
    } as unknown as SDKMessage);
    // 这是 P0 的关键：即便没有任何 result，sessionId 也已可被 runtime 读走。
    expect(adapter.result.sessionId).toBe("sdk-init-session");
  });

  it("result.session_id 随后覆盖为权威值", () => {
    const adapter = createSdkToUiAdapter({ write: () => undefined });
    adapter.consume({
      type: "system",
      subtype: "init",
      session_id: "sdk-init-session",
      tools: [],
      mcp_servers: [],
      model: "m",
    } as unknown as SDKMessage);
    adapter.consume({
      type: "result",
      subtype: "success",
      is_error: false,
      session_id: "sdk-result-session",
      usage: {},
    } as unknown as SDKMessage);
    expect(adapter.result.sessionId).toBe("sdk-result-session");
  });

  it("缺 session_id 的 init 不污染 result.sessionId", () => {
    const adapter = createSdkToUiAdapter({ write: () => undefined });
    adapter.consume({
      type: "system",
      subtype: "init",
      tools: [],
      mcp_servers: [],
      model: "m",
    } as unknown as SDKMessage);
    expect(adapter.result.sessionId).toBeUndefined();
  });
});

describe("readSessionFromError", () => {
  it("从挂载了 sessionId 的 runtime 错误上读回 session id", async () => {
    const { readSessionFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    const err = new Error("boom") as Error & { sessionId?: string };
    err.sessionId = "sdk-recoverable";
    expect(readSessionFromError(err)).toBe("sdk-recoverable");
  });

  it("普通错误（无挂载）/ 空字符串 → undefined", async () => {
    const { readSessionFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );
    expect(readSessionFromError(new Error("plain"))).toBeUndefined();
    const empty = new Error("x") as Error & { sessionId?: string };
    empty.sessionId = "";
    expect(readSessionFromError(empty)).toBeUndefined();
    expect(readSessionFromError(null)).toBeUndefined();
    expect(readSessionFromError("string")).toBeUndefined();
  });
});

describe("abort before result：runtime 错误仍带 sessionId（PDC §5.2/§10.2）", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("仅收到 system/init 后即 abort，error 上可读到 session id", async () => {
    // 模拟 SDK 流：先发 init（带 session_id），随后抛 AbortError（用户停止/断连/刷新）。
    const query = vi.fn().mockReturnValueOnce(
      (async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sdk-aborted-session",
          tools: [],
          mcp_servers: [],
          model: "m",
        };
        throw new DOMException("aborted", "AbortError");
      })()
    );
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));

    const { runClaudeAgentRuntime, readSessionFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );

    let caught: unknown = undefined;
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
              parts: [{ type: "text", text: "继续" }],
            } as UIMessage,
          ],
        },
        { write: () => undefined }
      );
    } catch (error) {
      caught = error;
    }
    // 中断本就该上抛，关键是 error 上仍携带 session id 供 route 落库 → 下一轮 resume。
    expect(caught).toBeInstanceOf(Error);
    expect(readSessionFromError(caught)).toBe("sdk-aborted-session");
  });

  it("error result（非中断）也带 session id，便于下一轮 resume（PDC §5.3）", async () => {
    const query = vi.fn().mockReturnValueOnce(
      streamOf({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        session_id: "sdk-error-session",
        result: "工具执行失败",
        usage: { input_tokens: 50, output_tokens: 5 },
        total_cost_usd: 0.001,
      })
    );
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));

    const { runClaudeAgentRuntime, readSessionFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );

    let caught: unknown = undefined;
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
              parts: [{ type: "text", text: "写一段" }],
            } as UIMessage,
          ],
        },
        { write: () => undefined }
      );
    } catch (error) {
      caught = error;
    }
    expect(readSessionFromError(caught)).toBe("sdk-error-session");
  });

  it("SDK stream after abort ends without result: rejects as timeout and keeps partial session", async () => {
    const controller = new AbortController();
    const query = vi.fn().mockReturnValueOnce(
      (async function* () {
        yield {
          type: "system",
          subtype: "init",
          session_id: "sdk-timeout-session",
          tools: [],
          mcp_servers: [],
          model: "m",
        };
        controller.abort();
      })()
    );
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));

    const { runClaudeAgentRuntime, readSessionFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );

    let caught: unknown;
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
          abortSignal: controller.signal,
          messages: [
            {
              id: "u1",
              role: "user",
              parts: [{ type: "text", text: "继续" }],
            } as UIMessage,
          ],
        },
        { write: () => undefined }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ name: "AbortError", code: "timeout" });
    expect(readSessionFromError(caught)).toBe("sdk-timeout-session");
  });

  it("SDK stream that ends without result and without abort is a missing-result error", async () => {
    const query = vi.fn().mockReturnValueOnce(
      streamOf({
        type: "system",
        subtype: "init",
        session_id: "sdk-missing-result-session",
        tools: [],
        mcp_servers: [],
        model: "m",
      })
    );
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({ query }));
    vi.doMock("@/lib/ai/claude-agent-options", () => ({
      buildClaudeAgentOptions: vi.fn().mockResolvedValue({}),
    }));

    const { runClaudeAgentRuntime, readSessionFromError } = await import(
      "../../src/lib/ai/claude-agent-runtime"
    );

    let caught: unknown;
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
              parts: [{ type: "text", text: "继续" }],
            } as UIMessage,
          ],
        },
        { write: () => undefined }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ code: "missing-result" });
    expect(readSessionFromError(caught)).toBe("sdk-missing-result-session");
  });
});

describe("resume 契约（PDC §7.6 / 重点目标 #5/#6）", () => {
  // buildClaudeAgentOptions 依赖众多 DB/fs 模块，行为契约用源码静态断言锁定最稳：
  // 有 claudeAgentSessionId → 传 resume；任何情况下都不出现 continue:true
  // （continue 会串用 cwd 下最近 session，违背多文章/多文档多会话隔离）。
  const optionsFile = fs.readFileSync(
    path.resolve(__dirname, "../../src/lib/ai/claude-agent-options.ts"),
    "utf8"
  );

  it("有 claudeAgentSessionId 时传 resume（条件展开）", () => {
    expect(optionsFile).toMatch(/resume:\s*input\.claudeAgentSessionId/);
  });

  it("绝不使用 continue:true（避免跨文章/文档串会话）", () => {
    expect(optionsFile).not.toMatch(/continue\s*:\s*true/);
  });
});

describe("route catch 持久化 sessionId（PDC §7.3，源码契约）", () => {
  // route 的 success 路径早已保存 claudeAgentSessionId；P0 补的是 catch 三路也保存。
  // 静态断言锁定：catch 分支会读 readSessionFromError 并 update 会话行。
  const chatRoute = fs.readFileSync(
    path.resolve(__dirname, "../../src/app/api/ai/chat/route.ts"),
    "utf8"
  );

  it("导入 readSessionFromError 并在 catch 分支调用", () => {
    expect(chatRoute).toMatch(/readSessionFromError/);
  });

  it("catch 分支：拿到 sdkSessionId 后 update AgentChatSession.claudeAgentSessionId", () => {
    expect(chatRoute).toMatch(/claudeAgentSessionId:\s*sdkSessionId/);
    expect(chatRoute).toMatch(/claudeAgentSessionStatus:\s*isAbortError/);
  });

  it("catch 分支：即使 sdkSessionId 与旧值相同，也会收口状态而非停留 running", () => {
    expect(chatRoute).not.toMatch(
      /sdkSessionId\s*&&\s*sdkSessionId\s*!==\s*session\.claudeAgentSessionId/
    );
  });

  it("成功分支：保存 session 状态不依赖 outcome.usage 存在", () => {
    expect(chatRoute).toMatch(/const completedSessionId/);
    expect(chatRoute).toMatch(/成功结束时无论 SDK 是否返回 usage/);
  });
});
