"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  CircleSlash,
  FileSearch,
  Globe2,
  Loader2,
  X,
} from "lucide-react";
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
  summarizeDataPart,
  formatJson,
  getToolName,
  isPartStreaming,
  isGroupStreaming,
} from "@/components/ai/tool-helpers";

type AgentPart = Record<string, unknown>;

const GROUP_TITLE: Record<"explore" | "web", string> = {
  explore: "探索代码项目",
  web: "搜索网络资料",
};

function GroupIcon({ groupType }: { groupType: "explore" | "web" }) {
  if (groupType === "web") return <Globe2 className="h-3.5 w-3.5 shrink-0" />;
  return <FileSearch className="h-3.5 w-3.5 shrink-0" />;
}

/** 计算组内完成/失败/运行中/已中断计数，用于标题徽章。settled 后运行态计入「已中断」。 */
function tallyGroup(parts: AgentPart[], settled?: boolean) {
  let running = 0;
  let failed = 0;
  let done = 0;
  let interrupted = 0;
  for (const part of parts) {
    const state = String(part.state ?? "");
    if (state === "output-error") {
      failed++;
    } else if (
      state.includes("streaming") ||
      state.includes("input") ||
      state === "call"
    ) {
      if (settled) interrupted++;
      else running++;
    } else {
      done++;
    }
  }
  return { running, failed, done, interrupted };
}

/** 单个工具调用行：图标 + 中文名 + 摘要 + 状态符号，点击展开详情。 */
function ToolGroupItem({
  part,
  settled,
}: {
  part: AgentPart;
  settled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const toolName = getToolName(part);
  const state = String(part.state ?? "");
  const live = isPartStreaming(part);
  const running = live && !settled;
  const interrupted = live && Boolean(settled);
  const failed = state === "output-error";
  const errorText = typeof part.errorText === "string" ? part.errorText : "";
  const input = formatJson(part.input);
  const output = formatJson(part.output);
  const label = TOOL_LABELS[toolName] ?? toolName;
  const hasDetail = Boolean(input || output || errorText);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-md border bg-muted/15",
        failed &&
          "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      )}
    >
      <CollapsibleTrigger
        hideIcon={!hasDetail}
        className="px-2.5 py-1.5 text-[11px] hover:bg-muted/40 rounded-md"
      >
        <span className="shrink-0">
          <ToolIcon name={toolName} />
        </span>
        <span className="shrink-0 font-medium">{label}</span>
        {interrupted && (
          <span className="shrink-0 text-muted-foreground">· 已中断</span>
        )}
        {!running && !interrupted && !failed && hasDetail && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {summarizeTool(toolName, part.output, part.errorText)}
          </span>
        )}
        {/* 右侧状态符号 */}
        {running ? (
          <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <X className="ml-auto h-3 w-3 shrink-0 text-red-600" />
        ) : interrupted ? (
          <CircleSlash className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          hasDetail && (
            <Check className="ml-auto h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )
        )}
      </CollapsibleTrigger>
      {hasDetail && (
        <CollapsibleContent>
          <div className="border-t border-border/60 px-2.5 py-2 space-y-2 text-[11px]">
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
                <div className="mb-1 font-medium text-red-600 dark:text-red-400">
                  错误
                </div>
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

/** data part 行（探索步骤 / 证据等）：紧凑一行摘要，无需展开。 */
function GroupDataItem({ part }: { part: AgentPart }) {
  const summary = summarizeDataPart(part);
  if (!summary) return null;
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-muted-foreground">
      <Check className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <span className="min-w-0 flex-1 truncate">{summary}</span>
    </div>
  );
}

/** 判断 part 是工具调用还是 data part。 */
function isToolPart(part: AgentPart): boolean {
  const type = String(part.type ?? "");
  return type.startsWith("tool-") || type === "dynamic-tool";
}

/**
 * 工具调用分组块：将连续的只读探索 / 网络搜索工具合并为一个可折叠组。
 * - 流式期间自动展开（除非用户手动操作过），结束后自动收起。
 * - 组标题显示图标 + 标题 + 步骤数 + 状态徽章 + 首条摘要。
 * - 组内每行一个 ToolGroupItem，可独立展开查看详情。
 */
export function ToolGroupBlock({
  parts,
  groupType,
  settled,
}: {
  parts: AgentPart[];
  groupType: "explore" | "web";
  /** 所属消息已定格（取消/出错/完成）：组内运行态收敛为「已中断」，不再自动展开/旋转。 */
  settled?: boolean;
}) {
  const streaming = isGroupStreaming(parts) && !settled;
  const [open, setOpen] = useState(false);
  const [userToggled, setUserToggled] = useState(false);

  // 流式期间自动展开（除非用户已手动操作过）；全部完成后自动收起。
  useEffect(() => {
    if (streaming && !userToggled) setOpen(true);
    if (!streaming && !userToggled) setOpen(false);
  }, [streaming, userToggled]);

  const { running, failed, done, interrupted } = tallyGroup(parts, settled);
  const title = GROUP_TITLE[groupType];
  const count = parts.length;

  // 收起态摘要：优先取第一条已完成的工具调用摘要；若无工具调用则取 data part 摘要。
  const completedTool = parts.find((p) => {
    if (!isToolPart(p)) return false;
    const state = String(p.state ?? "");
    return (
      state !== "output-error" &&
      !state.includes("streaming") &&
      !state.includes("input") &&
      state !== "call"
    );
  });
  const completedData = !completedTool
    ? parts.find((p) => !isToolPart(p) && summarizeDataPart(p))
    : undefined;
  const summaryText = completedTool
    ? summarizeTool(getToolName(completedTool), completedTool.output, completedTool.errorText)
    : completedData
      ? summarizeDataPart(completedData)
      : streaming
        ? "进行中…"
        : "";

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setUserToggled(true);
        setOpen(next);
      }}
      className="rounded-md border border-border bg-muted/40"
    >
      <CollapsibleTrigger className="px-2.5 py-2 text-[11px] hover:bg-muted/60 rounded-md">
        <GroupIcon groupType={groupType} />
        <span className="shrink-0 font-medium">
          {title} · {count} 步
        </span>
        {/* 状态徽章 */}
        <span className="flex shrink-0 items-center gap-1">
          {streaming && (
            <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-px text-[10px] text-primary">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {running > 0 ? `${running} 进行中` : "进行中"}
            </span>
          )}
          {!streaming && done > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-px text-[10px] text-emerald-700 dark:text-emerald-400">
              <Check className="h-2.5 w-2.5" />
              {done} 完成
            </span>
          )}
          {!streaming && interrupted > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
              <CircleSlash className="h-2.5 w-2.5" />
              {interrupted} 已中断
            </span>
          )}
          {failed > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded bg-red-500/10 px-1 py-px text-[10px] text-red-700 dark:text-red-400">
              <AlertCircle className="h-2.5 w-2.5" />
              {failed} 失败
            </span>
          )}
        </span>
        {!open && summaryText && (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {summaryText}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 border-t border-border/60 px-2 py-2">
          {parts.map((part, i) =>
            isToolPart(part) ? (
              <ToolGroupItem key={i} part={part} settled={settled} />
            ) : (
              <GroupDataItem key={i} part={part} />
            )
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
