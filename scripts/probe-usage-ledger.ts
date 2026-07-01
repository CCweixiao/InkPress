// P1.5 探测：AgentUsageTurn 建表 + ledger 读写 + 大盘聚合全链路。
//
// 不启动 app、不依赖 chat 流：直接对 dev.db 跑迁移建表 → seed 样本 → 调聚合 → 清理。
//   DATABASE_URL=file:./dev.db pnpm tsx scripts/probe-usage-ledger.ts
//
// 幂等：runMigrations 跳过已应用版本；seed 用专属 sessionId，结束清理不污染真实数据。
import { runMigrations } from "../src/lib/migration";
import { dbPath, migrationsDir } from "../src/lib/paths";
import { prisma } from "../src/lib/db";
import type { AgentTurnUsageSummary } from "../src/lib/ai/agent-sdk-stream-adapter";
import {
  upsertUsageTurn,
  summarizeUsage,
  timeseriesUsage,
  heatmapUsage,
  listUsageTurns,
  usageInsights,
} from "../src/lib/ai/usage-ledger";

const PROBE_SESSION = "probe-usage-test-session";
const TARGET_ARTICLE = "probe-target-article";

function summary(over: Partial<AgentTurnUsageSummary>): AgentTurnUsageSummary {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalTokens: 150,
    costUsd: 0.01,
    modelUsage: {},
    status: "completed",
    source: "sdk-result",
    ...over,
  };
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

async function main() {
  // 0. 建表（幂等）：对 dev.db 应用所有 pending 迁移，含 20260708020000_agent_usage_turn。
  console.log("[0] dbPath =", dbPath());
  await runMigrations(dbPath(), migrationsDir());

  const cols = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT name FROM pragma_table_info('AgentUsageTurn')`;
  console.log(
    "[1] AgentUsageTurn 列数 =",
    cols.length,
    cols.length > 0 ? "✅ 已建表" : "❌ 未建表"
  );
  if (cols.length === 0) {
    console.error("[probe] 表未建成，中止。");
    process.exit(1);
  }

  // 1. 清掉上一次探测残留（幂等）
  const pre = await prisma.agentUsageTurn.deleteMany({
    where: { sessionId: PROBE_SESSION },
  });
  if (pre.count > 0) console.log("[2] 清理上次探测残留", pre.count, "行");

  // 2. seed 5 条覆盖：completed×2 模型 / error / partial(step-fallback) / 跨天跨目标
  //    upsertUsageTurn 按应用级 turnId 写；startedAt 显式传入以拉开时间分布。
  const seed: Array<{
    turnId: string;
    modelId: string;
    startedAt: Date;
    targetKind: "article" | "technical-document";
    targetId: string;
    s: AgentTurnUsageSummary;
  }> = [
    {
      turnId: "probe-turn-1",
      modelId: "claude-sonnet-4-5",
      startedAt: daysAgo(0),
      targetKind: "article",
      targetId: TARGET_ARTICLE,
      s: summary({ inputTokens: 200, outputTokens: 120, cacheReadInputTokens: 400, totalTokens: 720, costUsd: 0.04 }),
    },
    {
      turnId: "probe-turn-2",
      modelId: "glm-4.6",
      startedAt: daysAgo(0),
      targetKind: "article",
      targetId: TARGET_ARTICLE,
      s: summary({ inputTokens: 80, outputTokens: 40, totalTokens: 120, costUsd: 0.005 }),
    },
    {
      turnId: "probe-turn-3",
      modelId: "claude-sonnet-4-5",
      startedAt: daysAgo(1),
      targetKind: "article",
      targetId: TARGET_ARTICLE,
      s: summary({ status: "error", inputTokens: 300, outputTokens: 10, totalTokens: 310, costUsd: 0.02 }),
    },
    {
      turnId: "probe-turn-4",
      modelId: "glm-4.6",
      startedAt: daysAgo(2),
      targetKind: "technical-document",
      targetId: "probe-target-doc",
      s: summary({ status: "partial", source: "step-fallback", inputTokens: 90, outputTokens: 30, totalTokens: 120, costUsd: 0 }),
    },
    {
      turnId: "probe-turn-5",
      modelId: "claude-sonnet-4-5",
      startedAt: daysAgo(5),
      targetKind: "article",
      targetId: TARGET_ARTICLE,
      s: summary({ inputTokens: 150, outputTokens: 60, totalTokens: 210, costUsd: 0.015 }),
    },
  ];

  for (const row of seed) {
    await upsertUsageTurn(
      {
        sessionId: PROBE_SESSION,
        turnId: row.turnId,
        targetKind: row.targetKind,
        targetId: row.targetId,
        providerId: null,
        modelId: row.modelId,
        sdkSessionId: null,
        startedAt: row.startedAt,
      },
      row.s
    );
  }
  // upsertUsageTurn 对 total=0&cost=0 会跳过；这里所有 seed 都非零，应写 5 行。
  const written = await prisma.agentUsageTurn.count({
    where: { sessionId: PROBE_SESSION },
  });
  console.log("[3] seed 写入", written, "行（期望 5）", written === 5 ? "✅" : "❌");

  // 3. upsert 幂等：同 (sessionId, turnId) 再写一次应覆盖不新增。
  await upsertUsageTurn(
    {
      sessionId: PROBE_SESSION,
      turnId: "probe-turn-1",
      targetKind: "article",
      targetId: TARGET_ARTICLE,
      modelId: "claude-sonnet-4-5",
      startedAt: daysAgo(0),
    },
    summary({ inputTokens: 999, outputTokens: 1, cacheReadInputTokens: 0, totalTokens: 1000, costUsd: 0.09 })
  );
  const afterUpsert = await prisma.agentUsageTurn.count({
    where: { sessionId: PROBE_SESSION },
  });
  const row1 = await prisma.agentUsageTurn.findUnique({
    where: { sessionId_turnId: { sessionId: PROBE_SESSION, turnId: "probe-turn-1" } },
  });
  console.log(
    "[4] upsert 幂等：行数仍",
    afterUpsert,
    "（期望 5），turn-1 totalTokens=",
    row1?.totalTokens,
    "（期望 1000）",
    afterUpsert === 5 && row1?.totalTokens === 1000 ? "✅" : "❌"
  );

  // 4. KPI 聚合（全部区间，含本 probe session）
  const summaryAll = await summarizeUsage({});
  console.log(
    "[5] summarizeUsage 全部：turnCount=",
    summaryAll.turnCount,
    "sessionCount=",
    summaryAll.sessionCount,
    "peakTurnTokens=",
    summaryAll.peakTurnTokens,
    "cacheHitRatio=",
    summaryAll.cacheHitRatio.toFixed(3),
    "partial=",
    summaryAll.partialTurnCount,
    "error=",
    summaryAll.errorTurnCount,
    "streakDays=",
    summaryAll.streakDays
  );

  // 5. 近 7 天时序（按模型分组，day bucket）
  const ts = await timeseriesUsage(
    { from: daysAgo(7), to: new Date() },
    "day",
    "model"
  );
  console.log(
    "[6] timeseries(7d, day, model) 点数 =",
    ts.length,
    "｜样例：",
    ts
      .slice(0, 3)
      .map((p) => `${p.bucket}[${p.groupKey}]=${p.totalTokens}`)
      .join("  ")
  );

  // 6. 热力图
  const hm = await heatmapUsage({ from: daysAgo(7), to: new Date() });
  console.log(
    "[7] heatmap(7d) 天数 =",
    hm.length,
    "｜",
    hm.map((c) => `${c.day}=${c.totalTokens}`).join("  ")
  );

  // 7. 明细分页 + status 过滤
  const turnsErr = await listUsageTurns({
    range: { from: daysAgo(7), to: new Date() },
    status: "error",
    limit: 10,
  });
  console.log(
    "[8] listUsageTurns(status=error) =",
    turnsErr.turns.length,
    "行（本 probe 应含 1 行 error）"
  );

  // 8. 洞察
  const ins = await usageInsights({ from: daysAgo(7), to: new Date() });
  console.log(
    "[9] insights：topModel=",
    ins.topModel?.modelId,
    "｜topTargets 数 =",
    ins.topTargets.length,
    "｜costliest 近期 =",
    ins.costliestRecentTurns.length
  );

  // 9. 清理本 probe 数据（不污染 dev.db）
  const cleanup = await prisma.agentUsageTurn.deleteMany({
    where: { sessionId: PROBE_SESSION },
  });
  console.log("[10] 清理 probe 数据", cleanup.count, "行 ✅");

  console.log(
    "\n注意：clearUsage()（清空全部统计）未在此探测调用——它是危险操作，" +
      "请经 DELETE /api/ai/usage（body {confirm:\"CLEAR_USAGE\"}）验证。"
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[probe] 失败：", e);
  process.exit(1);
});
