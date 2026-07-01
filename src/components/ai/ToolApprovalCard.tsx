"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOOL_LABELS } from "@/components/ai/tool-helpers";

type WebUrlRiskAssessment = {
  url: string;
  domain: string;
  isHttps: boolean;
  isKnownAuthority: boolean;
  isLikelyOfficial: boolean;
  isDeveloperSource: boolean;
  isRepositorySource: boolean;
  riskLevel: "low" | "medium" | "high";
  signals: string[];
  warnings: string[];
};

type ApprovalItem = {
  grantId: string;
  url: string;
  domain: string;
  riskAssessment: WebUrlRiskAssessment | null;
  createdAt?: string;
};

function riskLabel(risk?: WebUrlRiskAssessment | null) {
  if (risk?.riskLevel === "low") return "低风险";
  if (risk?.riskLevel === "medium") return "中风险";
  if (risk?.riskLevel === "high") return "高风险";
  return "未知";
}

function riskClass(risk?: WebUrlRiskAssessment | null) {
  if (risk?.riskLevel === "low") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (risk?.riskLevel === "high") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  }
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
}

function compactSignals(risk?: WebUrlRiskAssessment | null) {
  if (!risk) return [];
  return [...risk.signals, ...risk.warnings]
    .filter((item) => item === "HTTPS" || item.includes("官方") || item.includes("权威") || item.includes("仓库") || item.includes("非 HTTPS"))
    .slice(0, 2);
}

/**
 * P3 权限闸门审批卡（mirror CodeSourceApprovalCard）。
 *
 * web_fetch 使用同会话 pending URL 列表渲染，支持逐条/整批决议；其它 ASK 工具回退为单项审批。
 */
export function ToolApprovalCard({
  data,
  onStatusChange,
}: {
  data: {
    grantId: string;
    toolName: string;
    displayName?: string;
    input: Record<string, unknown>;
    url?: string;
    domain?: string;
    riskAssessment?: WebUrlRiskAssessment | null;
    batch?: {
      enabled?: boolean;
      pendingCount?: number;
      scope?: string;
    };
    approvalToken: string;
  };
  /** 状态变化通知父级（pending 时锁定 composer）。 */
  onStatusChange?: (status: string) => void;
}) {
  const label = TOOL_LABELS[data.toolName] ?? data.displayName ?? data.toolName;
  const isWebFetch = data.toolName === "web_fetch";
  const fallbackUrl =
    typeof data.url === "string"
      ? data.url
      : typeof data.input?.url === "string"
        ? data.input.url
        : "";
  const fallbackItems = useMemo<ApprovalItem[]>(
    () =>
      fallbackUrl
        ? [
            {
              grantId: data.grantId,
              url: fallbackUrl,
              domain: data.domain ?? data.riskAssessment?.domain ?? "",
              riskAssessment: data.riskAssessment ?? null,
            },
          ]
        : [],
    [data.domain, data.grantId, data.riskAssessment, fallbackUrl]
  );
  const [items, setItems] = useState<ApprovalItem[]>(fallbackItems);
  const [status, setStatus] = useState("pending");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const pendingCount = isWebFetch ? items.length : 1;
  const digestText =
    typeof data.input?.digest === "string" ? data.input.digest : "";

  const loadBatch = useCallback(async () => {
    if (!isWebFetch) return fallbackItems;
    const res = await fetch(`/api/ai/agent-approvals/${data.grantId}/batch`);
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(result.items)) return fallbackItems;
    return result.items as ApprovalItem[];
  }, [data.grantId, fallbackItems, isWebFetch]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    if (!isWebFetch) {
      const poll = () => {
        fetch(`/api/ai/agent-approvals/${data.grantId}/status`)
          .then((r) => r.json())
          .then((result) => {
            if (!active || typeof result.status !== "string") return;
            setStatus(result.status);
            onStatusChange?.(result.status);
            if (result.status === "pending") {
              timer = window.setTimeout(poll, 1500);
            }
          })
          .catch(() => undefined);
      };
      onStatusChange?.("pending");
      poll();
      return () => {
        active = false;
        if (timer) window.clearTimeout(timer);
      };
    }
    const refresh = async () => {
      const nextItems = await loadBatch();
      if (!active) return;
      setItems(nextItems);
      const nextStatus = nextItems.length > 0 ? "pending" : "approved";
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      if (nextItems.length > 0) {
        timer = window.setTimeout(refresh, 1500);
      }
    };
    onStatusChange?.("pending");
    void refresh();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
    // 仅依赖 grantId/loadBatch；onStatusChange 为父级稳定回调，不纳入依赖以免重锁。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.grantId, loadBatch]);

  async function decide(action: "approve" | "reject", grantIds?: string[]) {
    const all = !grantIds?.length;
    const busy = `${action}:${all ? "all" : grantIds.join(",")}`;
    setBusyKey(busy);
    setError("");
    const endpoint = isWebFetch
      ? `/api/ai/agent-approvals/${data.grantId}/batch`
      : `/api/ai/agent-approvals/${data.grantId}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalToken: data.approvalToken,
        action,
        ...(grantIds?.length ? { grantIds } : {}),
      }),
    });
    const result = await res.json().catch(() => ({}));
    setBusyKey("");
    if (!res.ok) {
      setError(typeof result.error === "string" ? result.error : "审批失败。");
      return;
    }
    if (!isWebFetch) {
      const next = action === "approve" ? "approved" : "rejected";
      setStatus(next);
      onStatusChange?.(next);
      return;
    }
    const nextItems = await loadBatch();
    setItems(nextItems);
    const next = nextItems.length > 0 ? "pending" : action === "approve" ? "approved" : "rejected";
    setStatus(next);
    onStatusChange?.(nextItems.length > 0 ? "pending" : next);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs shadow-sm dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-amber-950 dark:text-amber-100">
              请求批准：{label}
            </span>
            {pendingCount > 1 && (
              <span className="rounded-full border border-amber-200 bg-white/70 px-1.5 py-0.5 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                {pendingCount} 个 URL
              </span>
            )}
          </div>
          <p className="mt-1 leading-5 text-amber-800 dark:text-amber-200">
            {isWebFetch
              ? "Agent 想读取外部网页正文，需要你的确认。"
              : "Agent 想执行此操作，需要你的确认。"}
          </p>
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-md border border-amber-200 bg-white/75 dark:border-amber-900 dark:bg-amber-950/30">
          {items.map((item, index) => {
            const risk = item.riskAssessment;
            const busyApprove = busyKey === `approve:${item.grantId}`;
            const busyReject = busyKey === `reject:${item.grantId}`;
            return (
              <div
                key={item.grantId}
                className={
                  index === 0
                    ? "grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2.5 py-2"
                    : "grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-amber-100 px-2.5 py-2 dark:border-amber-900/70"
                }
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate font-medium text-amber-950 underline-offset-2 hover:underline dark:text-amber-100"
                      title={item.url}
                    >
                      {item.url}
                    </a>
                    <ExternalLink className="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-300" />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] leading-3 ${riskClass(risk)}`}
                    >
                      {riskLabel(risk)}
                    </span>
                    {compactSignals(risk).map((signal) => (
                      <span
                        key={signal}
                        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] leading-3 text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                </div>
                {status === "pending" && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      className="h-6 w-6"
                      disabled={!!busyKey}
                      title="通过"
                      onClick={() => void decide("approve", [item.grantId])}
                    >
                      {busyApprove ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-slate-600 hover:text-red-700 dark:text-slate-300 dark:hover:text-red-300"
                      disabled={!!busyKey}
                      title="拒绝"
                      onClick={() => void decide("reject", [item.grantId])}
                    >
                      {busyReject ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isWebFetch && digestText && (
        <div className="mt-2 rounded-md border border-amber-200 bg-white/75 p-2 leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {digestText}
        </div>
      )}

      {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}

      {status === "pending" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!!busyKey || pendingCount === 0}
            onClick={() => void decide("approve")}
          >
            {busyKey === "approve:all" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {isWebFetch ? "全部通过" : "通过"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={!!busyKey || pendingCount === 0}
            onClick={() => void decide("reject")}
          >
            {isWebFetch ? "全部拒绝" : "拒绝"}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {status === "approved" ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              已批准
            </>
          ) : (
            <>
              <X className="h-3.5 w-3.5" />
              已拒绝
            </>
          )}
        </div>
      )}
    </div>
  );
}
