"use client";

import { Fragment, useState } from "react";
import { formatDate } from "@/lib/utils";

interface AuditLogItem {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date | string;
}

function shortJson(s: string | null): string {
  if (!s) return "—";
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

function prettyJson(s: string | null): string {
  if (!s) return "—";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function AuditLogTable({ items }: { items: AuditLogItem[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">时间</th>
              <th className="px-3 py-2">操作者</th>
              <th className="px-3 py-2">动作</th>
              <th className="px-3 py-2">对象</th>
              <th className="px-3 py-2">变更后</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                暂无日志
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">时间</th>
            <th className="px-3 py-2">操作者</th>
            <th className="px-3 py-2">动作</th>
            <th className="px-3 py-2">对象</th>
            <th className="px-3 py-2">变更后</th>
            <th className="px-3 py-2">IP</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((l) => {
            const isOpen = expanded.has(l.id);
            return (
              <Fragment key={l.id}>
                <tr className="border-t align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{formatDate(l.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-mono">{l.actorUserId?.slice(0, 8) ?? "system"}</div>
                    <div className="text-muted-foreground">{l.actorRole ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.targetType ?? "—"}
                    {l.targetId && (
                      <div className="font-mono text-muted-foreground">{l.targetId.slice(0, 8)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs max-w-[240px] truncate">
                    {shortJson(l.afterJson)}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{l.ip ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggle(l.id)}
                      className="rounded-md border border-input px-2 py-0.5 hover:bg-muted"
                    >
                      {isOpen ? "收起" : "详情"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t bg-muted/30">
                    <td colSpan={7} className="px-3 py-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-semibold text-muted-foreground">
                            变更前 (before)
                          </div>
                          <pre className="max-h-80 overflow-auto rounded-md border bg-background p-2 text-xs leading-relaxed">
                            {prettyJson(l.beforeJson)}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold text-muted-foreground">
                            变更后 (after)
                          </div>
                          <pre className="max-h-80 overflow-auto rounded-md border bg-background p-2 text-xs leading-relaxed">
                            {prettyJson(l.afterJson)}
                          </pre>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                        <span>日志 ID: <span className="font-mono">{l.id}</span></span>
                        <span>操作者 ID: <span className="font-mono">{l.actorUserId ?? "—"}</span></span>
                        <span>对象 ID: <span className="font-mono">{l.targetId ?? "—"}</span></span>
                        <span>User-Agent: <span className="font-mono">{l.userAgent ?? "—"}</span></span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
