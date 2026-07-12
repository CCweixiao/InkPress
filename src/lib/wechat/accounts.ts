import { prisma } from "@/lib/db";
import { decryptConfigValueForUse } from "@/lib/config-secrets";
import { encryptSecret } from "@/lib/crypto/secret-store";
import { WECHAT_CONFIG_KEY, parseWechatConfig } from "./config";

/** 首次升级时把旧的单公众号配置复制为默认账号；保留旧配置以便可安全回退。 */
export async function migrateLegacyWechatAccount(): Promise<void> {
  const existing = await prisma.wechatAccount.count();
  if (existing) return;
  const legacy = await prisma.systemConfig.findUnique({ where: { key: WECHAT_CONFIG_KEY } });
  if (!legacy) return;
  try {
    const config = parseWechatConfig(decryptConfigValueForUse(WECHAT_CONFIG_KEY, legacy.value) ?? legacy.value);
    await prisma.wechatAccount.create({
      data: { name: "默认公众号", appId: config.appId, secret: encryptSecret(config.secret), isDefault: true },
    });
  } catch {
    // 历史配置非法时不阻断应用启动，设置页会提示重新添加。
  }
}

export async function getDefaultWechatAccountId(): Promise<string | null> {
  const account = await prisma.wechatAccount.findFirst({
    where: { status: "active" }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true },
  });
  return account?.id ?? null;
}
