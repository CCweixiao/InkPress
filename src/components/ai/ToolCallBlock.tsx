"use client";

import { useState } from "react";
import { CircleSlash, Loader2, X } from "lucide-react";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  TOOL_LABELS,
  ToolIcon,
  summarizeTool,
  formatJson,
  getToolName,
  getToolDisplay,
} from "@/components/ai/tool-helpers";

/**
 * 工具调用块（Codex 风格）。
 * 标题行显示图标 + 中文名 + 状态 + 一行摘要，点击展开查看完整输入参数 / 输出 / 错误。
 */
export function ToolCallBlock({
  part,
  settled,
}: {
  part: Record<string, unknown>;
  /** 所属消息已定格（取消/出错/完成）：仍处于运行态的工具渲染为「已中断」而非旋转。 */
  settled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const toolName = getToolName(part);

  if (!toolName) return null;

  // P1：优先用后端 toolMetadata.display.title/summary；回退 TOOL_LABELS（历史消息/未迁移工具）。
  const display = getToolDisplay(part);

  const state = String(part.state ?? "");
  const live =
    state.includes("streaming") || state.includes("input") || state === "call";
  const running = live && !settled;
  const interrupted = live && Boolean(settled);
  const failed = state === "output-error";
  const errorText = typeof part.errorText === "string" ? part.errorText : "";
  const input = formatJson(part.input);
  const output = formatJson(part.output);
  const label = display?.title ?? TOOL_LABELS[toolName] ?? toolName;
  const hasDetail = Boolean(input || output || errorText);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-md border bg-muted/25",
        failed &&
          "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      )}
    >
      <CollapsibleTrigger
        className="px-2.5 py-2 text-[11px] hover:bg-muted/40 rounded-md"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <X className="h-3.5 w-3.5 shrink-0 text-red-600" />
        ) : interrupted ? (
          <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="shrink-0">
            <ToolIcon name={toolName} />
          </span>
        )}
        <span className="shrink-0 font-medium">{label}</span>
        {interrupted && (
          <span className="shrink-0 text-muted-foreground">· 已中断</span>
        )}
        {!running && !interrupted && !failed && hasDetail && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {summarizeTool(toolName, part.output, part.errorText, display)}
          </span>
        )}
      </CollapsibleTrigger>
      {hasDetail && (
        <CollapsibleContent>
          <div className="border-t px-3 py-2 space-y-2 text-[11px]">
            {input && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground">输入</div>
                <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-5 font-mono">
                  {input}
                </pre>
              </div>
            )}
            {output && (
              <div>
                <div className="mb-1 font-medium text-muted-foreground">输出</div>
                <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[10px] leading-5 font-mono max-h-60 overflow-y-auto">
                  {output}
                </pre>
              </div>
            )}
            {errorText && (
              <div>
                <div className="mb-1 font-medium text-red-600 dark:text-red-400">错误</div>
                <pre className="overflow-x-auto rounded bg-red-50 p-2 text-[10px] leading-5 font-mono text-red-700 dark:bg-red-950 dark:text-red-300">
                  {errorText}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
