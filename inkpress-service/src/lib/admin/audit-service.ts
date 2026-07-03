import { prisma } from "@/lib/db";

export interface ListAuditLogsParams {
  page: number;
  pageSize: number;
  action?: string;
  targetType?: string;
  actorUserId?: string;
}

export async function listAuditLogs(params: ListAuditLogsParams) {
  const { page, pageSize, action, targetType, actorUserId } = params;
  const where = {
    AND: [
      action ? { action: { contains: action } } : {},
      targetType ? { targetType } : {},
      actorUserId ? { actorUserId } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
