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

type TimelineItem = {
  key: string;
  title: string;
  detail: string;
  status: string;
  count?: number;
};

type ChildEvent = {
  title: string;
  detail: string;
  status: "running" | "completed" | "failed";
  toolName?: string;
};

const MAX_PROGRESS_DETAILS = 4;
const MAX_CHILD_EVENTS = 8;

export function getEffectiveTaskStatus(
  taskSteps: TaskStep[],
  settled?: boolean
) {
  const latest = taskSteps[taskSteps.length - 1];
  const terminal = [...taskSteps]
    .reverse()
    .find((step) => step.status === "completed" || step.status === "failed");
  if (terminal && latest?.status === "running") return terminal.status;
  if (latest?.status) return latest.status;
  return settled ? "completed" : "running";
}

export function getStepDisplayStatus(
  stepStatus: string,
  effectiveTaskStatus: string
) {
  if (stepStatus !== "running") return stepStatus;
  if (effectiveTaskStatus === "completed" || effectiveTaskStatus === "failed") {
    return effectiveTaskStatus;
  }
  return stepStatus;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueCompacted(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  let hidden = 0;
  for (const value of values) {
    const text = compactText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (result.length < limit) {
      result.push(text);
    } else {
      hidden += 1;
    }
  }
  return { result, hidden };
}

export function summarizeTaskTimeline(
  taskSteps: TaskStep[],
  effectiveTaskStatus: string
): TimelineItem[] {
  if (taskSteps.length === 0) return [];
  const items: TimelineItem[] = [];
  const first = taskSteps[0];
  const terminal = [...taskSteps]
    .reverse()
    .find((step) => step.status === "completed" || step.status === "failed");
  const progressSteps = taskSteps.filter(
    (step, index) => step.status === "running" && index > 0
  );

  items.push({
    key: "start",
    title: "任务",
    detail: first.detail,
    status: getStepDisplayStatus(first.status, effectiveTaskStatus),
  });

  if (progressSteps.length > 0) {
    const { result, hidden } = uniqueCompacted(
      progressSteps.map((step) => step.detail || shortTaskTitle(step.title)),
      MAX_PROGRESS_DETAILS
    );
    const detail = [
      ...result,
      ...(hidden > 0 ? [`另有 ${hidden} 类更新`] : []),
    ].join(" / ");
    items.push({
      key: "progress",
      title: effectiveTaskStatus === "running" ? "进度更新" : "过程摘要",
      detail,
      status:
        effectiveTaskStatus === "running"
          ? "running"
          : getStepDisplayStatus("running", effectiveTaskStatus),
      count: progressSteps.length,
    });
  }

  if (terminal) {
    items.push({
      key: "terminal",
      title: terminal.status === "failed" ? "收口失败" : "收口",
      detail: terminal.detail,
      status: terminal.status,
    });
  }

  return items;
}

export function summarizeChildEvents(events: ChildEvent[]) {
  const groups = new Map<string, ChildEvent & { count: number }>();
  for (const event of events) {
    const detail = compactText(event.detail);
    const key = `${event.title}\u0000${detail}\u0000${event.status}\u0000${event.toolName ?? ""}`;
    const prev = groups.get(key);
    if (prev) {
      prev.count += 1;
      continue;
    }
    groups.set(key, { ...event, detail, count: 1 });
  }
  const list = Array.from(groups.values());
  return {
    visible: list.slice(0, MAX_CHILD_EVENTS),
    hidden: Math.max(0, list.length - MAX_CHILD_EVENTS),
  };
}

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
): ChildEvent | null {
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
    const events = parts
      .filter((part) => !isTaskStep(part))
      .map((part) => childSummary(part, toolNameByCallId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    return events;
  }, [parts]);
  const compactChildEvents = useMemo(
    () => summarizeChildEvents(childEvents),
    [childEvents]
  );
  const latestTaskStep = taskSteps[taskSteps.length - 1];
  const terminalTaskStep = [...taskSteps]
    .reverse()
    .find((step) => step.status === "completed" || step.status === "failed");
  const rawLatest =
    terminalTaskStep && latestTaskStep?.status === "running"
      ? terminalTaskStep
      : (latestTaskStep ?? steps[steps.length - 1]);
  const effectiveTaskStatus = getEffectiveTaskStatus(taskSteps, settled);
  const timelineItems = useMemo(
    () => summarizeTaskTimeline(taskSteps, effectiveTaskStatus),
    [taskSteps, effectiveTaskStatus]
  );
  const latest = rawLatest
    ? { ...rawLatest, status: effectiveTaskStatus }
    : rawLatest;
  const running = effectiveTaskStatus === "running" && !settled;
  const failed = effectiveTaskStatus === "failed";
  const interrupted = effectiveTaskStatus === "running" && Boolean(settled);
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
          · {statusLabel(effectiveTaskStatus, settled)}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {summary}
        </span>
        <StatusIcon status={effectiveTaskStatus} settled={settled} className="ml-auto h-3 w-3 shrink-0" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-cyan-200 px-3 py-2 dark:border-cyan-900">
          <div className="text-[10px] text-muted-foreground">
            仅展示子 agent 调度过程；内部 token 流不注入主会话。
          </div>
          <ol className="space-y-1.5">
            {timelineItems.map((item) => {
              return (
              <li
                key={item.key}
                className="grid grid-cols-[14px_1fr] gap-2 text-[11px]"
              >
                <StatusIcon
                  status={item.status}
                  settled={settled}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">
                      {item.title}
                    </span>
                    {item.count && item.count > 1 ? (
                      <span className="rounded border border-cyan-200 px-1 text-[9px] leading-4 text-muted-foreground dark:border-cyan-900">
                        {item.count} 次
                      </span>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">
                      {statusLabel(item.status, settled)}
                    </span>
                  </div>
                  {item.detail ? (
                    <div className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
                      {item.detail}
                    </div>
                  ) : null}
                </div>
              </li>
              );
            })}
          </ol>
          {compactChildEvents.visible.length ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-muted-foreground">
                内部工具与资料
              </div>
              <ol className="space-y-1.5">
                {compactChildEvents.visible.map((event, index) => (
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
                        {event.count > 1 ? (
                          <span className="rounded border border-cyan-200 px-1 text-[9px] leading-4 text-muted-foreground dark:border-cyan-900">
                            {event.count} 次
                          </span>
                        ) : null}
                        <span className="text-[10px] text-muted-foreground">
                          {statusLabel(
                            event.status === "running" && !running
                              ? "completed"
                              : event.status,
                            settled
                          )}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate leading-5 text-muted-foreground">
                        {event.detail}
                      </div>
                    </div>
                  </li>
                ))}
                {compactChildEvents.hidden > 0 ? (
                  <li className="grid grid-cols-[14px_1fr] gap-2 text-[11px] text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <div className="leading-5">
                      还有 {compactChildEvents.hidden} 条相似记录已收起
                    </div>
                  </li>
                ) : null}
              </ol>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
