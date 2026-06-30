"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 限流重试提示（data-agent-retry）。
 *
 - level==="sdk"：SDK 轮内自动重试（瞬时 429 多在此化解），转圈 + 等待秒数。
 - level==="turn"：整轮重试（SDK 内部重试用尽后由 runtime 触发），转圈 + 倒计时 mm:ss +
 *   「点停止可取消」提示。
 */
export function RetryIndicator({
  data,
  settled,
}: {
  data: Record<string, unknown>;
  /** 所属消息已定格（取消/出错/完成）：停止倒计时、转圈降级为静态。 */
  settled?: boolean;
}) {
  const level = String(data.level ?? "sdk");
  const attempt = Number(data.attempt ?? 0);
  const maxRetries = Number(data.maxRetries ?? 0);
  const delayMs = Number(data.delayMs ?? 0);
  const waitMs = Number(data.waitMs ?? 0);
  const isTurn = level === "turn";

  // turn 级：从 waitMs 倒计时到 0。
  const [remaining, setRemaining] = useState(
    Math.max(0, Math.round(waitMs / 1000))
  );
  useEffect(() => {
    if (!isTurn || settled) return;
    setRemaining(Math.max(0, Math.round(waitMs / 1000)));
    const timer = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isTurn, waitMs, settled]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const progress = isTurn
    ? `第 ${attempt}/${maxRetries} 轮重试，${mm}:${ss} 后继续`
    : `SDK 自动重试 ${attempt}/${maxRetries || "?"}${
        delayMs ? `，约 ${Math.round(delayMs / 1000)}s` : ""
      }`;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      )}
    >
      <Loader2
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400",
          settled && "animate-none"
        )}
      />
      <span className="shrink-0 font-medium">模型限流</span>
      <span className="min-w-0 flex-1 truncate">{progress}</span>
      {isTurn && !settled && (
        <span className="shrink-0 text-amber-700/80 dark:text-amber-300/80">
          点「停止」可取消
        </span>
      )}
    </div>
  );
}
