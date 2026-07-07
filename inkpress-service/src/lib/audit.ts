import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { truncateUa } from "@/lib/http";

const log = moduleLogger("audit");

/**
 * 紧急关停开关（缓解 SQLite IO 压力 / IOPS 上限）：
 * AUDIT_LOG_DISABLE=true 时完全跳过所有审计写入，不阻断主业务。
 * 默认 false（保留审计）。
 */
const AUDIT_DISABLED = process.env.AUDIT_LOG_DISABLE === "true";

export interface AuditInput {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * 写审计日志。失败仅记录不抛出（不阻断主业务），但错误必须可见（PDC §9.4）。
 *
 * 注：AUDIT_LOG_DISABLE=true 时直接 no-op，紧急情况可立即停写。
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  if (AUDIT_DISABLED) return;
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        beforeJson:
          input.before !== undefined ? safeStringify(input.before) : null,
        afterJson:
          input.after !== undefined ? safeStringify(input.after) : null,
        ip: input.ip ?? null,
        userAgent: truncateUa(input.userAgent ?? null),
      },
    });
  } catch (err) {
    log.error({ err, action: input.action }, "审计写入失败");
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
