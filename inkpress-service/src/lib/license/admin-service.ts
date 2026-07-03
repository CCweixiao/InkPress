import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import {
  generateLicenseKey,
  durationLabel,
} from "@/lib/license/key";
import type { LicenseDurationKind } from "@/lib/validation/schemas";

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

/** License 列表/详情统一对外字段（剔除 keyHash） */
const LICENSE_PUBLIC_FIELDS = {
  id: true,
  displayKeySuffix: true,
  keyFingerprint: true,
  durationKind: true,
  durationYears: true,
  durationDays: true,
  effectiveExpiresAt: true,
  maxDevices: true,
  status: true,
  inviterUserId: true,
  inviterCode: true,
  note: true,
  batchNo: true,
  createdByUserId: true,
  firstActivatedAt: true,
  disabledAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CreateLicenseInput {
  durationKind: LicenseDurationKind;
  durationYears?: number;
  durationDays?: number;
  maxDevices: number;
  inviterCode?: string;
  note?: string;
  batchNo?: string;
}

export interface CreateLicenseResult {
  id: string;
  licenseKey: string;
  keyFingerprint: string;
  maxDevices: number;
  durationKind: string;
  inviterCode?: string;
}

/** 创建 License Key：归因校验 → 生成（unique 冲突重试）→ 审计。明文仅本次返回。 */
export async function createLicense(opts: {
  input: CreateLicenseInput;
  createdByUserId: string;
  ip: string | null;
  ua: string | null;
}): Promise<CreateLicenseResult> {
  const { input, createdByUserId, ip, ua } = opts;

  let inviterUserId: string | null = null;
  let inviterCode: string | null = null;
  if (input.inviterCode) {
    const inv = await prisma.invitationCode.findUnique({
      where: { code: input.inviterCode },
      select: { userId: true, code: true, status: true },
    });
    if (!inv) throw new AppError(ErrorCode.LICENSE_INVALID, "邀请码不存在");
    if (inv.status !== "ACTIVE")
      throw new AppError(ErrorCode.LICENSE_INVALID, "邀请码已停用");
    inviterUserId = inv.userId;
    inviterCode = inv.code;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const g = generateLicenseKey();
    try {
      const created = await prisma.licenseKey.create({
        data: {
          keyHash: g.keyHash,
          keyFingerprint: g.keyFingerprint,
          displayKeySuffix: g.displayKeySuffix,
          durationKind: input.durationKind,
          durationYears: input.durationYears ?? null,
          durationDays: input.durationDays ?? null,
          maxDevices: input.maxDevices,
          status: "ENABLED",
          inviterUserId,
          inviterCode,
          note: input.note ?? null,
          batchNo: input.batchNo ?? null,
          createdByUserId,
        },
        select: LICENSE_PUBLIC_FIELDS,
      });
      await writeAudit({
        actorUserId: createdByUserId,
        actorRole: "ADMIN",
        action: "license.create",
        targetType: "LicenseKey",
        targetId: created.id,
        after: {
          keyFingerprint: g.keyFingerprint,
          durationKind: input.durationKind,
          durationLabel: durationLabel(
            input.durationKind,
            input.durationYears,
            input.durationDays
          ),
          maxDevices: input.maxDevices,
          inviterCode,
          batchNo: input.batchNo ?? null,
        },
        ip,
        userAgent: ua,
      });
      const result: CreateLicenseResult = {
        id: created.id,
        licenseKey: g.plaintext,
        keyFingerprint: g.keyFingerprint,
        maxDevices: input.maxDevices,
        durationKind: input.durationKind,
      };
      if (inviterCode) result.inviterCode = inviterCode;
      return result;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new AppError(ErrorCode.INTERNAL_ERROR, "License 生成失败，请重试");
}

export interface ListLicensesParams {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  batchNo?: string;
}

export async function listLicenses(params: ListLicensesParams) {
  const { page, pageSize, status, search, batchNo } = params;
  const where = {
    AND: [
      status ? { status } : {},
      batchNo ? { batchNo } : {},
      search
        ? {
            OR: [
              { keyFingerprint: { contains: search } },
              { displayKeySuffix: { contains: search } },
              { note: { contains: search } },
              { batchNo: { contains: search } },
            ],
          }
        : {},
    ],
  };

  const [items, total] = await Promise.all([
    prisma.licenseKey.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
      select: {
        ...LICENSE_PUBLIC_FIELDS,
        _count: { select: { activations: { where: { status: "ACTIVE" } } } },
      },
    }),
    prisma.licenseKey.count({ where }),
  ]);

  return {
    items: items.map((it) => ({
      ...it,
      activeDevices: it._count.activations,
      _count: undefined,
    })),
    total,
    page,
    pageSize,
  };
}

export async function getLicenseDetail(id: string) {
  const [license, activeDevices, recentLogs] = await Promise.all([
    prisma.licenseKey.findUnique({
      where: { id },
      select: {
        ...LICENSE_PUBLIC_FIELDS,
        activations: {
          orderBy: { activatedAt: "desc" },
          select: {
            id: true,
            deviceIdHash: true,
            machineIdHash: true,
            macHash: true,
            hostnameHash: true,
            os: true,
            arch: true,
            appVersion: true,
            status: true,
            activatedAt: true,
            lastValidatedAt: true,
            deactivatedAt: true,
            revokedAt: true,
            revokedReason: true,
            ipFirst: true,
            ipLast: true,
          },
        },
      },
    }),
    prisma.licenseActivation.count({
      where: { licenseKeyId: id, status: "ACTIVE" },
    }),
    prisma.licenseValidationLog.findMany({
      where: { licenseKeyId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  if (!license) throw new AppError(ErrorCode.NOT_FOUND, "License 不存在");
  return { license, activeDevices, recentLogs };
}

export async function updateLicense(
  id: string,
  patch: { status?: string; note?: string },
  actor: { id: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.licenseKey.findUnique({ where: { id } });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "License 不存在");
  if (existing.status === "REVOKED") {
    throw new AppError(ErrorCode.LICENSE_REVOKED, "已撤销的 License 不可再改状态");
  }

  const data: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (patch.status && patch.status !== existing.status) {
    if (patch.status === "DISABLED") {
      data.status = "DISABLED";
      data.disabledAt = new Date();
    } else if (patch.status === "ENABLED") {
      data.status = "ENABLED";
      data.disabledAt = null;
    } else if (patch.status === "REVOKED") {
      data.status = "REVOKED";
      data.revokedAt = new Date();
    }
    before.status = existing.status;
    after.status = patch.status;
  }
  if (patch.note !== undefined && (patch.note ?? null) !== existing.note) {
    data.note = patch.note ?? null;
    before.note = existing.note;
    after.note = patch.note ?? null;
  }

  if (Object.keys(data).length === 0) {
    return getLicenseDetail(id);
  }

  await prisma.licenseKey.update({ where: { id }, data });
  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "license.update",
    targetType: "LicenseKey",
    targetId: id,
    before,
    after,
    ip: actor.ip,
    userAgent: actor.ua,
  });
  return getLicenseDetail(id);
}

export async function revokeActivation(
  licenseKeyId: string,
  activationId: string,
  reason: string | undefined,
  actor: { id: string; ip: string | null; ua: string | null }
) {
  const act = await prisma.licenseActivation.findUnique({
    where: { id: activationId },
  });
  if (!act || act.licenseKeyId !== licenseKeyId) {
    throw new AppError(ErrorCode.NOT_FOUND, "激活记录不存在");
  }
  if (act.status === "REVOKED") {
    return { id: act.id, status: "REVOKED" };
  }
  await prisma.licenseActivation.update({
    where: { id: activationId },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedReason: reason ?? "管理员解绑",
    },
  });
  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "license.activation.revoke",
    targetType: "LicenseActivation",
    targetId: activationId,
    before: { status: act.status },
    after: { status: "REVOKED", reason: reason ?? "管理员解绑" },
    ip: actor.ip,
    userAgent: actor.ua,
  });
  return { id: act.id, status: "REVOKED" };
}
