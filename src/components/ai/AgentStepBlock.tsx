"use client";

import { useState } from "react";
import { Check, CircleSlash, Loader2, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Agent 步骤块（意图/项目/技能/素材等 data-agent-step）。
 * 收起态显示标题 + 一行摘要；展开后显示完整 detail 与附加字段。
 */
export function AgentStepBlock({
  data,
  settled,
}: {
  data: Record<string, unknown>;
  /** 所属消息已定格（取消/出错/完成）：仍停留在 running 的步骤渲染为「已中断」而非旋转。 */
  settled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const title = String(data.title ?? "Agent 步骤");
  const detail = data.detail ? String(data.detail) : "";
  const status = String(data.status ?? "completed");
  const running = status === "running" && !settled;
  // 定格后仍标记 running 的步骤 = 用户取消 / 出错 / 断连导致未收尾。
  const interrupted = status === "running" && Boolean(settled);
  const failed = status === "failed";

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-muted/25"
    >
      <CollapsibleTrigger className="px-2.5 py-2 text-[11px] hover:bg-muted/40 rounded-md">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
        ) : interrupted ? (
          <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        <span className={cn("shrink-0 font-medium", failed && "text-red-700 dark:text-red-400")}>{title}</span>
        {interrupted && (
          <span className="shrink-0 text-muted-foreground">· 已中断</span>
        )}
        {detail && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>
        )}
      </CollapsibleTrigger>
      {detail && (
        <CollapsibleContent>
          <div className="border-t px-3 py-2 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
            {detail}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
