"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleSlash,
  Loader2,
  MessagesSquare,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  TOOL_LABELS,
  ToolIcon,
  getToolDisplay,
  getToolName,
  summarizeDataPart,
  summarizeTool,
} from "@/components/ai/tool-helpers";

type AgentPart = Record<string, unknown>;

type TaskStep = {
  title: string;
  detail: string;
  status: string;
  subagentType: string;
};

function stepFromPart(part: AgentPart): TaskStep {
  const data =
    part.data && typeof part.data === "object"
      ? (part.data as Record<string, unknown>)
      : {};
  return {
    title: String(data.title ?? "子任务"),
    detail: data.detail ? String(data.detail) : "",
    status: String(data.status ?? "completed"),
    subagentType: String(data.subagentType ?? ""),
  };
}

function isTaskStep(part: AgentPart) {
  return part.type === "data-agent-step";
}

function childSummary(
  part: AgentPart,
  toolNameByCallId: Map<string, string>
): {
  title: string;
  detail: string;
  status: "running" | "completed" | "failed";
  toolName?: string;
} | null {
  const type = String(part.type ?? "");
  if (type === "source-url" && typeof part.url === "string") {
    return {
      title: "资料线索",
      detail: String(part.title ?? part.url),
      status: "completed",
    };
  }
  if (type.startsWith("data-")) {
    const summary = summarizeDataPart(part);
    if (!summary) return null;
    return { title: "资料线索", detail: summary, status: "completed" };
  }
  const toolCallId =
    typeof part.toolCallId === "string" ? part.toolCallId : "";
  const toolName = getToolName(part) || toolNameByCallId.get(toolCallId) || "";
  if (!toolName) return null;
  const label = TOOL_LABELS[toolName] ?? toolName;
  if (toolCallId && toolName) toolNameByCallId.set(toolCallId, toolName);

  if (type === "tool-input-available") {
    const input = part.input as Record<string, unknown> | undefined;
    const query =
      input && typeof input === "object"
        ? String(input.query ?? input.url ?? input.path ?? "").trim()
        : "";
    return {
      title: label,
      detail: query ? `开始：${query}` : "开始执行",
      status: "running",
      toolName,
    };
  }
  if (type === "tool-output-error") {
    return {
      title: label,
      detail:
        typeof part.errorText === "string" ? part.errorText : "工具执行失败",
      status: "failed",
      toolName,
    };
  }
  if (type === "tool-output-available") {
    return {
      title: label,
      detail: summarizeTool(toolName, part.output, undefined, getToolDisplay(part)),
      status: "completed",
      toolName,
    };
  }
  return null;
}

function statusLabel(status: string, settled?: boolean) {
  if (status === "running" && settled) return "已中断";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "完成";
}

function StatusIcon({
  status,
  settled,
  className,
}: {
  status: string;
  settled?: boolean;
  className?: string;
}) {
  if (status === "running" && !settled) {
    return <Loader2 className={cn("animate-spin text-primary", className)} />;
  }
  if (status === "failed") {
    return <X className={cn("text-red-600 dark:text-red-400", className)} />;
  }
  if (status === "running" && settled) {
    return <CircleSlash className={cn("text-muted-foreground", className)} />;
  }
  return <Check className={cn("text-emerald-600 dark:text-emerald-400", className)} />;
}

function shortTaskTitle(value: string) {
  return value.replace(/^子任务(启动|进行中|完成|失败)（(.+)）$/, "$1");
}

/**
 * 子 agent 过程面板。
 *
 * 主会话不转发子 agent token 流；这里仅展示 SDK task_* 事件形成的旁路时间线。
 */
export function SubAgentTaskBlock({
  parts,
  settled,
}: {
  parts: AgentPart[];
  settled?: boolean;
}) {
  const steps = useMemo(() => parts.map(stepFromPart), [parts]);
  const taskSteps = useMemo(() => parts.filter(isTaskStep).map(stepFromPart), [parts]);
  const childEvents = useMemo(() => {
    const toolNameByCallId = new Map<string, string>();
    return parts
      .filter((part) => !isTaskStep(part))
      .map((part) => childSummary(part, toolNameByCallId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [parts]);
  const latest = taskSteps[taskSteps.length - 1] ?? steps[steps.length - 1];
  const running = latest?.status === "running" && !settled;
  const failed = latest?.status === "failed";
  const interrupted = latest?.status === "running" && Boolean(settled);
  const subagentType =
    [...steps].reverse().find((step) => step.subagentType)?.subagentType ||
    "subagent";
  const summary =
    latest?.detail ||
    (running ? "子 agent 正在处理任务" : "子 agent 已返回结论");
  const [open, setOpen] = useState(false);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (running && !userToggled) setOpen(true);
    if (!running && !userToggled) setOpen(false);
  }, [running, userToggled]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setUserToggled(true);
        setOpen(next);
      }}
      className={cn(
        "rounded-md border bg-cyan-50/55 dark:bg-cyan-950/25",
        failed
          ? "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/35"
          : "border-cyan-200 dark:border-cyan-900"
      )}
    >
      <CollapsibleTrigger className="px-2.5 py-2 text-[11px] hover:bg-cyan-100/50 rounded-md dark:hover:bg-cyan-900/35">
        <MessagesSquare
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            failed ? "text-red-600 dark:text-red-400" : "text-cyan-700 dark:text-cyan-300"
          )}
        />
        <span className="shrink-0 font-medium">
          子 agent：{subagentType}
        </span>
        <span className="shrink-0 text-muted-foreground">
          · {statusLabel(latest?.status ?? "completed", settled)}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {summary}
        </span>
        <StatusIcon status={latest?.status ?? "completed"} settled={settled} className="ml-auto h-3 w-3 shrink-0" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-cyan-200 px-3 py-2 dark:border-cyan-900">
          <div className="text-[10px] text-muted-foreground">
            仅展示子 agent 调度过程；内部 token 流不注入主会话。
          </div>
          <ol className="space-y-1.5">
            {taskSteps.map((step, index) => (
              <li
                key={`${step.title}-${index}`}
                className="grid grid-cols-[14px_1fr] gap-2 text-[11px]"
              >
                <StatusIcon
                  status={step.status}
                  settled={settled}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">
                      {shortTaskTitle(step.title)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {statusLabel(step.status, settled)}
                    </span>
                  </div>
                  {step.detail ? (
                    <div className="mt-0.5 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
                      {step.detail}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {childEvents.length ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-muted-foreground">
                内部工具与资料
              </div>
              <ol className="space-y-1.5">
                {childEvents.map((event, index) => (
                  <li
                    key={`${event.title}-${index}`}
                    className="grid grid-cols-[14px_1fr] gap-2 text-[11px]"
                  >
                    <span className="mt-0.5 text-cyan-700 dark:text-cyan-300">
                      {event.toolName ? (
                        <ToolIcon name={event.toolName} />
                      ) : (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{event.title}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {statusLabel(event.status)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate leading-5 text-muted-foreground">
                        {event.detail}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
