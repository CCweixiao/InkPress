import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { durationLabel } from "@/lib/license/key";
import { Button } from "@/components/ui/button";
import { SuccessRevealKey } from "@/components/payment/success-reveal-key";
import { SuccessPoller } from "@/components/payment/success-poller";
import { formatDate } from "@/lib/utils";

/**
 * /checkout/success?orderId=xxx — 支付成功页。
 *
 * 校验：登录 + 订单归属当前用户。
 * - status=PAID → 显示成功 + License Key
 * - status=PENDING → 显示轮询器（return_url 早于 notify_url 时会落到这里）
 * - 其他状态/不存在/不属于自己 → notFound
 *
 * License Key 通过 SuccessRevealKey 复用 /api/me/owned-licenses/:id/reveal-key。
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const orderId = sp.orderId;
  if (!orderId) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/checkout/success?orderId=${orderId}`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      status: true,
      outTradeNo: true,
      planName: true,
      subject: true,
      amountCents: true,
      paidAt: true,
      licenseKeyId: true,
    },
  });

  // 不存在/不属于自己 → notFound（避免泄露订单存在性）
  if (!order || order.userId !== session.user.id) {
    notFound();
  }

  // PENDING：return_url 已到但 notify_url 还没到，显示轮询器
  if (order.status !== "PAID") {
    return (
      <div className="min-h-screen bg-muted/30">
        <header className="border-b bg-background">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
            <span className="text-base font-semibold">InkPress · 支付确认</span>
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              返回首页
            </Link>
          </div>
        </header>
        <SuccessPoller orderId={order.id} outTradeNo={order.outTradeNo} />
      </div>
    );
  }

  // 查关联 License（归属当前用户邮箱，reveal-key API 会再做归属校验）
  const license = order.licenseKeyId
    ? await prisma.licenseKey.findUnique({
        where: { id: order.licenseKeyId },
        select: {
          id: true,
          keyFingerprint: true,
          displayKeySuffix: true,
          durationKind: true,
          durationYears: true,
          durationDays: true,
          ownerEmail: true,
        },
      })
    : null;

  const amountYuan = (order.amountCents / 100).toFixed(2);
  const sessionEmail = session.user.email?.trim().toLowerCase();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <span className="text-base font-semibold">InkPress · 支付成功</span>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            返回首页
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        <section className="rounded-xl border bg-card p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold">支付成功</h1>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">套餐</dt>
              <dd className="mt-0.5 font-medium">{order.planName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">实付金额</dt>
              <dd className="mt-0.5 font-medium">¥{amountYuan}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">支付时间</dt>
              <dd className="mt-0.5 font-medium">
                {order.paidAt ? formatDate(order.paidAt) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">商品</dt>
              <dd className="mt-0.5 font-medium">{order.subject}</dd>
            </div>
          </dl>

          {license && license.ownerEmail === sessionEmail && (
            <div className="mt-6 border-t pt-6">
              <h2 className="mb-3 text-base font-semibold">你的 License Key</h2>
              <div className="space-y-3">
                <SuccessRevealKey licenseId={license.id} />
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-muted-foreground">
                  <div>
                    指纹：
                    <code className="font-mono">{license.keyFingerprint}</code>
                  </div>
                  <div>
                    后缀：
                    <code className="font-mono">…{license.displayKeySuffix}</code>
                  </div>
                  <div>
                    有效期：
                    {durationLabel(
                      license.durationKind,
                      license.durationYears,
                      license.durationDays
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 flex gap-3">
            <Button asChild>
              <Link href="/dashboard">前往 Dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard/orders">查看订单记录</Link>
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
