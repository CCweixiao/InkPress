import Link from "next/link";
import { listAdminTickets } from "@/lib/tickets/service";
import { Pager } from "@/components/admin/pager";
import { TicketStatusBadge } from "@/components/tickets/ticket-status-badge";
import { TICKET_TYPE_LABELS } from "@/lib/tickets/constants";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = sp.status;
  const type = sp.type;
  const q = sp.q;

  const { items, total } = await listAdminTickets({
    page,
    pageSize: PAGE_SIZE,
    status,
    type,
    q,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">工单管理</h1>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部状态</option>
          <option value="OPEN">待处理</option>
          <option value="ANSWERED">已回复</option>
          <option value="RESOLVED">已解决</option>
          <option value="CLOSED">已关闭</option>
        </select>
        <select
          name="type"
          defaultValue={type ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部类型</option>
          {Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="标题 / 描述"
          className="h-9 w-60 rounded-md border border-input bg-background px-3"
        />
        <button className="h-9 rounded-md bg-primary px-4 text-primary-foreground">
          筛选
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">工单号</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">类型</th>
              <th className="px-3 py-2">标题</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">最后更新</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  暂无工单
                </td>
              </tr>
            )}
            {items.map((t) => (
              <tr key={t.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">
                  #{t.id.slice(-8)}
                </td>
                <td className="px-3 py-2 text-xs">{t.user.email}</td>
                <td className="px-3 py-2 text-xs">
                  {TICKET_TYPE_LABELS[t.type] ?? t.type}
                </td>
                <td className="px-3 py-2 max-w-xs truncate">{t.subject}</td>
                <td className="px-3 py-2">
                  <TicketStatusBadge status={t.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {formatDate(t.updatedAt)}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/tickets/${t.id}`}
                    className="text-primary hover:underline"
                  >
                    详情
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        basePath="/admin/tickets"
        searchParams={{ status, type, q }}
      />
    </div>
  );
}
