import Link from "next/link";
import { listAllOrders } from "@/lib/payment/order-service";
import { Pager } from "@/components/admin/pager";
import { OrderStatusBadge } from "@/components/payment/order-status-badge";
import { formatYuan } from "@/lib/payment/format";
import { formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const status = sp.status;
  const search = sp.search;

  const { items, total } = await listAllOrders({
    page,
    pageSize: PAGE_SIZE,
    status,
    search,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">订单管理</h1>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-9 rounded-md border border-input bg-background px-2"
        >
          <option value="">全部状态</option>
          <option value="PENDING">待支付</option>
          <option value="PAID">已支付</option>
          <option value="CLOSED">已关闭</option>
          <option value="REFUNDED">已退款</option>
        </select>
        <input
          name="search"
          defaultValue={search ?? ""}
          placeholder="订单号 / 流水号 / 套餐 / 用户邮箱"
          className="h-9 w-72 rounded-md border border-input bg-background px-3"
        />
        <button className="h-9 rounded-md bg-primary px-4 text-primary-foreground">
          筛选
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">订单号</th>
              <th className="px-3 py-2">用户</th>
              <th className="px-3 py-2">套餐</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">支付时间</th>
              <th className="px-3 py-2">License</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  暂无订单
                </td>
              </tr>
            )}
            {items.map((o) => (
              <tr key={o.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{o.outTradeNo}</td>
                <td className="px-3 py-2 text-xs">{o.user.email}</td>
                <td className="px-3 py-2">{o.planName}</td>
                <td className="px-3 py-2">{formatYuan(o.amountCents)}</td>
                <td className="px-3 py-2">
                  <OrderStatusBadge status={o.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {o.paidAt ? formatDate(o.paidAt) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">
                  {o.licenseKeyId ? (
                    <Link
                      href={`/admin/licenses/${o.licenseKeyId}`}
                      className="text-primary hover:underline font-mono"
                    >
                      {o.licenseKeyId.slice(-6)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/orders/${o.id}`}
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
        basePath="/admin/orders"
        searchParams={{ status, search }}
      />
    </div>
  );
}
