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
