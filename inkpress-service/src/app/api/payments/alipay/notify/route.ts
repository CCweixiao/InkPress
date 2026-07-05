import { NextRequest } from "next/server";
import {
  verifyNotifyMerchant,
  verifyNotifySign,
} from "@/lib/payment/alipay/verify";
import { fulfillOrderIfPending } from "@/lib/payment/order-service";
import { checkRateLimits, type RateLimitRule } from "@/lib/rate-limit";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("payment:alipay:notify");

const NOTIFY_RULE: RateLimitRule = { windowSec: 60, max: 30 };

/**
 * POST /api/payments/alipay/notify — 支付宝异步回调（核心安全环节）。
 *
 * - 公开端点，无 session，靠验签防伪
 * - formData 解析 → verifyNotifySign → trade_status 过滤 → fulfillOrderIfPending
 * - 返回纯文本 "success"/"fail"（支付宝约定）
 *
 * 安全要点：
 * - 验签失败一律 fail
 * - 已 PAID 幂等返回 success
 * - 金额不匹配返回 fail（支付宝会重试，便于排障）
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      params[k] = String(v);
    }

    const outTradeNo = params.out_trade_no ?? "unknown";
    const tradeStatus = params.trade_status ?? "";

    // 放宽限流：按 outTradeNo 30/min，避免拦沙箱重试
    const decision = checkRateLimits([
      { key: `alipay:notify:outTradeNo:1m:${outTradeNo}`, rule: NOTIFY_RULE },
    ]);
    if (!decision.allowed) {
      log.warn({ outTradeNo }, "支付宝回调限流命中");
      return new Response("success", { status: 200 });
    }

    // 1. 验签（防伪造）
    if (!verifyNotifySign(params)) {
      log.warn({ outTradeNo }, "支付宝回调验签失败");
      return new Response("fail", { status: 200 });
    }

    const merchant = verifyNotifyMerchant(params);
    if (!merchant.ok) {
      log.warn({ outTradeNo, reason: merchant.reason }, "支付宝回调归属校验失败");
      return new Response("fail", { status: 200 });
    }

    // 2. 只处理最终成功状态；WAIT_BUYER_PAY / TRADE_CLOSED 直接 ack
    if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") {
      log.info({ outTradeNo, tradeStatus }, "回调非成功状态，直接 ack");
      return new Response("success", { status: 200 });
    }

    const tradeNo = params.trade_no ?? "";
    const totalAmount = params.total_amount ?? "";
    const buyerLogonId = params.buyer_logon_id;
    if (!tradeNo || !/^\d+(\.\d{1,2})?$/.test(totalAmount)) {
      log.warn({ outTradeNo, tradeNoPresent: Boolean(tradeNo), totalAmount }, "支付宝成功回调字段缺失");
      return new Response("fail", { status: 200 });
    }

    // 3. 幂等 + 金额校验 + 发券（事务）
    try {
      await fulfillOrderIfPending({
        outTradeNo,
        tradeNo,
        totalAmountYuan: totalAmount,
        buyerLogonId,
      });
      return new Response("success", { status: 200 });
    } catch (err) {
      log.error({ outTradeNo, err }, "回调处理失败，返回 fail 让支付宝重试");
      return new Response("fail", { status: 200 });
    }
  } catch (err) {
    log.error({ err }, "支付宝回调解析异常");
    return new Response("fail", { status: 200 });
  }
}
