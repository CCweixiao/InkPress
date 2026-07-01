"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Flame, Loader2, Trash2, TrendingUp } from "lucide-react";
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
  }>;
};

type UsageTurnRow = {
  id: string;
  targetKind: string;
  targetId: string;
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

/** 热力图色阶：按 token 强度从低到高着色（emerald 系，0 → 透明）。 */
function heatColor(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "bg-muted/40";
  const r = Math.min(1, value / max);
  if (r > 0.75) return "bg-emerald-600";
  if (r > 0.5) return "bg-emerald-500/80";
  if (r > 0.25) return "bg-emerald-400/70";
  return "bg-emerald-300/60";
}

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

  return (
    <div className="space-y-4">
      {confirmDialog}
      {/* 顶部控件：时间筛选 + 清空 */}
      <div className="flex flex-wrap items-center gap-2">
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
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
          刷新
        </Button>
        <div className="ml-auto">
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
      </div>

      {/* KPI 横条 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="累计 Token" value={summary ? formatTokens(summary.totalTokens) : "—"} />
        <KpiCard
          label="估算成本"
          value={summary ? formatCost(summary.totalCostUsd) || "$0" : "—"}
        />
        <KpiCard label="峰值单轮" value={summary ? formatTokens(summary.peakTurnTokens) : "—"} />
        <KpiCard
          label="平均每轮"
          value={summary ? formatTokens(summary.avgTurnTokens) : "—"}
        />
        <KpiCard
          label="连续使用"
          value={summary ? `${summary.streakDays} 天` : "—"}
          icon={<Flame className="h-3.5 w-3.5 text-amber-500" />}
        />
        <KpiCard label="会话总数" value={summary ? String(summary.sessionCount) : "—"} />
      </div>

      {/* 主趋势图 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-sm">消耗趋势</CardTitle>
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
          </div>
        </CardHeader>
        <CardContent>
          <TrendChart points={points} metric={metric} />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>cache 命中占比 {summary ? pct(summary.cacheHitRatio) : "—"}</span>
            <span>· 中断估算 {summary?.partialTurnCount ?? 0} 轮</span>
            <span>· 错误完成 {summary?.errorTurnCount ?? 0} 轮</span>
          </div>
        </CardContent>
      </Card>

      {/* 热力图 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">活动热力图</CardTitle>
        </CardHeader>
        <CardContent>
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
                  ? insights.topTargets
                      .map(
                        (t) =>
                          `${labelTarget(t.targetKind)}(${t.targetId.slice(0, 6)}) ${formatTokens(
                            t.totalTokens
                          )}`
                      )
                      .join("，")
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
              <div key={t.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {t.modelId ?? "unknown"}
                </span>
                <span className="shrink-0">
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

function KpiCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** 趋势图：按 bucket 聚合为单柱（多 groupKey 求和），高度 ∝ 该 bucket 的 metric 值。 */
function TrendChart({
  points,
  metric,
}: {
  points: TimeSeriesPoint[];
  metric: Metric;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, { tokens: number; cost: number; groups: Map<string, number> }>();
    for (const p of points) {
      const b = map.get(p.bucket) ?? { tokens: 0, cost: 0, groups: new Map() };
      b.tokens += p.totalTokens;
      b.cost += p.costUsd;
      b.groups.set(p.groupKey, (b.groups.get(p.groupKey) ?? 0) + p.totalTokens);
      map.set(p.bucket, b);
    }
    return Array.from(map.entries())
      .map(([bucket, v]) => ({ bucket, ...v }))
      .sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
  }, [points]);

  if (buckets.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">
        暂无趋势数据
      </div>
    );
  }
  const max = Math.max(
    1,
    ...buckets.map((b) => (metric === "cost" ? b.cost : b.tokens))
  );
  return (
    <div className="flex h-32 items-end gap-1 overflow-x-auto">
      {buckets.map((b) => {
        const val = metric === "cost" ? b.cost : b.tokens;
        const h = Math.max(2, Math.round((val / max) * 100));
        return (
          <div
            key={b.bucket}
            className="group relative flex h-full flex-1 min-w-[6px] flex-col justify-end"
            title={`${shortDate(b.bucket)}：${formatTokens(b.tokens)} tokens · ${formatCost(b.cost) || "$0"} · ${b.groups.size} 组`}
          >
            <div
              className={cn(
                "w-full rounded-t-sm transition-all",
                metric === "cost" ? "bg-amber-400/70" : "bg-primary/70"
              )}
              style={{ height: `${h}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 热力图：每日一个色块，按 token 强度着色。 */
function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const max = Math.max(1, ...cells.map((c) => c.totalTokens));
  if (cells.length === 0) {
    return (
      <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
        暂无活动数据
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {cells.map((c) => (
        <div
          key={c.day}
          title={`${c.day}：${formatTokens(c.totalTokens)} tokens · ${c.turnCount} 轮 · ${formatCost(c.costUsd) || "$0"}`}
          className={cn(
            "h-4 w-4 rounded-sm",
            heatColor(c.totalTokens, max)
          )}
        />
      ))}
    </div>
  );
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
              <td className="py-1.5 pr-2">
                {labelTarget(t.targetKind)}·{t.targetId.slice(0, 6)}
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
