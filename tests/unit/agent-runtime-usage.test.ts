import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readUsageFromError } from "../../src/lib/ai/claude-agent-runtime";

/**
 * P1.5 runtime usage 挂载 + /clear 不清统计 的架构级单测。
 */

describe("readUsageFromError", () => {
  it("从挂载了 usageSummary 的错误上读回 summary", () => {
    const err = new Error("boom");
    (err as Error & { usageSummary?: unknown }).usageSummary = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalTokens: 15,
      costUsd: 0.01,
      modelUsage: {},
      status: "error",
      source: "sdk-result",
    };
    const summary = readUsageFromError(err);
    expect(summary).toBeDefined();
    expect(summary!.status).toBe("error");
    expect(summary!.inputTokens).toBe(10);
  });

  it("普通错误（无挂载）→ undefined", () => {
    expect(readUsageFromError(new Error("plain"))).toBeUndefined();
    expect(readUsageFromError(null)).toBeUndefined();
    expect(readUsageFromError("string")).toBeUndefined();
  });
});

describe("/clear 不清统计（架构契约）", () => {
  // PDC §12.6 / 开发约束：/clear 不得删除 AgentUsageTurn；清空 token 统计必须是
  // 设置页独立危险操作（DELETE /api/ai/usage，需 confirm=CLEAR_USAGE）。
  // 这里以源码静态断言锁定契约：chat DELETE 路由绝不触碰 agentUsageTurn 的删除。
  const chatRoute = fs.readFileSync(
    path.resolve(__dirname, "../../src/app/api/ai/chat/route.ts"),
    "utf8"
  );

  it("chat 路由不导入 clearUsage / usage-ledger 的删除能力", () => {
    expect(chatRoute).not.toMatch(/clearUsage/);
  });

  it("chat DELETE（/clear）不删除 AgentUsageTurn 流水", () => {
    // 定位 DELETE handler 内的事务写集合，确保其中无 agentUsageTurn 删除。
    expect(chatRoute).not.toMatch(/agentUsageTurn\.delete/);
    expect(chatRoute).not.toMatch(/prisma\.agentUsageTurn/);
  });

  it("清空统计的唯一入口在 /api/ai/usage 且需显式 confirm token", () => {
    const usageRoute = fs.readFileSync(
      path.resolve(__dirname, "../../src/app/api/ai/usage/route.ts"),
      "utf8"
    );
    expect(usageRoute).toMatch(/CLEAR_USAGE/);
    expect(usageRoute).toMatch(/confirm !== CONFIRM_TOKEN/);
  });
});

describe("聊天 token chip metadata 口径", () => {
  const chatRoute = fs.readFileSync(
    path.resolve(__dirname, "../../src/app/api/ai/chat/route.ts"),
    "utf8"
  );

  it("assistant metadata 使用完整 summary totalTokens，并携带 cache 明细", () => {
    expect(chatRoute).toMatch(/totalTokens: outcome\.usageSummary\?\.totalTokens/);
    expect(chatRoute).toMatch(/cacheReadInputTokens: outcome\.usageSummary\?\.cacheReadInputTokens/);
    expect(chatRoute).toMatch(/cacheCreationInputTokens: outcome\.usageSummary\?\.cacheCreationInputTokens/);
    expect(chatRoute).toMatch(/totalTokens: summary\.totalTokens/);
  });
});
