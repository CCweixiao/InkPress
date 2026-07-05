import { getAlipayClient } from "./client";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("payment:alipay");

export type PayChannel = "wap" | "page";

export interface PayUrlResult {
  /** 支付宝收银台跳转 URL（前端 window.location.href 过去） */
  payUrl: string;
  /** 实际使用的支付通道（便于审计与排障） */
  channel: PayChannel;
}

interface CreatePayUrlOpts {
  outTradeNo: string;
  totalAmount: number; // 元
  subject: string;
  notifyUrl: string;
  returnUrl: string;
  channel: PayChannel;
}

/**
 * 按设备分流生成支付宝收银台跳转 URL。
 *
 * - channel="page"（PC）→ alipay.trade.page.pay（电脑网站支付，product_code=FAST_INSTANT_TRADE_PAY）
 *   收银台原生渲染大二维码，用户扫码或登录支付宝账号付款
 * - channel="wap"（移动端）→ alipay.trade.wap.pay（手机网站支付，product_code=QUICK_WAP_WAY）
 *   收银台自动唤起支付宝 App
 *
 * 共同行为：
 * - 用户支付完成后，支付宝 GET return_url（仅做跳转，不可作为支付凭据）
 * - 真实支付状态由 notify_url 异步通知
 * - totalAmount 单位元，调 API 时 toFixed(2) 转字符串
 * - timeout_express=15m：超时后支付宝自动关单
 *
 * SDK 用法关键：pageExec 第二参必须显式传 "GET"，否则 AlipayFormData 默认 method=post，
 * 返回的是 <form> HTML 片段而非 URL（前端 window.location.href 赋值时会失败、无反应）。
 *
 * 错误统一抛 PAYMENT_PROVIDER_ERROR（HTTP 502），让上层返回「支付通道暂不可用」。
 */
export async function createPayUrl(
  opts: CreatePayUrlOpts
): Promise<PayUrlResult> {
  const client = getAlipayClient();
  const isWap = opts.channel === "wap";
  const method = isWap ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
  const productCode = isWap ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY";

  try {
    // pageExec 是同步方法（alipay-sdk v4 返回 string）；"GET" 让其拼接为 URL，而非 POST 表单 HTML
    const payUrl = client.pageExec(method, "GET", {
      notify_url: opts.notifyUrl,
      return_url: opts.returnUrl,
      bizContent: {
        out_trade_no: opts.outTradeNo,
        total_amount: opts.totalAmount.toFixed(2),
        subject: opts.subject,
        product_code: productCode,
        timeout_express: "15m",
      },
    });

    if (typeof payUrl !== "string" || !payUrl) {
      log.error(
        { outTradeNo: opts.outTradeNo, channel: opts.channel, got: typeof payUrl },
        "支付宝未返回跳转 URL"
      );
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        "支付宝未返回支付链接，请稍后重试"
      );
    }

    // 防御：URL 必须以 http(s):// 开头。SDK 配置异常或网关返回非 URL（如 HTML 表单、错误页）
    // 时，前端 window.location.href 会静默失败（用户看到「点击支付没反应」）
    if (!/^https?:\/\//i.test(payUrl)) {
      log.error(
        {
          outTradeNo: opts.outTradeNo,
          channel: opts.channel,
          payUrlHead: payUrl.slice(0, 120),
        },
        "支付宝返回值不是 http(s) URL（疑似 POST 表单 HTML 或网关错误页）"
      );
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        "支付通道返回异常，请稍后重试"
      );
    }

    log.info(
      { outTradeNo: opts.outTradeNo, channel: opts.channel },
      "支付宝跳转 URL 已生成"
    );
    return { payUrl, channel: opts.channel };
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error(
      { err, outTradeNo: opts.outTradeNo, channel: opts.channel },
      "支付宝跳转 URL 生成失败"
    );
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      "支付通道暂不可用，请稍后重试"
    );
  }
}

/**
 * 从 User-Agent 判断支付通道。
 *
 * - UA 缺失或无法识别 → 默认 "page"（PC 收银台渲染大二维码，移动端访问也不致命）
 * - 命中 Mobile/Android/iPhone/iPad/Windows Phone → "wap"
 * - 桌面浏览器 → "page"
 *
 * iPad（iPadOS 13+ 桌面 Safari UA）会被判为 "page"，体验正常（支付宝 PC 收银台）。
 */
export function detectPayChannel(ua: string | null | undefined): PayChannel {
  if (!ua) return "page";
  return /Mobile|Android|iPhone|iPod|Windows Phone|BlackBerry|SymbianOS|MicroMessenger/i.test(
    ua
  )
    ? "wap"
    : "page";
}
