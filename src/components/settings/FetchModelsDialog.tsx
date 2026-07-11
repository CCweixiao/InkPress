"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FetchedModel = { id: string; name: string };

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; models: FetchedModel[] };

/**
 * 从 Anthropic 兼容端点拉取模型列表，多选后导入到当前 provider。
 *
 * - Dialog 打开时自动发起拉取（省一次点击）。
 * - 已存在于当前 provider 的模型标灰不可选。
 * - 「全选」只作用于「未存在 + 被搜索命中」的项。
 * - 错误态显示消息 + 重试按钮。
 */
export function FetchModelsDialog({
  open,
  onOpenChange,
  providerName,
  baseUrl,
  apiKey,
  providerId,
  existingModelIds,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  /**
   * 已保存 provider 传 providerId：服务端从 DB 读解密后的明文 key，
   * 解决前端拿到的是脱敏占位符 "********" 无法发请求的问题。
   * 未保存 provider 不传，走 baseUrl + apiKey 直传。
   */
  providerId?: string;
  existingModelIds: Set<string>;
  onImport: (models: FetchedModel[]) => void;
}) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  /** 防止快速重开/关闭时的竞态：只接受最新一次请求的结果。 */
  const reqIdRef = useRef(0);

  const doFetch = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setState({ status: "loading" });
    setSelected(new Set());
    setQuery("");
    try {
      const payload = providerId
        ? { providerId }
        : { baseUrl, apiKey };
      const res = await fetch("/api/ai/models/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (reqId !== reqIdRef.current) return;
      const data = (await res.json()) as { models?: FetchedModel[]; error?: string };
      if (!res.ok) {
        setState({ status: "error", message: data?.error ?? "拉取失败。" });
        return;
      }
      const models = Array.isArray(data.models) ? data.models : [];
      setState({ status: "success", models });
    } catch {
      if (reqId !== reqIdRef.current) return;
      setState({ status: "error", message: "网络请求失败，请检查连接。" });
    }
  }, [baseUrl, apiKey, providerId]);

  // 打开时自动拉取；关闭时作废在途请求。
  useEffect(() => {
    if (open) {
      void doFetch();
    } else {
      reqIdRef.current++;
    }
  }, [open, doFetch]);

  const models = state.status === "success" ? state.models : [];
  const existingCount = models.filter((m) => existingModelIds.has(m.id)).length;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? models.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      )
    : models;
  const selectable = filtered.filter((m) => !existingModelIds.has(m.id));
  const allSelectableSelected =
    selectable.length > 0 && selectable.every((m) => selected.has(m.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableSelected) {
        for (const m of selectable) next.delete(m.id);
      } else {
        for (const m of selectable) next.add(m.id);
      }
      return next;
    });

  const handleImport = () => {
    if (state.status !== "success") return;
    const chosen = models.filter((m) => selected.has(m.id));
    if (chosen.length === 0) return;
    onImport(chosen);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>拉取模型 · {providerName}</DialogTitle>
          <DialogDescription className="truncate">
            从 {baseUrl} 的 /v1/models 端点获取可用模型列表
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在拉取模型列表…
          </div>
        )}

        {state.status === "error" && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-red-600">{state.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={doFetch}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        )}

        {state.status === "success" && (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索模型 id 或名称…"
                  className="h-9 pl-8"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleAll}
                disabled={selectable.length === 0}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {allSelectableSelected ? "取消全选" : "全选"}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              共 {models.length} 个，已配置 {existingCount} 个，当前选择 {selected.size} 个
            </div>
            <div className="max-h-80 space-y-0.5 overflow-y-auto rounded-md border p-1">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  没有匹配的模型
                </div>
              ) : (
                filtered.map((m) => {
                  const exists = existingModelIds.has(m.id);
                  const checked = selected.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={exists}
                      onClick={() => toggle(m.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                        exists
                          ? "cursor-not-allowed opacity-40"
                          : "hover:bg-accent",
                        !exists && checked && "bg-accent"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background"
                        )}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">
                          {m.id}
                        </span>
                        {m.name !== m.id && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.name}
                          </span>
                        )}
                      </span>
                      {exists && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          已配置
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={selected.size === 0}
          >
            导入选中（{selected.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
