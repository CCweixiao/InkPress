import { prisma } from "@/lib/db";
import type { AgentTurnUsageSummary } from "@/lib/ai/agent-sdk-stream-adapter";

/**
 * P1.5 Token usage ledger 读写（PDC §12）。
 *
 * AgentUsageTurn 是 token/cost 统计的唯一事实源，独立于 AgentChatMessage 生命周期：
 * - 不持久化 step 级明细；step usage 仅在 adapter 内作中断 fallback（§12.2）。
 * - 按 (sessionId, turnId) upsert：同一用户轮次只写一条汇总（§12.5）。
 * - 聚合口径（§12.9）：totalTokens = input + output + cacheRead + cacheCreation。
 */

export type UsageTurnInput = {
  sessionId: string;
  turnId: string;
  targetKind: string;
  targetId: string;
  providerId?: string | null;
  modelId?: string | null;
  sdkSessionId?: string | null;
  startedAt?: Date;
  metadata?: Record<string, unknown>;
};

type DbClient = Pick<typeof prisma, "agentChatSession" | "agentUsageTurn">;

/**
 * 按 (sessionId, turnId) upsert 一条轮次用量。
 * summary 缺省（无任何 SDK usage）时不写（PDC §12.4：「没有任何 SDK usage，不写统计」）。
 * 同一 turnId 重复写（先 partial 后 completed 的恢复场景）以最新结果覆盖，避免重复计费。
 */
export async function upsertUsageTurn(
  input: UsageTurnInput,
  summary: AgentTurnUsageSummary | undefined
): Promise<void> {
  await upsertUsageTurnWithin(prisma, input, summary);
}

export async function upsertUsageTurnIfSessionGenerationCurrent(
  input: UsageTurnInput,
  summary: AgentTurnUsageSummary | undefined,
  generation: number
): Promise<{ ignored: boolean }> {
  if (!summary) return { ignored: false };
  return prisma.$transaction(async (tx) => {
    const session = await tx.agentChatSession.findUnique({
      where: { id: input.sessionId },
      select: { generation: true },
    });
    if (session?.generation !== generation) return { ignored: true };

    await upsertUsageTurnWithin(tx, input, summary);
    return { ignored: false };
  });
}

async function upsertUsageTurnWithin(
  client: DbClient,
  input: UsageTurnInput,
  summary: AgentTurnUsageSummary | undefined
): Promise<void> {
  if (!summary) return;
  // PDC §12.4：没有任何 SDK usage 不写统计。result 携带空 usage 对象（全零）时不落噪声行。
  if (summary.totalTokens === 0 && summary.costUsd === 0) return;
  const totalTokens =
    summary.inputTokens +
    summary.outputTokens +
    summary.cacheReadInputTokens +
    summary.cacheCreationInputTokens;
  await client.agentUsageTurn.upsert({
    where: {
      sessionId_turnId: { sessionId: input.sessionId, turnId: input.turnId },
    },
    update: {
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheReadInputTokens: summary.cacheReadInputTokens,
      cacheCreationInputTokens: summary.cacheCreationInputTokens,
      totalTokens,
      costUsd: summary.costUsd,
      status: summary.status,
      source: summary.source,
      modelUsageJson: safeStringify(summary.modelUsage),
      ...(input.metadata !== undefined
        ? { metadataJson: safeStringify(input.metadata) }
        : {}),
      ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.sdkSessionId !== undefined ? { sdkSessionId: input.sdkSessionId } : {}),
      finishedAt: new Date(),
    },
    create: {
      sessionId: input.sessionId,
      turnId: input.turnId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      sdkSessionId: input.sdkSessionId ?? null,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheReadInputTokens: summary.cacheReadInputTokens,
      cacheCreationInputTokens: summary.cacheCreationInputTokens,
      totalTokens,
      costUsd: summary.costUsd,
      status: summary.status,
      source: summary.source,
      modelUsageJson: safeStringify(summary.modelUsage),
      metadataJson: safeStringify(input.metadata),
      startedAt: input.startedAt ?? new Date(),
      finishedAt: new Date(),
    },
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 聚合读取（供 /api/ai/usage/* 路由与大盘使用）
// ────────────────────────────────────────────────────────────────────────────

export type UsageRange = { from?: Date; to?: Date };

/** 解析 range 预设为 [from, to]（to 默认现在，from 按 range 反推）。 */
export function resolveRange(range: string | null, from?: string | null, to?: string | null): UsageRange {
  if (from || to) {
    return {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    };
  }
  const now = new Date();
  if (range === "1d") return { from: daysAgo(now, 1), to: now };
  if (range === "7d") return { from: daysAgo(now, 7), to: now };
  if (range === "30d") return { from: daysAgo(now, 30), to: now };
  return {};
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

function whereForRange(range: UsageRange, extra: Record<string, unknown> = {}) {
  const startedAt: Record<string, Date> = {};
  if (range.from) startedAt.gte = range.from;
  if (range.to) startedAt.lte = range.to;
  return { ...(Object.keys(startedAt).length ? { startedAt } : {}), ...extra };
}

export type UsageSummary = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  turnCount: number;
  /** 峰值单轮 totalTokens。 */
  peakTurnTokens: number;
  /** 平均每轮 token。 */
  avgTurnTokens: number;
  /** cache 命中占比 = cacheRead / totalTokens（0~1）。 */
  cacheHitRatio: number;
  /** 中断估算（step-fallback）轮次数。 */
  partialTurnCount: number;
  /** 错误完成轮次数。 */
  errorTurnCount: number;
  /** 会话总数（有用量流水的不重复 sessionId）。 */
  sessionCount: number;
  /** 当前连续使用天数（有非零 token turn 的自然日，向前连续计数）。 */
  streakDays: number;
};

/** 聚合输入行（与 AgentUsageTurn 的相关字段同构，便于纯函数测试）。 */
export type UsageAggRow = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  costUsd: number;
  status: string;
  source: string;
  sessionId: string;
  startedAt: Date;
};

/**
 * 纯函数聚合核心（§12.9 口径）：从轮次行计算 KPI。
 * 抽出为纯函数便于单测大盘聚合，不依赖 prisma。
 */
export function aggregateUsageRows(rows: UsageAggRow[]): UsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  let totalTokens = 0;
  let costUsd = 0;
  let peakTurnTokens = 0;
  let partialTurnCount = 0;
  let errorTurnCount = 0;
  const sessions = new Set<string>();
  const activeDays = new Set<string>();

  for (const row of rows) {
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    cacheRead += row.cacheReadInputTokens;
    cacheCreation += row.cacheCreationInputTokens;
    totalTokens += row.totalTokens;
    costUsd += row.costUsd;
    if (row.totalTokens > peakTurnTokens) peakTurnTokens = row.totalTokens;
    if (row.source === "step-fallback") partialTurnCount += 1;
    if (row.status === "error") errorTurnCount += 1;
    sessions.add(row.sessionId);
    if (row.totalTokens > 0) {
      activeDays.add(toLocalDayKey(row.startedAt));
    }
  }

  const turnCount = rows.length;
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreation,
    totalCostUsd: costUsd,
    turnCount,
    peakTurnTokens,
    avgTurnTokens: turnCount > 0 ? Math.round(totalTokens / turnCount) : 0,
    cacheHitRatio: totalTokens > 0 ? cacheRead / totalTokens : 0,
    partialTurnCount,
    errorTurnCount,
    sessionCount: sessions.size,
    streakDays: computeStreak(activeDays),
  };
}

/** KPI 横条聚合（§12.8 KPI / §12.9 口径）。 */
export async function summarizeUsage(range: UsageRange): Promise<UsageSummary> {
  const where = whereForRange(range);
  const rows = await prisma.agentUsageTurn.findMany({
    where,
    select: {
      inputTokens: true,
      outputTokens: true,
      cacheReadInputTokens: true,
      cacheCreationInputTokens: true,
      totalTokens: true,
      costUsd: true,
      status: true,
      source: true,
      sessionId: true,
      startedAt: true,
    },
  });
  return aggregateUsageRows(rows as UsageAggRow[]);
}

/** 连续使用天数：从今天（或最近一日）向前连续计数有非零 token 的自然日。 */
export function computeStreak(activeDays: Set<string>): number {
  if (activeDays.size === 0) return 0;
  // 从「今天」开始向前找第一个命中日（容忍「今天还没产生」的情况，从最近命中日开始）。
  const today = new Date();
  let streak = 0;
  const cursor = new Date(today);
  cursor.setHours(0, 0, 0, 0);
  // 若今天无记录但昨天有，从昨天起算（避免「今天还没用」显示 0）。
  if (!activeDays.has(toLocalDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!activeDays.has(toLocalDayKey(cursor))) return 0;
  }
  while (activeDays.has(toLocalDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 本地自然日 key（YYYY-MM-DD），避免 UTC 偏移把单日拆到两天。 */
function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type TimeBucket = "hour" | "day" | "week";
export type TimeSeriesGroup = "model" | "target" | "status";

export type TimeSeriesPoint = {
  bucket: string;
  groupKey: string;
  groupLabel?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  costUsd: number;
  turnCount: number;
};

/**
 * 趋势序列（§12.8 主趋势图）。
 * 用 SQLite 的 strftime 按 bucket 分组，再按 groupBy 维度聚合。bucket：hour/day/week。
 */
export async function timeseriesUsage(
  range: UsageRange,
  bucket: TimeBucket,
  groupBy: TimeSeriesGroup
): Promise<TimeSeriesPoint[]> {
  const fmt = bucket === "hour" ? "%Y-%m-%dT%H:00:00" : bucket === "week" ? "%Y-W%W" : "%Y-%m-%d";
  const where = whereForRange(range);
  const rows = await prisma.agentUsageTurn.findMany({
    where,
    select: {
      startedAt: true,
      modelId: true,
      targetKind: true,
      targetId: true,
      status: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadInputTokens: true,
      cacheCreationInputTokens: true,
      totalTokens: true,
      costUsd: true,
    },
  });
  const targetTitles =
    groupBy === "target" ? await loadTargetTitleMap(rows) : new Map<string, string>();
  // 应用层聚合（SQLite strftime 在 Prisma 层不便直接 groupBy，且行数有限）。
  const map = new Map<string, TimeSeriesPoint>();
  for (const row of rows) {
    const b = sqliteStrftime(row.startedAt, fmt);
    const g =
      groupBy === "model"
        ? row.modelId ?? "unknown"
        : groupBy === "target"
          ? `${row.targetKind}:${row.targetId}`
          : row.status;
    const key = `${b}|${g}`;
    let point = map.get(key);
    if (!point) {
      point = {
        bucket: b,
        groupKey: g,
        groupLabel:
          groupBy === "target"
            ? targetTitles.get(g) ?? null
            : null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        turnCount: 0,
      };
      map.set(key, point);
    }
    point.inputTokens += row.inputTokens;
    point.outputTokens += row.outputTokens;
    point.cacheReadInputTokens += row.cacheReadInputTokens;
    point.cacheCreationInputTokens += row.cacheCreationInputTokens;
    point.totalTokens += row.totalTokens;
    point.costUsd += row.costUsd;
    point.turnCount += 1;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
    return a.groupKey < b.groupKey ? -1 : 1;
  });
}

export type HeatmapCell = { day: string; totalTokens: number; turnCount: number; costUsd: number };

/** 活动热力图（§12.8）：按自然日聚合 token 活跃度。 */
export async function heatmapUsage(range: UsageRange): Promise<HeatmapCell[]> {
  const where = whereForRange(range);
  const rows = await prisma.agentUsageTurn.findMany({
    where,
    select: { startedAt: true, totalTokens: true, costUsd: true },
  });
  const map = new Map<string, HeatmapCell>();
  for (const row of rows) {
    const day = toLocalDayKey(row.startedAt);
    let cell = map.get(day);
    if (!cell) {
      cell = { day, totalTokens: 0, turnCount: 0, costUsd: 0 };
      map.set(day, cell);
    }
    cell.totalTokens += row.totalTokens;
    cell.costUsd += row.costUsd;
    cell.turnCount += 1;
  }
  return Array.from(map.values()).sort((a, b) => (a.day < b.day ? -1 : 1));
}

export type UsageInsights = {
  topModel: { modelId: string; totalTokens: number; turnCount: number } | null;
  topTargets: Array<{ targetKind: string; targetId: string; targetTitle: string | null; totalTokens: number; turnCount: number }>;
  costliestRecentTurns: Array<{
    id: string;
    startedAt: Date;
    totalTokens: number;
    costUsd: number;
    modelId: string | null;
    status: string;
    targetKind: string;
    targetId: string;
    targetTitle: string | null;
  }>;
};

async function loadTargetTitleMap(
  targets: Array<{ targetKind: string; targetId: string }>
): Promise<Map<string, string>> {
  const articleIds = Array.from(
    new Set(
      targets
        .filter((t) => t.targetKind === "article")
        .map((t) => t.targetId)
        .filter(Boolean)
    )
  );
  const documentIds = Array.from(
    new Set(
      targets
        .filter((t) => t.targetKind === "technical-document")
        .map((t) => t.targetId)
        .filter(Boolean)
    )
  );
  const [articles, documents] = await Promise.all([
    articleIds.length
      ? prisma.article.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, title: true },
        })
      : [],
    documentIds.length
      ? prisma.technicalDocument.findMany({
          where: { id: { in: documentIds } },
          select: { id: true, title: true },
        })
      : [],
  ]);
  const titles = new Map<string, string>();
  for (const article of articles) {
    titles.set(`article:${article.id}`, article.title || "未命名文章");
  }
  for (const doc of documents) {
    titles.set(`technical-document:${doc.id}`, doc.title || "未命名文档");
  }
  return titles;
}

/** 洞察区（§12.8 洞察）。 */
export async function usageInsights(range: UsageRange): Promise<UsageInsights> {
  const where = whereForRange(range);
  const rows = await prisma.agentUsageTurn.findMany({
    where,
    select: {
      id: true,
      startedAt: true,
      modelId: true,
      targetKind: true,
      targetId: true,
      totalTokens: true,
      costUsd: true,
      status: true,
    },
    orderBy: { startedAt: "desc" },
    take: 500,
  });

  // 最常用模型
  const modelMap = new Map<string, { totalTokens: number; turnCount: number }>();
  const targetMap = new Map<string, { targetKind: string; targetId: string; totalTokens: number; turnCount: number }>();
  for (const row of rows) {
    const mid = row.modelId ?? "unknown";
    const m = modelMap.get(mid) ?? { totalTokens: 0, turnCount: 0 };
    m.totalTokens += row.totalTokens;
    m.turnCount += 1;
    modelMap.set(mid, m);
    const tkey = `${row.targetKind}:${row.targetId}`;
    const t = targetMap.get(tkey) ?? {
      targetKind: row.targetKind,
      targetId: row.targetId,
      totalTokens: 0,
      turnCount: 0,
    };
    t.totalTokens += row.totalTokens;
    t.turnCount += 1;
    targetMap.set(tkey, t);
  }
  const topModelEntry = Array.from(modelMap.entries())
    .map(([modelId, v]) => ({ modelId, ...v }))
    .sort((a, b) => b.totalTokens - a.totalTokens)[0];
  const targetTitles = await loadTargetTitleMap(rows);
  const topTargets = Array.from(targetMap.values())
    .map((target) => ({
      ...target,
      targetTitle:
        targetTitles.get(`${target.targetKind}:${target.targetId}`) ?? null,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 5);
  const costliestRecentTurns = [...rows]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 10)
    .map((turn) => ({
      ...turn,
      targetTitle:
        targetTitles.get(`${turn.targetKind}:${turn.targetId}`) ?? null,
    }));

  return {
    topModel: topModelEntry ? topModelEntry : null,
    topTargets,
    costliestRecentTurns,
  };
}

export type UsageTurnRow = {
  id: string;
  sessionId: string;
  turnId: string;
  targetKind: string;
  targetId: string;
  targetTitle: string | null;
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalTokens: number;
  costUsd: number;
  status: string;
  source: string;
  startedAt: Date;
};

/** 明细表（§12.8 明细）：支持 modelId/targetId/status 过滤 + 游标分页。 */
export async function listUsageTurns(opts: {
  range?: UsageRange;
  modelId?: string | null;
  targetId?: string | null;
  status?: string | null;
  limit?: number;
  cursor?: string | null;
}): Promise<{ turns: UsageTurnRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where: Record<string, unknown> = {};
  if (opts.range) {
    const startedAt: Record<string, Date> = {};
    if (opts.range.from) startedAt.gte = opts.range.from;
    if (opts.range.to) startedAt.lte = opts.range.to;
    if (Object.keys(startedAt).length) where.startedAt = startedAt;
  }
  if (opts.modelId) where.modelId = opts.modelId;
  if (opts.targetId) where.targetId = opts.targetId;
  if (opts.status) where.status = opts.status;

  const rows = await prisma.agentUsageTurn.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit + 1,
    ...(opts.cursor
      ? { cursor: { id: opts.cursor }, skip: 1 }
      : {}),
    select: {
      id: true,
      sessionId: true,
      turnId: true,
      targetKind: true,
      targetId: true,
      modelId: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadInputTokens: true,
      cacheCreationInputTokens: true,
      totalTokens: true,
      costUsd: true,
      status: true,
      source: true,
      startedAt: true,
    },
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const targetTitles = await loadTargetTitleMap(page);
  return {
    turns: page.map((row) => ({
      ...row,
      targetTitle:
        targetTitles.get(`${row.targetKind}:${row.targetId}`) ?? null,
    })) as UsageTurnRow[],
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/** 清空 token 统计（§12.6 危险操作）：仅删 AgentUsageTurn，不动文章/消息/Claude session。 */
export async function clearUsage(): Promise<number> {
  const result = await prisma.agentUsageTurn.deleteMany({});
  return result.count;
}

/** SQLite strftime 等价的本地时间格式化（应用层实现，避免依赖 SQLite 方言/时区）。 */
function sqliteStrftime(date: Date, fmt: string): string {
  if (fmt === "%Y-%m-%d") return toLocalDayKey(date);
  if (fmt === "%Y-W%W") {
    const y = date.getFullYear();
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const week = Math.ceil(
      ((date.getTime() - firstDay.getTime()) / 86400000 + firstDay.getDay() + 1) / 7
    );
    return `${y}-W${String(week).padStart(2, "0")}`;
  }
  // hour
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:00:00`;
}
