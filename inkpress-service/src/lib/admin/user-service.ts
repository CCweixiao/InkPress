import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";

const USER_PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  image: true,
  role: true,
  status: true,
  mustChangePassword: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export interface ListUsersParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  role?: string;
}

export async function listUsers(params: ListUsersParams) {
  const { page, pageSize, search, status, role } = params;
  const where = {
    AND: [
      status ? { status } : {},
      role ? { role } : {},
      search
        ? {
            OR: [
              { email: { contains: search } },
              { name: { contains: search } },
            ],
          }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        ...USER_PUBLIC_FIELDS,
        invitationCode: { select: { code: true, status: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...USER_PUBLIC_FIELDS,
      invitationCode: { select: { code: true, status: true } },
    },
  });
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, "用户不存在");
  return user;
}

export async function patchUser(
  id: string,
  patch: { status?: string; role?: string },
  actor: { id: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "用户不存在");

  const data: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (patch.status && patch.status !== existing.status) {
    data.status = patch.status;
    before.status = existing.status;
    after.status = patch.status;
  }
  if (patch.role && patch.role !== existing.role) {
    // 防止降级最后一个 ACTIVE 管理员造成无人可管
    if (existing.role === "ADMIN" && patch.role === "USER") {
      const adminCount = await prisma.user.count({
        where: { role: "ADMIN", status: "ACTIVE" },
      });
      if (adminCount <= 1) {
        throw new AppError(ErrorCode.FORBIDDEN, "至少需保留一名活跃管理员");
      }
    }
    data.role = patch.role;
    before.role = existing.role;
    after.role = patch.role;
  }

  if (Object.keys(data).length === 0) return getUser(id);

  await prisma.user.update({ where: { id }, data });
  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "user.update",
    targetType: "User",
    targetId: id,
    before: { email: existing.email, ...before },
    after,
    ip: actor.ip,
    userAgent: actor.ua,
  });
  return getUser(id);
}
