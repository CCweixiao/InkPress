"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Gauge, Sparkles } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ModelOption = { id: string; name: string; isDefault: boolean };
export type Provider = {
  id: string;
  name: string;
  models: ModelOption[];
  isDefault: boolean;
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
        const provider = list.find((item) => item.isDefault) ?? list[0];
        if (!provider) return;
        setProviderId(provider.id);
        setModelId(
          (provider.models.find((model) => model.isDefault) ??
            provider.models[0])?.id ?? ""
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function select(providerNext: string, modelNext: string) {
    setProviderId(providerNext);
    setModelId(modelNext);
  }

  return { providers, providerId, modelId, select };
}

/** 紧凑 token 格式：12300 → "12.3k" */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * 模型选择器：composer 底栏的单 chip，点击弹出按 provider 分组的模型列表。
 * 保留 provider×model 语义，收敛成单入口（Codex/Cursor 范式）。
 */
export function ModelSelector({
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
}

export type ContextUsage = {
  estimatedTokens: number;
  budgetTokens: number;
  compressed?: boolean;
  // 正文占用（data-context-usage 已下发；前端不直接渲染，仅供 /compact 后的即时覆盖计算）
  articleTokens?: number;
} | null;

export type LastTurnUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
} | null;

function occupancyTone(pct: number) {
  if (pct > 85) return { dot: "bg-red-500", bar: "bg-red-500", text: "text-red-600" };
  if (pct > 60) return { dot: "bg-amber-500", bar: "bg-amber-500", text: "text-amber-600" };
  return { dot: "bg-muted-foreground/50", bar: "bg-primary", text: "text-muted-foreground" };
}

/**
 * Token 计量：composer 底栏的 chip，显示上下文窗口占用（来自 data-context-usage）。
 * 点击弹出消耗面板：占用进度条 + 上一轮 input/output/reasoning + 模型 + 压缩状态。
 */
export function TokenMeter({
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
  const budget = contextUsage?.budgetTokens ?? 0;
  const pct = budget > 0 ? Math.min(100, Math.round((estimated / budget) * 100)) : 0;
  const tone = occupancyTone(pct);

  // 没有任何用量数据时不显示 chip（首次进入、未跑过）
  if (!contextUsage && !lastTurn) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="上下文与消耗"
          className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-[11px] hover:bg-accent"
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
          <Gauge className={cn("h-3 w-3", tone.text)} />
          {budget > 0 ? (
            <span className={tone.text}>
              {formatTokens(estimated)}/{formatTokens(budget)}
            </span>
          ) : (
            <span className="text-muted-foreground">{formatTokens(estimated)}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="text-xs font-semibold">上下文与消耗</div>
        {budget > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">窗口占用</span>
              <span className={tone.text}>{pct}%</span>
            </div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={tone.bar} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {estimated.toLocaleString()} / {budget.toLocaleString()} tokens
            </div>
          </div>
        )}
        {lastTurn && (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-[11px]">
            <span className="text-muted-foreground">上一轮输入</span>
            <span className="text-right">{lastTurn.inputTokens.toLocaleString()}</span>
            <span className="text-muted-foreground">上一轮输出</span>
            <span className="text-right">{lastTurn.outputTokens.toLocaleString()}</span>
            {lastTurn.reasoningTokens > 0 && (
              <>
                <span className="text-muted-foreground">思考</span>
                <span className="text-right">{lastTurn.reasoningTokens.toLocaleString()}</span>
              </>
            )}
            <span className="text-muted-foreground">合计</span>
            <span className="text-right font-medium">{lastTurn.totalTokens.toLocaleString()}</span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-[10px] text-muted-foreground">
          {modelName && <span>模型 {modelName}</span>}
          {contextUsage?.compressed && (
            <span className="text-amber-600">· 历史已压缩</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
