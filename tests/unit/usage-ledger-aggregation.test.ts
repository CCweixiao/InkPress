import { describe, expect, it } from "vitest";
import {
  aggregateUsageRows,
  computeStreak,
  resolveRange,
  type UsageAggRow,
} from "../../src/lib/ai/usage-ledger";

/**
 * P1.5 大盘聚合纯函数单测（PDC §12.9 口径）。
 * 不触库：aggregateUsageRows / computeStreak / resolveRange 均为纯函数。
 */

function row(overrides: Partial<UsageAggRow> = {}): UsageAggRow {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalTokens: 150,
    costUsd: 0.01,
    status: "completed",
    source: "sdk-result",
    sessionId: "sess-1",
    startedAt: new Date("2026-07-01T10:00:00"),
    ...overrides,
  };
}

describe("aggregateUsageRows（大盘聚合口径）", () => {
  it("汇总 token/cost、峰值、平均、会话数", () => {
    const s = aggregateUsageRows([
      row({ totalTokens: 150, costUsd: 0.01, sessionId: "a" }),
      row({ totalTokens: 300, costUsd: 0.02, sessionId: "b" }),
    ]);
    expect(s.turnCount).toBe(2);
    expect(s.totalTokens).toBe(450);
    expect(s.totalCostUsd).toBeCloseTo(0.03, 5);
    expect(s.peakTurnTokens).toBe(300);
    expect(s.avgTurnTokens).toBe(225);
    expect(s.sessionCount).toBe(2);
  });

  it("cache 命中占比 = cacheRead / totalTokens", () => {
    const s = aggregateUsageRows([
      row({ cacheReadInputTokens: 300, totalTokens: 600 }),
      row({ cacheReadInputTokens: 100, totalTokens: 400 }),
    ]);
    // cacheRead 400 / totalTokens 1000 = 0.4
    expect(s.cacheHitRatio).toBeCloseTo(0.4, 2);
  });

  it("中断估算（step-fallback）与错误完成分别计数，且参与累计（模拟 /clear 未清统计）", () => {
    // 关键不变量：partial / error 轮次不会被剔除，仍计入累计——
    // 即 token 大盘累计值不因 /clear 或失败轮次而丢失（PDC §12.2/§12.6）。
    const s = aggregateUsageRows([
      row({ source: "sdk-result", status: "completed", totalTokens: 200 }),
      row({ source: "step-fallback", status: "partial", totalTokens: 100 }),
      row({ source: "sdk-result", status: "error", totalTokens: 50 }),
    ]);
    expect(s.turnCount).toBe(3);
    expect(s.totalTokens).toBe(350); // 三类全部累计
    expect(s.partialTurnCount).toBe(1);
    expect(s.errorTurnCount).toBe(1);
  });

  it("空列表 → 零值聚合（不抛错）", () => {
    const s = aggregateUsageRows([]);
    expect(s.turnCount).toBe(0);
    expect(s.totalTokens).toBe(0);
    expect(s.cacheHitRatio).toBe(0);
    expect(s.streakDays).toBe(0);
  });
});

describe("computeStreak（连续使用天数）", () => {
  const dayKey = (offset: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  };

  it("今天与昨天都有 → 连续 2 天", () => {
    expect(computeStreak(new Set([dayKey(0), dayKey(1)]))).toBe(2);
  });

  it("只有昨天有（今天还没用）→ 从昨天起算 1 天", () => {
    expect(computeStreak(new Set([dayKey(1)]))).toBe(1);
  });

  it("今天有但昨天没有 → 1 天", () => {
    expect(computeStreak(new Set([dayKey(0)]))).toBe(1);
  });

  it("连续 3 天后断一天 → 3 天", () => {
    expect(
      computeStreak(new Set([dayKey(0), dayKey(1), dayKey(2)]))
    ).toBe(3);
  });

  it("空集合 → 0", () => {
    expect(computeStreak(new Set())).toBe(0);
  });
});

describe("resolveRange（时间筛选预设）", () => {
  it("7d → from 在 7 天前、to 为现在", () => {
    const now = new Date();
    const r = resolveRange("7d");
    expect(r.from).toBeDefined();
    expect(r.to).toBeDefined();
    const diffDays =
      (now.getTime() - r.from!.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });

  it("显式 from/to 优先于预设", () => {
    const r = resolveRange(null, "2026-01-01", "2026-01-31");
    expect(r.from).toEqual(new Date("2026-01-01"));
    expect(r.to).toEqual(new Date("2026-01-31"));
  });

  it("无参数 → 空区间（全部）", () => {
    expect(resolveRange(null)).toEqual({});
  });
});
