import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { OrderStatusBadge } from "@/components/payment/order-status-badge";
import { formatDate } from "@/lib/utils";
import { formatYuan as durationYuan } from "@/lib/payment/format";

const PAGE_SIZE = 20;

/**
 * /dashboard/orders — 当前用户的订单历史。
 * 直接用 prisma 查（与 /api/me/orders 等价但 SSR 直出）。
 */
export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/orders");
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        outTradeNo: true,
        planSlug: true,
        planName: true,
        subject: true,
        amountCents: true,
        status: true,
        licenseKeyId: true,
        paidAt: true,
        createdAt: true,
      },
    }),
    prisma.order.count({ where: { userId: session.user.id } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-sm text-muted-foreground hover:underline"
            >
              ← Dashboard
            </Link>
            <span className="text-base font-semibold">我的订单</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">订单号</th>
                <th className="px-3 py-2">套餐</th>
                <th className="px-3 py-2">金额</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">创建</th>
                <th className="px-3 py-2">支付</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-10 text-center text-muted-foreground"
                  >
                    暂无订单，<Link href="/#pricing" className="text-primary hover:underline">去看看套餐</Link>
                  </td>
                </tr>
              )}
              {items.map((o) => (
                <tr key={o.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs">{o.outTradeNo}</td>
                  <td className="px-3 py-2">{o.planName}</td>
                  <td className="px-3 py-2">{durationYuan(o.amountCents)}</td>
                  <td className="px-3 py-2">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatDate(o.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {o.paidAt ? formatDate(o.paidAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {o.status === "PAID" && o.licenseKeyId ? (
                      <Link
                        href="/dashboard"
                        className="text-primary hover:underline"
                      >
                        查看 License
                      </Link>
                    ) : o.status === "PENDING" ? (
                      <Link
                        href={`/checkout?plan=${encodeURIComponent(o.planSlug)}`}
                        className="text-primary hover:underline"
                      >
                        去支付
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/dashboard/orders?page=${page - 1}`}
              className={`rounded-md border px-3 py-1 ${
                page <= 1 ? "pointer-events-none opacity-40" : ""
              }`}
            >
              上一页
            </Link>
            <span className="text-muted-foreground">
              {page} / {pages}（共 {total}）
            </span>
            <Link
              href={`/dashboard/orders?page=${page + 1}`}
              className={`rounded-md border px-3 py-1 ${
                page >= pages ? "pointer-events-none opacity-40" : ""
              }`}
            >
              下一页
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
