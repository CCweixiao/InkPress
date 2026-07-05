"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";

interface LogItem {
  id: string;
  action: string;
  result: string;
  reason: string | null;
  ip: string | null;
  createdAt: string | Date;
}

interface LogsResponse {
  items: LogItem[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;
const DAYS = 3;

export function ValidationLogTable({ licenseId }: { licenseId: string }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // reloadSeq：刷新按钮触发，effect 依赖项之一
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const url =
          `/api/admin/licenses/${licenseId}/logs` +
          `?page=${page}&pageSize=${PAGE_SIZE}&days=${DAYS}`;
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body?.ok) {
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        setData(body.data as LogsResponse);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [licenseId, page, reloadSeq]);

  const refresh = useCallback(() => {
    setReloadSeq((n) => n + 1);
  }, []);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          仅显示最近 {DAYS} 天 · 共 {total} 条
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
        >
          <RotateCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">动作</th>
              <th className="px-3 py-2">结果</th>
              <th className="px-3 py-2">原因</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-destructive"
                >
                  {error}
                </td>
              </tr>
            ) : items.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  暂无日志
                </td>
              </tr>
            ) : (
              items.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {formatDate(l.createdAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.result}</td>
                  <td className="px-3 py-2 text-xs">{l.reason ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{l.ip ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            上一页
          </Button>
          <span className="text-muted-foreground">
            第 {page} / {pages} 页（共 {total} 条）
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages || loading}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
