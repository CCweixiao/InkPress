"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOOL_LABELS } from "@/components/ai/tool-helpers";

/**
 * P3 权限闸门审批卡（mirror CodeSourceApprovalCard）。
 *
 * canUseTool 命中 ASK 时由后端 emit `data-tool-approval`；本卡展示工具中文名 + 拟入参，
 * 用户同意/拒绝 → POST /api/ai/agent-approvals/{grantId}。同意后 SDK 解阻塞、**同一条开着的
 * 流自动恢复**（无需重发），所以此处只 POST + 更新本地状态、不触发 resumeAfterApproval。
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
    approvalToken: string;
  };
  /** 状态变化通知父级（pending 时锁定 composer）。 */
  onStatusChange?: (status: string) => void;
}) {
  const label = TOOL_LABELS[data.toolName] ?? data.displayName ?? data.toolName;
  const digestText =
    typeof data.input?.digest === "string" ? data.input.digest : "";
  const [status, setStatus] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onStatusChange?.("pending");
    let active = true;
    fetch(`/api/ai/agent-approvals/${data.grantId}/status`)
      .then((r) => r.json())
      .then((result) => {
        if (active && typeof result.status === "string") {
          setStatus(result.status);
          onStatusChange?.(result.status);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // 仅依赖 grantId；onStatusChange 为父级稳定回调，不纳入依赖以免重锁。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.grantId]);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/ai/agent-approvals/${data.grantId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalToken: data.approvalToken,
        action,
      }),
    });
    const result = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof result.error === "string" ? result.error : "审批失败。");
      return;
    }
    const next = action === "approve" ? "approved" : "rejected";
    setStatus(next);
    onStatusChange?.(next);
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-amber-950 dark:text-amber-100">
            请求批准：{label}
          </div>
          <p className="mt-1 leading-5 text-amber-800 dark:text-amber-200">
            Agent 想执行此写回操作，需要你的确认。
          </p>
          {digestText && (
            <div className="mt-2 rounded border border-amber-200 bg-white/60 p-2 leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              {digestText}
            </div>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
      {status === "pending" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void decide("approve")}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            同意
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => void decide("reject")}
          >
            拒绝
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {status === "approved" ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              已批准
            </>
          ) : status === "rejected" ? (
            <>
              <X className="h-3.5 w-3.5" />
              已拒绝
            </>
            ) : (
              <>
                <X className="h-3.5 w-3.5" />
                已过期
              </>
            )}
        </div>
      )}
    </div>
  );
}
