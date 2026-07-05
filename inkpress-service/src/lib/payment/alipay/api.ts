import { getAlipayClient } from "./client";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("payment:alipay");

export interface WapPayResult {
  /** 支付宝收银台跳转 URL（前端 window.location.href 过去） */
  payUrl: string;
}

/**
 * 调用 alipay.trade.wap.pay 拿到收银台跳转 URL。
 *
 * - PC 端：跳到支付宝收银台，自动渲染二维码给用户扫
 * - 移动端：跳到收银台，自动唤起支付宝 App
 * - 用户支付完成后，支付宝 GET return_url（带 out_trade_no 等参数）
 * - 真实支付状态由 notify_url 异步通知（return_url 不可作为支付凭据）
 *
 * - product_code 固定 QUICK_WAP_WAY（手机网站支付的产品码；FAST_INSTANT_TRADE_PAY 是电脑网站支付）
 * - totalAmount 单位为元（数字），调支付宝 API 时 toFixed(2) 转字符串
 * - timeout_express=15m：超时后支付宝自动关单
 *
 * SDK 用法关键：pageExec 第二参必须显式传 "GET"，否则 AlipayFormData 默认 method=post，
 * 返回的是 <form> HTML 片段而非 URL（前端 window.location.href 赋值时会失败、无反应）。
 *
 * 错误统一抛 PAYMENT_PROVIDER_ERROR（HTTP 502），让上层返回「支付通道暂不可用」。
 */
export async function createWapPayUrl(opts: {
  outTradeNo: string;
  totalAmount: number; // 元
  subject: string;
  notifyUrl: string;
  returnUrl: string;
}): Promise<WapPayResult> {
  const client = getAlipayClient();
  try {
    // pageExec 是同步方法（alipay-sdk v4 返回 string）；"GET" 让其拼接为 URL，而非 POST 表单 HTML
    const payUrl = client.pageExec("alipay.trade.wap.pay", "GET", {
      notify_url: opts.notifyUrl,
      return_url: opts.returnUrl,
      bizContent: {
        out_trade_no: opts.outTradeNo,
        total_amount: opts.totalAmount.toFixed(2),
        subject: opts.subject,
        product_code: "QUICK_WAP_WAY",
        timeout_express: "15m",
      },
    });

    if (typeof payUrl !== "string" || !payUrl) {
      log.error(
        { outTradeNo: opts.outTradeNo, got: typeof payUrl },
        "支付宝 wap.pay 未返回跳转 URL"
      );
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        "支付宝未返回支付链接，请稍后重试"
      );
    }

    // 防御：URL 必须以 http(s):// 开头。SDK 配置异常或网关返回非 URL（如 HTML 表单）
    // 时，前端 window.location.href 会静默失败（用户看到「点击支付没反应」）
    if (!/^https?:\/\//i.test(payUrl)) {
      log.error(
        { outTradeNo: opts.outTradeNo, payUrlHead: payUrl.slice(0, 120) },
        "支付宝 wap.pay 返回值不是 http(s) URL（疑似 POST 表单 HTML 或网关错误页）"
      );
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        "支付通道返回异常，请稍后重试"
      );
    }

    return { payUrl };
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err, outTradeNo: opts.outTradeNo }, "支付宝 wap.pay 调用失败");
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      "支付通道暂不可用，请稍后重试"
    );
  }
}
