import { getAlipayClient } from "./client";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("payment:alipay:verify");

/**
 * 验证支付宝异步通知签名（防伪造回调）。
 *
 * @param params 表单解析后的 key-value（含 sign/sign_type 之外的所有字段）
 * @returns 验签通过 true，失败/异常 false（异常一律当 false 处理，绝不放行）
 */
export function verifyNotifySign(params: Record<string, string>): boolean {
  try {
    const client = getAlipayClient();
    // checkNotifySignV2 不对 value 做 decode，适配大多数沙箱/生产回调
    return client.checkNotifySignV2(params);
  } catch (err) {
    log.warn({ err }, "支付宝回调验签异常，按失败处理");
    return false;
  }
}

export interface NotifyMerchantCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 回调归属校验：支付宝平台签名只证明“支付宝发出”，还必须确认通知属于本应用/本商户。
 * seller_id 默认可选，便于沙箱与小微账号先跑通；生产建议显式配置。
 */
export function verifyNotifyMerchant(params: Record<string, string>): NotifyMerchantCheck {
  const expectedAppId = process.env.ALIPAY_APP_ID?.trim();
  const expectedSellerId = process.env.ALIPAY_SELLER_ID?.trim();

  if (!expectedAppId) {
    return { ok: false, reason: "ALIPAY_APP_ID 未配置" };
  }
  if (params.app_id !== expectedAppId) {
    return { ok: false, reason: "app_id 不匹配" };
  }
  if (expectedSellerId && params.seller_id !== expectedSellerId) {
    return { ok: false, reason: "seller_id 不匹配" };
  }
  return { ok: true };
}
