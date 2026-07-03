import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import { truncateUa } from "@/lib/http";

const log = moduleLogger("audit");

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
 */
export async function writeAudit(input: AuditInput): Promise<void> {
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
