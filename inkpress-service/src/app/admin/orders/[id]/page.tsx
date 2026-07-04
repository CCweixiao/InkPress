import Link from "next/link";
import { getOrderAdmin } from "@/lib/payment/order-service";
import { OrderStatusBadge } from "@/components/payment/order-status-badge";
import { formatYuan } from "@/lib/payment/format";
import { formatDate } from "@/lib/utils";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getOrderAdmin(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/orders"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← 返回列表
        </Link>
      </div>

      <section className="rounded-lg border p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">订单详情</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
          <Field label="订单号" value={<code className="font-mono text-xs">{order.outTradeNo}</code>} />
          <Field label="支付宝流水号" value={<code className="font-mono text-xs">{order.tradeNo ?? "—"}</code>} />
          <Field label="套餐" value={order.planName} />
          <Field label="套餐 slug" value={order.planSlug} />
          <Field label="商品标题" value={order.subject} />
          <Field label="实付金额" value={formatYuan(order.amountCents)} />
          <Field label="买家账号" value={order.buyerLogonId ?? "—"} />
          <Field label="回调次数" value={String(order.notifyCount)} />
          <Field label="最近回调" value={order.lastNotifyAt ? formatDate(order.lastNotifyAt) : "—"} />
          <Field label="创建时间" value={formatDate(order.createdAt)} />
          <Field label="支付时间" value={order.paidAt ? formatDate(order.paidAt) : "—"} />
          <Field label="关闭时间" value={order.closedAt ? formatDate(order.closedAt) : "—"} />
          <Field label="下单 IP" value={order.createdIp ?? "—"} />
          <Field label="更新时间" value={formatDate(order.updatedAt)} />
        </dl>

        <div className="mt-4 border-t pt-4">
          <div className="text-xs text-muted-foreground">关联用户</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span>{order.user.email}</span>
            <Link
              href={`/admin/users/${order.user.id}`}
              className="text-xs text-primary hover:underline"
            >
              查看用户
            </Link>
          </div>
        </div>

        {order.licenseKeyId && (
          <div className="mt-4 border-t pt-4">
            <div className="text-xs text-muted-foreground">关联 License</div>
            <div className="mt-1">
              <Link
                href={`/admin/licenses/${order.licenseKeyId}`}
                className="text-sm text-primary hover:underline font-mono"
              >
                {order.licenseKeyId}
              </Link>
            </div>
          </div>
        )}

        <div className="mt-4 border-t pt-4">
          <div className="text-xs text-muted-foreground">套餐配置快照</div>
          <pre className="mt-1 overflow-x-auto rounded-md bg-muted/40 p-3 text-xs">
            {JSON.stringify(JSON.parse(order.planConfigJson), null, 2)}
          </pre>
        </div>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
