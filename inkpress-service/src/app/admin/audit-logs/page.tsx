import { listAuditLogs } from "@/lib/admin/audit-service";
import { Pager } from "@/components/admin/pager";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 30;

function shortJson(s: string | null): string {
  if (!s) return "—";
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const { items, total } = await listAuditLogs({
    page,
    pageSize: PAGE_SIZE,
    action: sp.action,
    targetType: sp.targetType,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">审计日志</h1>

      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
        <input
          name="action"
          defaultValue={sp.action ?? ""}
          placeholder="动作（如 license.create）"
          className="h-9 w-56 rounded-md border border-input bg-background px-3"
        />
        <select
          name="targetType"
          defaultValue={sp.targetType ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部对象</option>
          <option value="LicenseKey">License</option>
          <option value="LicenseActivation">激活设备</option>
          <option value="User">用户</option>
        </select>
        <button className="h-9 rounded-md bg-primary px-4 text-primary-foreground">筛选</button>
      </form>

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
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  暂无日志
                </td>
              </tr>
            )}
            {items.map((l) => (
              <tr key={l.id} className="border-t align-top">
                <td className="px-3 py-2 text-xs">{formatDate(l.createdAt)}</td>
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
                <td className="px-3 py-2 font-mono text-xs">{shortJson(l.afterJson)}</td>
                <td className="px-3 py-2 text-xs">{l.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/admin/audit-logs"
        searchParams={{ action: sp.action, targetType: sp.targetType }}
      />
    </div>
  );
}
