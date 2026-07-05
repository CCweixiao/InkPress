"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 支付成功页轮询器：当支付宝 return_url 跳回早于 notify_url 时，
 * 订单可能还是 PENDING。本组件轮询 30 秒，PAID 后 router.refresh()
 * 触发 server component 重新渲染，显示 License。
 *
 * 失败/超时则提示用户联系客服（凭 outTradeNo 查询）。
 */
export function SuccessPoller({
  orderId,
  outTradeNo,
}: {
  orderId: string;
  outTradeNo: string;
}) {
  const router = useRouter();
  const [secs, setSecs] = useState(30);

  useEffect(() => {
    const countdown = setInterval(() => {
      setSecs((s) => Math.max(0, s - 1));
    }, 1000);

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, { cache: "no-store" });
        const data = await res.json();
        if (res.ok && data.ok && data.data.status === "PAID") {
          clearInterval(poll);
          clearInterval(countdown);
          router.refresh();
        }
      } catch {
        /* 单次失败忽略 */
      }
    }, 2000);

    return () => {
      clearInterval(poll);
      clearInterval(countdown);
    };
  }, [orderId, router]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <section className="rounded-xl border bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold">正在确认支付状态…</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          支付宝回调可能略有延迟，请稍候 {secs}s
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          订单号：<code className="font-mono">{outTradeNo}</code>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          若超过 1 分钟未更新，请凭订单号联系客服。
        </p>
      </section>
    </div>
  );
}
