import { listAuditLogs } from "@/lib/admin/audit-service";
import { Pager } from "@/components/admin/pager";
import { AuditLogTable } from "@/components/admin/audit-log-table";

const PAGE_SIZE = 10;

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
          <option value="Plan">订阅计划</option>
          <option value="Order">订单</option>
        </select>
        <button className="h-9 rounded-md bg-primary px-4 text-primary-foreground">筛选</button>
      </form>

      <AuditLogTable items={items} />

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
