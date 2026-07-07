"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Gauge, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ModelOption = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
};
export type Provider = {
  id: string;
  name: string;
  models: ModelOption[];
};

/** 供应商/模型选择状态：拉取 /api/ai/providers，管理 providerId + modelId。 */
export function useModelSelection() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/ai/providers")
      .then((response) => response.json())
      .then((data: { providers: Provider[] }) => {
        if (!active) return;
        const list = data.providers ?? [];
        setProviders(list);
        if (!list.length) return;
        // default 现在是「全局唯一默认模型」（跨供应商）：扫描全部启用模型。
        let nextProviderId = list[0].id;
        let nextModelId = list[0].models[0]?.id ?? "";
        for (const provider of list) {
          const def = provider.models.find((model) => model.isDefault);
          if (def) {
            nextProviderId = provider.id;
            nextModelId = def.id;
            break;
          }
        }
        setProviderId(nextProviderId);
        setModelId(nextModelId);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // useCallback：select 作为 ModelSelector 的 onSelect 传入，稳定引用让 memo 生效（流式期间不重渲染）。
  const select = useCallback((providerNext: string, modelNext: string) => {
    setProviderId(providerNext);
    setModelId(modelNext);
  }, []);

  return { providers, providerId, modelId, select };
}

/** 紧凑 token 格式：12300 → "12.3k" */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** 估算成本格式：< 0.01 用 4 位小数，否则 2 位。 */
export function formatCost(usd: number): string {
  if (usd <= 0) return "";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * 模型选择器：composer 底栏的单 chip，点击弹出按 provider 分组的模型列表。
 * 保留 provider×model 语义，收敛成单入口（Codex/Cursor 范式）。
 */
// memo：composer 每 ~50ms 流式 chunk 重渲染，但 ModelSelector 的 props（providers/providerId/modelId/selectModel）
// 在流式期间稳定 → memo 让它跳过重渲染，减少底栏无谓 diff。
export const ModelSelector = memo(function ModelSelector({
  providers,
  providerId,
  modelId,
  onSelect,
}: {
  providers: Provider[];
  providerId: string;
  modelId: string;
  onSelect: (providerId: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeProvider = providers.find((item) => item.id === providerId);
  const activeModel = activeProvider?.models.find((item) => item.id === modelId);
  const label = activeModel?.name ?? modelId ?? "选择模型";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={providers.length === 0}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
        >
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="max-w-[110px] truncate">{label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-1">
        {providers.map((provider) => (
          <div key={provider.id} className="mb-0.5">
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {provider.name}
            </div>
            {provider.models.map((model) => {
              const active = provider.id === providerId && model.id === modelId;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelect(provider.id, model.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-[11px] hover:bg-accent",
                    active && "bg-accent font-medium"
                  )}
                >
                  <span className="truncate">{model.name}</span>
                  {active && <Check className="h-3 w-3 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
});

export type ContextUsage = {
  estimatedTokens: number;
  compressed?: boolean;
  budgetTokens?: number;
  compactPreTokens?: number;
  compactPostTokens?: number;
  compactTrigger?: "auto" | "manual";
  compactDurationMs?: number;
  // 正文占用（data-context-usage 已下发；前端不直接渲染，仅供内部估算）
  articleTokens?: number;
} | null;

export type LastTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
} | null;

function contextTone(contextUsage: ContextUsage) {
  if (contextUsage?.compressed) {
    return { dot: "bg-sky-500", icon: "text-sky-600 dark:text-sky-400" };
  }
  return { dot: "bg-muted-foreground/50", icon: "text-muted-foreground" };
}

/** 格式化 token 数：≥1000 用 k 后缀（1 位小数），否则原样。 */
function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Token 计量：composer 底栏的统一入口。
 * 语义只保留两层：当前上下文规模 + 最近一轮模型消耗。
 */
// memo + 稳定引用 props：流式期间 contextUsage/lastTurn/modelName 引用稳定（见 WritingAssistant 的
// latestContextUsage 叶子 memoize）→ TokenMeter 跳过重渲染，避免底栏数字宽度变化触发 composer 回流。
export const TokenMeter = memo(function TokenMeter({
  contextUsage,
  lastTurn,
  modelName,
}: {
  contextUsage: ContextUsage;
  lastTurn: LastTurnUsage;
  modelName?: string;
}) {
  const [open, setOpen] = useState(false);
  const estimated = contextUsage?.estimatedTokens ?? 0;
  const compactPre = contextUsage?.compactPreTokens;
  const compactPost = contextUsage?.compactPostTokens;
  const tone = contextTone(contextUsage);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Token 用量"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background hover:bg-accent"
        >
          <Gauge className={cn("h-3.5 w-3.5", tone.icon)} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="text-xs font-semibold">Token 用量</div>
        {estimated > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                当前上下文
              </span>
              <span className="font-medium">{fmtTokens(estimated)}</span>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              发送给模型的上下文规模估算；不是已花费 token，也不是最大窗口。
            </div>
          </div>
        )}
        {contextUsage?.compressed && (
          <div className="mt-2 rounded-md border bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <div className="font-medium">Claude Agent 已自动压缩上下文</div>
            <div className="mt-1 text-sky-700 dark:text-sky-300">
              {typeof compactPre === "number" && typeof compactPost === "number"
                ? `${fmtTokens(compactPre)} → ${fmtTokens(compactPost)} tokens`
                : "SDK 已整理早期历史，后续会话将基于压缩后的摘要继续"}
            </div>
          </div>
        )}
        {lastTurn && (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-[11px]">
            <span className="text-muted-foreground">最近一轮输入</span>
            <span className="text-right">{fmtTokens(lastTurn.inputTokens)}</span>
            <span className="text-muted-foreground">最近一轮输出</span>
            <span className="text-right">{fmtTokens(lastTurn.outputTokens)}</span>
            {lastTurn.reasoningTokens > 0 && (
              <>
                <span className="text-muted-foreground">思考</span>
                <span className="text-right">{fmtTokens(lastTurn.reasoningTokens)}</span>
              </>
            )}
            <span className="text-muted-foreground">最近一轮消耗</span>
            <span className="text-right font-medium">{fmtTokens(lastTurn.totalTokens)}</span>
            <div className="col-span-2 text-[10px] text-muted-foreground">
              消耗 = 该轮模型实际报告的输入 + 输出 + 思考 token。
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-[10px] text-muted-foreground">
          {modelName && <span>模型 {modelName}</span>}
        </div>
      </PopoverContent>
    </Popover>
  );
});
