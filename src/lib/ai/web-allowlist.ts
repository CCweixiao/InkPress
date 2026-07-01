import { prisma } from "@/lib/db";
import type { WebUrlRiskAssessment } from "@/lib/ai/web-url-risk";

/**
 * web_fetch 域名白名单（P2.5）。用户长期信任的域名 → canUseTool 命中时自动放行（不弹审批卡）。
 * 全局用户级（WebFetchDomainAllowlist 表），非会话级。
 *
 * 域名匹配：normalizeDomain（小写 + 去 www. + 去路径/scheme）后**精确比较**。
 * 不做通配/子域递进（api.github.com ≠ github.com，需分别加）。
 */

/** 把用户输入归一化为裸域名：小写、去 scheme/path、去 www. 前缀。 */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  if (/^https?:\/\//.test(s)) {
    try {
      s = new URL(s).hostname;
    } catch {
      // 非法 URL，继续按裸串处理
    }
  }
  // 去端口 / 路径 / 查询（用户可能粘贴 "github.com/path" 或 "github.com:443"）
  s = s.split("/")[0].split(":")[0];
  // 去 www. 前缀
  s = s.replace(/^www\./, "");
  return s;
}

/** 校验归一化后的域名合法（含 TLD、无 IP、无非法字符）。 */
export function isValidDomain(domain: string): boolean {
  if (!domain || domain.startsWith(".") || domain.endsWith(".")) return false;
  // 至少一圆点 + 末段为字母 TLD（≥2）；整体仅小写字母/数字/连字符/点
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  return domain.split(".").every((part) => part.length > 0);
}

/** 域名是否在白名单（命中 → canUseTool 自动放行）。 */
export async function isDomainAllowed(domain: string): Promise<boolean> {
  const norm = normalizeDomain(domain);
  if (!norm) return false;
  const row = await prisma.webFetchDomainAllowlist.findUnique({
    where: { domain: norm },
    select: { id: true },
  });
  return !!row;
}

/** 分页 + 模糊搜索白名单。 */
export async function listAllowedDomains(opts: {
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const q = opts.q?.trim();
  const where = q ? { domain: { contains: q } } : {};
  const [items, total] = await Promise.all([
    prisma.webFetchDomainAllowlist.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, domain: true, note: true, riskJson: true, createdAt: true },
    }),
    prisma.webFetchDomainAllowlist.count({ where }),
  ]);
  return { items, total, page, pageSize, hasMore: page * pageSize < total };
}

/** 添加（或更新 note）白名单域名。域名非法抛错。返回归一化后的记录。 */
export async function addAllowedDomain(
  domain: string,
  note?: string,
  risk?: WebUrlRiskAssessment
): Promise<{ id: string; domain: string; note: string; riskJson: string }> {
  const norm = normalizeDomain(domain);
  if (!isValidDomain(norm)) {
    throw new Error(`域名格式无效：${domain}`);
  }
  const safeNote = typeof note === "string" ? note.trim().slice(0, 200) : "";
  const riskJson = risk ? JSON.stringify(risk).slice(0, 4000) : "{}";
  return prisma.webFetchDomainAllowlist.upsert({
    where: { domain: norm },
    update: { note: safeNote, riskJson },
    create: { domain: norm, note: safeNote, riskJson },
    select: { id: true, domain: true, note: true, riskJson: true },
  });
}

/** 按 id 删除白名单域名。 */
export async function removeAllowedDomain(id: string): Promise<void> {
  await prisma.webFetchDomainAllowlist.delete({ where: { id } });
}
