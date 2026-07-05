"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export interface CheckoutPlan {
  slug: string;
  name: string;
  tagline: string | null;
  durationKind: string;
  durationYears: number | null;
  maxDevices: number;
  priceCents: number;
}

interface CreatedOrder {
  orderId: string;
  outTradeNo: string;
  payUrl: string;
  amountCents: number;
  subject: string;
  expiresAt: string;
}

type Phase = "loading" | "pending" | "paid" | "error";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 收银台客户端：状态机 loading → pending → paid | error。
 *
 * - mount 时 POST /api/orders 创建订单（拿到支付宝跳转 URL）
 * - pending 阶段显示订单摘要 + 「去支付宝支付」按钮
 *   ├─ 用户点按钮 → window.location.href 跳走（PC 显示扫码，移动端唤起 App）
 *   └─ 用户支付完成 → 支付宝 GET return_url=/checkout/success?orderId=xxx
 * - 同时每 2s 轮询 GET /api/orders/:id 作兜底（用户若保留原标签页可直接跳转）
 * - 15 分钟未支付 → error
 */
export function CheckoutClient({
  plan,
  userEmail,
}: {
  plan: CheckoutPlan;
  userEmail: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(15 * 60);
  const createdRef = useRef(false);

  // 1. 创建订单
  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    (async () => {
      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planSlug: plan.slug }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          const code = data?.error?.code;
          setError(
            code === "PLAN_SOLD_OUT"
              ? "今日库存已售罄，请明天 0 点后再试"
              : (data?.error?.message ?? "创建订单失败")
          );
          setPhase("error");
          return;
        }
        setOrder(data.data as CreatedOrder);
        setPhase("pending");
      } catch {
        setError("网络错误，请刷新重试");
        setPhase("error");
      }
    })();
  }, [plan.slug]);

  // 2. 轮询订单状态（兜底：用户若保留原标签页可直接跳转）
  useEffect(() => {
    if (phase !== "pending" || !order) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${order.orderId}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok || !data.ok) return;
        if (data.data.status === "PAID") {
          clearInterval(timer);
          setPhase("paid");
          router.push(`/checkout/success?orderId=${order.orderId}`);
        }
      } catch {
        /* 单次轮询失败忽略，下次重试 */
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase, order, router]);

  // 3. 倒计时 + 超时
  useEffect(() => {
    if (phase !== "pending") return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, Math.ceil((TIMEOUT_MS - elapsed) / 1000));
      setRemainingSec(left);
      if (left <= 0) {
        clearInterval(timer);
        setError("支付超时，请重新下单");
        setPhase("error");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const amountYuan = (order?.amountCents ?? plan.priceCents) / 100;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <span className="text-base font-semibold">InkPress · 收银台</span>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            返回首页
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="grid gap-6 md:grid-cols-2">
          {/* 订单信息 */}
          <section className="rounded-xl border bg-card p-6">
            <h1 className="text-lg font-semibold">订单信息</h1>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="套餐" value={plan.name} />
              {plan.tagline && <Row label="副标题" value={plan.tagline} />}
              <Row label="设备数" value={`${plan.maxDevices} 台`} />
              <Row label="账号" value={userEmail} />
              <div className="border-t pt-3">
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted-foreground">应付金额</dt>
                  <dd className="text-2xl font-bold text-primary">
                    ¥{amountYuan.toFixed(2)}
                  </dd>
                </div>
              </div>
            </dl>
          </section>

          {/* 支付入口 / 状态 */}
          <section className="rounded-xl border bg-card p-6">
            {phase === "loading" && (
              <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                正在创建订单…
              </div>
            )}

            {phase === "pending" && order && (
              <div className="flex h-72 flex-col items-center justify-center gap-4">
                <div className="text-sm text-muted-foreground">
                  点击下方按钮跳转到支付宝完成支付
                </div>
                <Button
                  size="lg"
                  className="w-full max-w-xs"
                  onClick={() => {
                    window.location.href = order.payUrl;
                  }}
                >
                  去支付宝支付 ¥{amountYuan.toFixed(2)}
                </Button>
                <div className="text-xs text-muted-foreground">
                  剩余支付时间 {mm}:{ss}
                </div>
                <p className="max-w-xs text-center text-xs text-muted-foreground">
                  支付完成后将自动返回本站。如未自动跳转，点击下方按钮查询支付状态。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    router.push(`/checkout/success?orderId=${order.orderId}`)
                  }
                >
                  我已支付
                </Button>
              </div>
            )}

            {phase === "paid" && (
              <div className="flex h-72 items-center justify-center text-sm text-emerald-600">
                支付成功，正在跳转…
              </div>
            )}

            {phase === "error" && (
              <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm">
                <p className="text-destructive">{error ?? "支付失败"}</p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/">返回首页</Link>
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
