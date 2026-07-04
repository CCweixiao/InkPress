import { getAlipayClient } from "./client";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("payment:alipay");

export interface PrecreateResult {
  /** 二维码链接（前端用 qrcode.react 渲染成图片） */
  qrCode: string;
}

/**
 * 调用 alipay.trade.precreate 生成扫码支付二维码。
 *
 * - totalAmount 单位为元（数字），调支付宝 API 时 toFixed(2) 转字符串
 * - notifyUrl 必须公网可达（生产 HTTPS，沙箱允许 HTTP）
 * - timeout_express=15m：超时后支付宝自动关单
 *
 * 错误统一抛 PAYMENT_PROVIDER_ERROR（HTTP 502），让上层返回「支付通道暂不可用」。
 */
export async function precreateOrder(opts: {
  outTradeNo: string;
  totalAmount: number; // 元
  subject: string;
  notifyUrl: string;
}): Promise<PrecreateResult> {
  const client = getAlipayClient();
  try {
    const result = await client.exec("alipay.trade.precreate", {
      notify_url: opts.notifyUrl,
      bizContent: {
        out_trade_no: opts.outTradeNo,
        total_amount: opts.totalAmount.toFixed(2),
        subject: opts.subject,
        timeout_express: "15m",
      },
    });

    // SDK 默认 camelcase=true，返回字段为 qrCode；老版本可能保留 qr_code
    const qrCode = (result.qrCode ?? result.qr_code) as string | undefined;
    if (!qrCode) {
      log.error(
        { code: result.code, msg: result.msg, subCode: result.sub_code },
        "支付宝 precreate 未返回二维码"
      );
      throw new AppError(
        ErrorCode.PAYMENT_PROVIDER_ERROR,
        "支付宝未返回二维码，请稍后重试"
      );
    }
    return { qrCode };
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error({ err, outTradeNo: opts.outTradeNo }, "支付宝 precreate 调用失败");
    throw new AppError(
      ErrorCode.PAYMENT_PROVIDER_ERROR,
      "支付通道暂不可用，请稍后重试"
    );
  }
}
