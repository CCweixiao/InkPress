import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { truncateUa } from "@/lib/http";

const log = moduleLogger("license:validation-log");

export interface ValidationLogInput {
  licenseKeyId?: string | null;
  activationId?: string | null;
  deviceIdHash?: string | null;
  action: "ACTIVATE" | "VALIDATE" | "DEACTIVATE";
  result: "ALLOWED" | "DENIED" | "RATE_LIMITED" | "ERROR";
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
}

/**
 * 写 License 校验日志（PDC §9.4）。可异步、失败仅记录不抛，但错误必须可见。
 */
export async function writeValidationLog(
  input: ValidationLogInput
): Promise<void> {
  try {
    await prisma.licenseValidationLog.create({
      data: {
        licenseKeyId: input.licenseKeyId ?? null,
        activationId: input.activationId ?? null,
        deviceIdHash: input.deviceIdHash ?? null,
        action: input.action,
        result: input.result,
        reason: input.reason ?? null,
        ip: input.ip ?? null,
        userAgent: truncateUa(input.userAgent ?? null),
        appVersion: input.appVersion ?? null,
      },
    });
  } catch (err) {
    log.error({ err, action: input.action, result: input.result }, "校验日志写入失败");
  }
}

export interface ListValidationLogsOpts {
  licenseKeyId: string;
  page: number;
  pageSize: number;
  /** 仅返回最近 N 天内的记录；0 或不传 = 不加时间过滤 */
  days?: number;
}

export interface ListValidationLogsResult {
  items: Awaited<ReturnType<typeof prisma.licenseValidationLog.findMany>>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 分页查询某 License 的校验日志，按 createdAt 倒序。
 * 默认 days=3 仅返回最近 3 天数据，避免长尾查询。
 */
export async function listValidationLogs(
  opts: ListValidationLogsOpts
): Promise<ListValidationLogsResult> {
  const { licenseKeyId, page, pageSize, days } = opts;
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));

  const where: { licenseKeyId: string; createdAt?: { gte?: Date } } = {
    licenseKeyId,
  };
  if (days && days > 0) {
    const since = new Date(Date.now() - days * 86_400_000);
    where.createdAt = { gte: since };
  }

  const [items, total] = await Promise.all([
    prisma.licenseValidationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.licenseValidationLog.count({ where }),
  ]);

  return { items, total, page: safePage, pageSize: safePageSize };
}

// ===== TTL 清理：默认 3 天，超期自动 deleteMany =====

const LOG_RETENTION_DAYS = Math.max(
  0,
  Math.floor(Number(process.env.LICENSE_LOG_RETENTION_DAYS) || 3)
);
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

async function sweepExpiredLogs(): Promise<void> {
  if (LOG_RETENTION_DAYS <= 0) return;
  try {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86_400_000);
    const result = await prisma.licenseValidationLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      log.info({ count: result.count, cutoff }, "清理过期校验日志");
    }
  } catch (err) {
    log.warn({ err }, "清理过期校验日志失败（忽略）");
  }
}

if (process.env.NEXT_RUNTIME === "nodejs") {
  // 启动后 30s 跑一次初始清理，随后每 24h 一次
  const startTimer = setTimeout(() => void sweepExpiredLogs(), 30_000);
  startTimer.unref?.();
  const timer = setInterval(() => void sweepExpiredLogs(), SWEEP_INTERVAL_MS);
  timer.unref?.();
}
