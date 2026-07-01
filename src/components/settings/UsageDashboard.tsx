"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  CircleDollarSign,
  Flame,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { formatCost, formatTokens } from "@/components/editor/agent-composer-parts";

// ─── 类型（与 /api/ai/usage/* 返回对齐） ──────────────────────────────────────

type UsageSummary = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  turnCount: number;
  peakTurnTokens: number;
  avgTurnTokens: number;
  cacheHitRatio: number;
  partialTurnCount: number;
  errorTurnCount: number;
  sessionCount: number;
  streakDays: number;
};

type TimeSeriesPoint = {
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

type HeatmapCell = { day: string; totalTokens: number; turnCount: number; costUsd: number };

type UsageInsights = {
  topModel: { modelId: string; totalTokens: number; turnCount: number } | null;
  topTargets: Array<{
    targetKind: string;
    targetId: string;
    targetTitle: string | null;
    totalTokens: number;
    turnCount: number;
  }>;
  costliestRecentTurns: Array<{
    id: string;
    startedAt: string;
    totalTokens: number;
    costUsd: number;
    modelId: string | null;
    status: string;
    targetKind: string;
    targetId: string;
    targetTitle: string | null;
  }>;
};

type UsageTurnRow = {
  id: string;
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
  startedAt: string;
};

type RangeKey = "7d" | "30d" | "all";
type GroupBy = "model" | "target" | "status";
type Metric = "tokens" | "cost";

type TrendSeries = {
  key: string;
  label: string;
  color: string;
  values: Array<{ bucket: string; value: number; tokens: number; cost: number }>;
  totalTokens: number;
  totalCost: number;
};

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; param: string }> = [
  { key: "7d", label: "近 7 天", param: "7d" },
  { key: "30d", label: "近 30 天", param: "30d" },
  { key: "all", label: "全部", param: "" },
];

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function statusBadge(status: string) {
  if (status === "error")
    return (
      <Badge variant="outline" className="border-red-300 text-red-600 dark:border-red-900 dark:text-red-400">
        错误完成
      </Badge>
    );
  if (status === "partial") return <Badge variant="warning">中断估算</Badge>;
  return <Badge variant="secondary">完成</Badge>;
}

function shortDate(bucket: string): string {
  // YYYY-MM-DD → MM-DD；YYYY-MM-DDTHH:00:00 → MM-DD HH:00；YYYY-Www 原样
  if (bucket.includes("T")) return bucket.slice(5, 16).replace("T", " ");
  if (bucket.startsWith("20") && bucket.length === 10) return bucket.slice(5);
  return bucket;
}

function formatDateLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function shortModelName(modelId: string | null | undefined): string {
  if (!modelId) return "unknown";
  return modelId
    .replace(/^models\//, "")
    .replace(/^claude-/, "Claude ")
    .replace(/^glm-/, "GLM-")
    .replace(/-/g, " ");
}

function labelGroupKey(groupBy: GroupBy, key: string): string {
  if (groupBy === "model") return shortModelName(key);
  if (groupBy === "status") {
    if (key === "completed") return "完成";
    if (key === "partial") return "中断估算";
    if (key === "error") return "错误完成";
    return key;
  }
  const [kind, id] = key.split(":");
  return `${labelTarget(kind ?? "")} ${id ? id.slice(0, 6) : key.slice(0, 8)}`;
}

function labelSeriesPoint(groupBy: GroupBy, key: string, groupLabel?: string | null): string {
  if (groupBy === "target" && groupLabel?.trim()) return groupLabel.trim();
  return labelGroupKey(groupBy, key);
}

function targetDisplayName(target: {
  targetKind: string;
  targetId: string;
  targetTitle?: string | null;
}): string {
  const title = target.targetTitle?.trim();
  if (title) return title;
  return target.targetKind === "technical-document" ? "未命名文档" : "未命名文章";
}

function metricLabel(metric: Metric) {
  return metric === "cost" ? "成本" : "Token";
}

function formatMetric(value: number, metric: Metric): string {
  return metric === "cost" ? formatCost(value) || "$0" : formatTokens(value);
}

function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "bg-zinc-100 dark:bg-zinc-900";
  const r = Math.min(1, value / max);
  if (r > 0.75) return "bg-sky-500";
  if (r > 0.5) return "bg-sky-400";
  if (r > 0.25) return "bg-sky-300";
  return "bg-sky-100 dark:bg-sky-950";
}

const SERIES_COLORS = [
  "#3b82f6",
  "#f97316",
  "#a855f7",
  "#06b6d4",
  "#22c55e",
  "#f59e0b",
];

// ─── 组件 ────────────────────────────────────────────────────────────────────

export function UsageDashboard() {
  const [range, setRange] = useState<RangeKey>("30d");
  const [groupBy, setGroupBy] = useState<GroupBy>("model");
  const [metric, setMetric] = useState<Metric>("tokens");
  const rangeParam = RANGE_OPTIONS.find((r) => r.key === range)?.param ?? "";

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [insights, setInsights] = useState<UsageInsights | null>(null);
  const [points, setPoints] = useState<TimeSeriesPoint[]>([]);
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [turns, setTurns] = useState<UsageTurnRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clearing, setClearing] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = (p: string) => (p ? `&${p}` : "");
      const rangeQ = rangeParam ? `range=${rangeParam}` : "";
      const [s, t, h] = await Promise.all([
        fetch(`/api/ai/usage/summary?${rangeQ}`).then((r) => r.json()),
        fetch(`/api/ai/usage/timeseries?bucket=day&groupBy=${groupBy}&${rangeQ}`).then((r) =>
          r.json()
        ),
        fetch(`/api/ai/usage/heatmap?${rangeQ}`).then((r) => r.json()),
      ]);
      setSummary(s.summary ?? null);
      setInsights(s.insights ?? null);
      setPoints(t.points ?? []);
      setCells(h.cells ?? []);
      // 明细重置到第一页
      setTurns([]);
      setNextCursor(null);
      const statusQ = statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const tu = await fetch(
        `/api/ai/usage/turns?${rangeQ}${qs(`limit=20${statusQ}`)}`
      ).then((r) => r.json());
      setTurns(tu.turns ?? []);
      setNextCursor(tu.nextCursor ?? null);
    } finally {
      setLoading(false);
    }
  }, [rangeParam, groupBy, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function loadMore() {
    if (!nextCursor) return;
    const rangeQ = rangeParam ? `range=${rangeParam}&` : "";
    const statusQ = statusFilter !== "all" ? `&status=${statusFilter}` : "";
    const tu = await fetch(
      `/api/ai/usage/turns?${rangeQ}limit=20&cursor=${nextCursor}${statusQ}`
    ).then((r) => r.json());
    setTurns((prev) => [...prev, ...(tu.turns ?? [])]);
    setNextCursor(tu.nextCursor ?? null);
  }

  async function clearAll() {
    const ok = await confirm({
      title: "清空 Token 统计？",
      description:
        "将删除全部 AgentUsageTurn 流水（token / 成本历史）。此操作不可恢复，且不影响文章、消息与 Claude 会话。",
      confirmText: "清空统计",
      variant: "destructive",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await fetch("/api/ai/usage", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "CLEAR_USAGE" }),
      });
      await refresh();
    } finally {
      setClearing(false);
    }
  }

  const modelSummary = useMemo(() => {
    const totals = new Map<string, { tokens: number; cost: number; turns: number }>();
    for (const point of points) {
      const row = totals.get(point.groupKey) ?? { tokens: 0, cost: 0, turns: 0 };
      row.tokens += point.totalTokens;
      row.cost += point.costUsd;
      row.turns += point.turnCount;
      totals.set(point.groupKey, row);
    }
    return Array.from(totals.entries())
      .map(([key, value], index) => ({
        key,
        label:
          labelSeriesPoint(
            groupBy,
            key,
            points.find((point) => point.groupKey === key)?.groupLabel
          ),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        ...value,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5);
  }, [groupBy, points]);

  return (
    <div className="space-y-5">
      {confirmDialog}
      {/* 顶部控件：时间筛选 + 清空 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div className="text-sm font-semibold">Token 消耗</div>
          <div className="text-xs text-muted-foreground">
            跟踪 Agent 对话的上下文、模型消耗和每日活跃度
          </div>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((r) => (
              <SelectItem key={r.key} value={r.key} className="text-xs">
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={refresh}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          刷新
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
          onClick={clearAll}
          disabled={clearing || !summary?.turnCount}
        >
          {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          清空统计
        </Button>
      </div>

      <StatsStrip summary={summary} />

      {/* 主趋势图 */}
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" />
              用量趋势
            </CardTitle>
            <Select value={String(groupBy)} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="model" className="text-xs">模型用量</SelectItem>
                <SelectItem value="target" className="text-xs">目标用量</SelectItem>
                <SelectItem value="status" className="text-xs">按状态</SelectItem>
              </SelectContent>
            </Select>
            <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tokens" className="text-xs">Token</SelectItem>
                <SelectItem value="cost" className="text-xs">成本</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>cache 命中 {summary ? pct(summary.cacheHitRatio) : "—"}</span>
              <span>中断 {summary?.partialTurnCount ?? 0} 轮</span>
              <span>错误 {summary?.errorTurnCount ?? 0} 轮</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          {modelSummary.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {modelSummary.map((item) => (
                <div key={item.key} className="border-l pl-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">
                    {formatTokens(item.tokens)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {item.turns} 轮 · {formatCost(item.cost) || "$0"}
                  </div>
                </div>
              ))}
            </div>
          )}
          <TrendChart points={points} metric={metric} groupBy={groupBy} />
        </CardContent>
      </Card>

      {/* 热力图 */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-sky-500" />
              Token 活动
            </CardTitle>
            <div className="text-xs text-muted-foreground">
              {range === "7d" ? "近 7 天" : range === "30d" ? "近 30 天" : "全部记录"}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <Heatmap cells={cells} />
        </CardContent>
      </Card>

      {/* 洞察区 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">洞察</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <InsightRow
              label="最常用模型"
              value={
                insights?.topModel
                  ? `${insights.topModel.modelId} · ${formatTokens(insights.topModel.totalTokens)} tokens`
                  : "—"
              }
            />
            <InsightRow
              label="token 最高目标"
              value={
                insights?.topTargets?.length
                  ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {insights.topTargets.slice(0, 3).map((t) => (
                          <span
                            key={`${t.targetKind}:${t.targetId}`}
                            title={targetDisplayName(t)}
                            className="inline-flex max-w-44 items-center gap-1 rounded-md border px-1.5 py-0.5"
                          >
                            <span className="truncate">{targetDisplayName(t)}</span>
                            <span className="shrink-0 text-muted-foreground">
                              {formatTokens(t.totalTokens)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )
                  : "—"
              }
            />
            <InsightRow
              label="平均每轮"
              value={summary ? `${formatTokens(summary.avgTurnTokens)} tokens` : "—"}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">成本最高的最近 10 轮</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {(insights?.costliestRecentTurns ?? []).length === 0 && (
              <div className="text-muted-foreground">暂无数据</div>
            )}
            {(insights?.costliestRecentTurns ?? []).map((t) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                <div className="min-w-0">
                  <div
                    className="truncate font-medium"
                    title={targetDisplayName(t)}
                  >
                    {targetDisplayName(t)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {shortModelName(t.modelId)}
                  </div>
                </div>
                <span className="shrink-0 tabular-nums">
                  {formatTokens(t.totalTokens)} · {formatCost(t.costUsd) || "$0"}
                </span>
                <span className="shrink-0">{statusBadge(t.status)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* 明细表 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">明细</CardTitle>
            <span className="text-xs text-muted-foreground">
              已加载 {turns.length} 条{nextCursor ? "，可继续分页加载" : ""}
            </span>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v)}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">全部状态</SelectItem>
                <SelectItem value="completed" className="text-xs">完成</SelectItem>
                <SelectItem value="partial" className="text-xs">中断估算</SelectItem>
                <SelectItem value="error" className="text-xs">错误完成</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <TurnsTable turns={turns} />
          {nextCursor && (
            <div className="mt-2 flex justify-center">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadMore}>
                加载更多
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function labelTarget(kind: string): string {
  return kind === "technical-document" ? "文档" : "文章";
}

function StatsStrip({ summary }: { summary: UsageSummary | null }) {
  const items = [
    {
      label: "累计 Token 数",
      value: summary ? formatTokens(summary.totalTokens) : "—",
      icon: <Sparkles className="h-4 w-4 text-blue-500" />,
    },
    {
      label: "峰值单轮",
      value: summary ? formatTokens(summary.peakTurnTokens) : "—",
      icon: <TrendingUp className="h-4 w-4 text-orange-500" />,
    },
    {
      label: "估算成本",
      value: summary ? formatCost(summary.totalCostUsd) || "$0" : "—",
      icon: <CircleDollarSign className="h-4 w-4 text-emerald-500" />,
    },
    {
      label: "连续使用",
      value: summary ? `${summary.streakDays} 天` : "—",
      icon: <Flame className="h-4 w-4 text-amber-500" />,
    },
    {
      label: "会话总数",
      value: summary ? String(summary.sessionCount) : "—",
      icon: <CalendarDays className="h-4 w-4 text-violet-500" />,
    },
  ];

  return (
    <div className="grid overflow-hidden rounded-2xl border bg-background shadow-sm md:grid-cols-5">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "flex min-h-[68px] items-center gap-2.5 px-3 py-2.5",
            index > 0 && "border-t md:border-l md:border-t-0"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/70">
            {item.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="whitespace-nowrap text-xl font-semibold leading-tight tabular-nums md:text-lg lg:text-xl"
              title={`${item.label}：${item.value}`}
            >
              {item.value}
            </div>
            <div className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
              {item.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function TrendChart({
  points,
  metric,
  groupBy,
}: {
  points: TimeSeriesPoint[];
  metric: Metric;
  groupBy: GroupBy;
}) {
  const { buckets, series } = useMemo(() => {
    const bucketSet = new Set<string>();
    const groupTotals = new Map<string, { tokens: number; cost: number; turns: number }>();
    for (const p of points) {
      bucketSet.add(p.bucket);
      const total = groupTotals.get(p.groupKey) ?? { tokens: 0, cost: 0, turns: 0 };
      total.tokens += p.totalTokens;
      total.cost += p.costUsd;
      total.turns += p.turnCount;
      groupTotals.set(p.groupKey, total);
    }
    const buckets = Array.from(bucketSet).sort();
    const topGroups = Array.from(groupTotals.entries())
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5);
    const pointMap = new Map<string, TimeSeriesPoint>();
    for (const p of points) pointMap.set(`${p.groupKey}__${p.bucket}`, p);
    const series: TrendSeries[] = topGroups.map(([key, totals], index) => ({
      key,
      label:
        labelSeriesPoint(
          groupBy,
          key,
          points.find((point) => point.groupKey === key)?.groupLabel
        ),
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      totalTokens: totals.tokens,
      totalCost: totals.cost,
      values: buckets.map((bucket) => {
        const p = pointMap.get(`${key}__${bucket}`);
        return {
          bucket,
          value: metric === "cost" ? p?.costUsd ?? 0 : p?.totalTokens ?? 0,
          tokens: p?.totalTokens ?? 0,
          cost: p?.costUsd ?? 0,
        };
      }),
    }));
    return { buckets, series };
  }, [groupBy, metric, points]);

  if (buckets.length === 0 || series.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl bg-muted/30 text-xs text-muted-foreground">
        暂无趋势数据
      </div>
    );
  }
  const width = Math.max(720, buckets.length * 44);
  const height = 280;
  const pad = { left: 50, right: 24, top: 20, bottom: 42 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v.value)));
  const x = (index: number) =>
    pad.left + (buckets.length <= 1 ? chartW / 2 : (index / (buckets.length - 1)) * chartW);
  const y = (value: number) => pad.top + chartH - (value / max) * chartH;
  const grid = [0, 0.25, 0.5, 0.75, 1];

  function pathFor(values: TrendSeries["values"]) {
    return values
      .map((v, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(v.value).toFixed(1)}`)
      .join(" ");
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40">
        <svg width={width} height={height} role="img" aria-label={`${metricLabel(metric)}趋势折线图`}>
          <defs>
            <linearGradient id="usageArea" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
            <filter id="usageTooltipShadow" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="currentColor" floodOpacity="0.12" />
            </filter>
          </defs>
          {grid.map((g) => {
            const gy = pad.top + chartH - g * chartH;
            return (
              <g key={g}>
                <line x1={pad.left} x2={width - pad.right} y1={gy} y2={gy} stroke="currentColor" className="text-border" />
                <text x={12} y={gy + 4} className="fill-muted-foreground text-[10px]">
                  {formatMetric(max * g, metric)}
                </text>
              </g>
            );
          })}
          {buckets.map((bucket, index) => {
            if (index % Math.ceil(buckets.length / 8) !== 0 && index !== buckets.length - 1) return null;
            return (
              <text
                key={bucket}
                x={x(index)}
                y={height - 12}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {shortDate(bucket)}
              </text>
            );
          })}
          {series.map((s) => (
            <g key={s.key}>
              <path d={pathFor(s.values)} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              {s.values.map((v, index) =>
                v.value > 0 ? (
                  <g key={`${s.key}-${v.bucket}`} className="group">
                    <circle cx={x(index)} cy={y(v.value)} r={3} fill={s.color} />
                    <circle
                      cx={x(index)}
                      cy={y(v.value)}
                      r={9}
                      fill="transparent"
                      className="cursor-crosshair"
                    />
                    <g className="pointer-events-none opacity-0 transition-opacity group-hover:opacity-100">
                      <rect
                        x={Math.min(width - 188, Math.max(56, x(index) - 76))}
                        y={Math.max(8, y(v.value) - 62)}
                        width={168}
                        height={52}
                        rx={8}
                        className="fill-white stroke-slate-200 text-slate-900 dark:fill-slate-900 dark:stroke-slate-700 dark:text-slate-950"
                        filter="url(#usageTooltipShadow)"
                      />
                      <text
                        x={Math.min(width - 178, Math.max(66, x(index) - 66))}
                        y={Math.max(27, y(v.value) - 42)}
                        className="fill-slate-900 text-[11px] font-medium dark:fill-slate-100"
                      >
                        {s.label}
                      </text>
                      <text
                        x={Math.min(width - 178, Math.max(66, x(index) - 66))}
                        y={Math.max(43, y(v.value) - 26)}
                        className="fill-slate-500 text-[10px] dark:fill-slate-400"
                      >
                        {`${formatDateLabel(v.bucket)} · ${formatTokens(v.tokens)} tokens`}
                      </text>
                      <text
                        x={Math.min(width - 178, Math.max(66, x(index) - 66))}
                        y={Math.max(59, y(v.value) - 10)}
                        className="fill-slate-500 text-[10px] dark:fill-slate-400"
                      >
                        {`成本 ${formatCost(v.cost) || "$0"}`}
                      </text>
                    </g>
                  </g>
                ) : null
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-2">
        {series.map((s) => (
          <div key={s.key} className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="max-w-32 truncate">{s.label}</span>
            <span className="text-muted-foreground">
              {metric === "cost" ? formatCost(s.totalCost) || "$0" : formatTokens(s.totalTokens)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const dayMap = useMemo(
    () => new Map(cells.map((cell) => [cell.day, cell])),
    [cells]
  );
  const days = useMemo(() => buildHeatmapDays(cells), [cells]);
  const max = Math.max(1, ...days.map((day) => day.cell?.totalTokens ?? 0));
  if (days.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center rounded-xl bg-muted/30 text-xs text-muted-foreground">
        暂无活动数据
      </div>
    );
  }
  const weeks = Math.ceil(days.length / 7);
  const monthLabels = buildHeatmapMonthLabels(days);
  return (
    <div className="space-y-3">
      <div className="overflow-visible">
        <div className="w-full">
          <div
            className="grid grid-flow-col grid-rows-7 gap-1"
            style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
          >
            {days.map((day, index) => {
              const cell = dayMap.get(day.date);
              const weekIndex = Math.floor(index / 7);
              const tooltip = cell
                ? `${day.date} · ${formatTokens(cell.totalTokens)} tokens · ${cell.turnCount} 轮 · ${formatCost(cell.costUsd) || "$0"}`
                : `${day.date} · 无用量`;
              const tooltipAlign =
                weekIndex < 4
                  ? "left-0"
                  : weekIndex > weeks - 5
                    ? "right-0"
                    : "left-1/2 -translate-x-1/2";
              return (
                <div
                  key={`${day.date}-${index}`}
                  title={tooltip}
                  className={cn(
                    "group relative aspect-square w-full min-w-0 rounded-[4px] ring-1 ring-black/[0.02] dark:ring-white/[0.03]",
                    heatColor(cell?.totalTokens ?? 0, max)
                  )}
                >
                  <div
                    className={cn(
                      "pointer-events-none absolute bottom-5 z-30 hidden w-max max-w-56 rounded-md border bg-background px-2 py-1.5 text-[11px] shadow-lg group-hover:block",
                      tooltipAlign
                    )}
                  >
                    <div className="font-medium text-foreground">{day.date}</div>
                    {cell ? (
                      <div className="mt-0.5 space-y-0.5 text-muted-foreground">
                        <div>{formatTokens(cell.totalTokens)} tokens</div>
                        <div>{cell.turnCount} 轮 · {formatCost(cell.costUsd) || "$0"}</div>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-muted-foreground">无用量</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="mt-3 grid text-[11px] leading-none text-muted-foreground"
            style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: weeks }).map((_, index) => (
              <span key={index} className="whitespace-nowrap">
                {monthLabels.get(index) ?? ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>颜色越深，代表当天 token 使用越多</span>
        <div className="flex items-center gap-1">
          <span>少</span>
          {[0, 0.2, 0.45, 0.7, 1].map((v) => (
            <span key={v} className={cn("h-3 w-3 rounded-sm", heatColor(v * max, max))} />
          ))}
          <span>多</span>
        </div>
      </div>
    </div>
  );
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildHeatmapDays(cells: HeatmapCell[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = addDays(today, 6 - today.getDay());
  const tenMonthsAgo = new Date(today);
  tenMonthsAgo.setMonth(tenMonthsAgo.getMonth() - 10);
  tenMonthsAgo.setHours(0, 0, 0, 0);
  const start = addDays(tenMonthsAgo, -tenMonthsAgo.getDay());
  const dayCount =
    Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const dayMap = new Map(cells.map((cell) => [cell.day, cell]));
  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(start, index);
    const key = dateKey(date);
    return { date: key, cell: dayMap.get(key) };
  });
}

function buildHeatmapMonthLabels(days: Array<{ date: string }>) {
  const labels = new Map<number, string>();
  let lastMonth = "";
  days.forEach((day, index) => {
    const month = day.date.slice(5, 7);
    if (month !== lastMonth) {
      labels.set(Math.floor(index / 7), `${Number(month)}月`);
      lastMonth = month;
    }
  });
  return labels;
}

function TurnsTable({ turns }: { turns: UsageTurnRow[] }) {
  if (turns.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-muted-foreground">暂无明细</div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">时间</th>
            <th className="py-1.5 pr-2 font-medium">目标</th>
            <th className="py-1.5 pr-2 font-medium">模型</th>
            <th className="py-1.5 pr-2 text-right font-medium">输入</th>
            <th className="py-1.5 pr-2 text-right font-medium">输出</th>
            <th className="py-1.5 pr-2 text-right font-medium">Cache 读</th>
            <th className="py-1.5 pr-2 text-right font-medium">合计</th>
            <th className="py-1.5 pr-2 text-right font-medium">成本</th>
            <th className="py-1.5 pr-2 font-medium">状态</th>
          </tr>
        </thead>
        <tbody>
          {turns.map((t) => (
            <tr key={t.id} className="border-b last:border-0">
              <td className="py-1.5 pr-2 text-muted-foreground">
                {new Date(t.startedAt).toLocaleString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="max-w-72 py-1.5 pr-2">
                <div className="min-w-0">
                  <div
                    className="truncate font-medium"
                    title={targetDisplayName(t)}
                  >
                    {targetDisplayName(t)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {labelTarget(t.targetKind)}
                  </div>
                </div>
              </td>
              <td className="py-1.5 pr-2 font-mono text-muted-foreground">
                {t.modelId ?? "—"}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{t.inputTokens.toLocaleString()}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{t.outputTokens.toLocaleString()}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                {t.cacheReadInputTokens.toLocaleString()}
              </td>
              <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                {t.totalTokens.toLocaleString()}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {formatCost(t.costUsd) || "$0"}
              </td>
              <td className="py-1.5 pr-2">{statusBadge(t.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
