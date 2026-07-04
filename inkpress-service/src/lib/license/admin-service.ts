import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import {
  generateLicenseKey,
  durationLabel,
  computeLicenseLifecycle,
  type LicenseLifecycle,
} from "@/lib/license/key";
import {
  decryptLicenseKey,
  encryptLicenseKey,
  verifyLicenseKeyViewPassword,
} from "@/lib/license/key-vault";
import type { LicenseDurationKind } from "@/lib/validation/schemas";
import { randomBytes } from "node:crypto";

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

/** 生成批次号：batch-<8 hex> */
function generateBatchNo(): string {
  return `batch-${randomBytes(4).toString("hex")}`;
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
  /** 批量数量（默认 1），>1 时共享 batchNo 与归因 */
  count?: number;
}

export interface CreateLicenseResult {
  id: string;
  licenseKey: string;
  keyFingerprint: string;
  maxDevices: number;
  durationKind: string;
  inviterCode?: string;
}

/** 创建 License Key：归因校验 → 生成（unique 冲突重试）→ 加密留存 → 审计。 */
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
          keyCiphertext: encryptLicenseKey(g.plaintext),
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

export interface CreateLicensesBatchResult {
  items: CreateLicenseResult[];
  count: number;
  batchNo: string | null;
}

/**
 * 批量创建 License Key：
 * - 共享同一 batchNo（未传则自动 batch-<8hex>）
 * - 共享同一归因校验结果（邀请码只查一次）
 * - 循环 N 次 generateLicenseKey + create，unique 冲突单条重试
 * - 单条审计改为批量审计（action license.create.batch）
 * - 明文 Key 加密留存；创建响应仍直接返回，便于当场复制/导出
 *
 * count===1 时走 N=1 等价路径，与原 createLicense 行为一致（复用）。
 */
export async function createLicensesBatch(opts: {
  input: CreateLicenseInput;
  createdByUserId: string;
  ip: string | null;
  ua: string | null;
}): Promise<CreateLicensesBatchResult> {
  const { input, createdByUserId, ip, ua } = opts;
  const count = input.count ?? 1;
  const normalizedBatchNo = input.batchNo?.trim() || null;

  if (count === 1) {
    const item = await createLicense({
      input: { ...input, batchNo: normalizedBatchNo ?? undefined, count: 1 },
      createdByUserId,
      ip,
      ua,
    });
    return { items: [item], count: 1, batchNo: normalizedBatchNo };
  }

  // 归因校验（只查一次）
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

  const batchNo = normalizedBatchNo ?? generateBatchNo();
  const { items, fingerprints } = await prisma.$transaction(async (tx) => {
    const createdItems: CreateLicenseResult[] = [];
    const createdFingerprints: string[] = [];

    for (let i = 0; i < count; i++) {
      let created = false;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const g = generateLicenseKey();
        try {
          const row = await tx.licenseKey.create({
            data: {
              keyHash: g.keyHash,
              keyFingerprint: g.keyFingerprint,
              displayKeySuffix: g.displayKeySuffix,
              keyCiphertext: encryptLicenseKey(g.plaintext),
              durationKind: input.durationKind,
              durationYears: input.durationYears ?? null,
              durationDays: input.durationDays ?? null,
              maxDevices: input.maxDevices,
              status: "ENABLED",
              inviterUserId,
              inviterCode,
              note: input.note ?? null,
              batchNo,
              createdByUserId,
            },
            select: { id: true },
          });
          const result: CreateLicenseResult = {
            id: row.id,
            licenseKey: g.plaintext,
            keyFingerprint: g.keyFingerprint,
            maxDevices: input.maxDevices,
            durationKind: input.durationKind,
          };
          if (inviterCode) result.inviterCode = inviterCode;
          createdItems.push(result);
          createdFingerprints.push(g.keyFingerprint);
          created = true;
        } catch (err) {
          if (isUniqueViolation(err)) continue;
          throw err;
        }
      }
      if (!created) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, "License 生成失败，请重试");
      }
    }
    return { items: createdItems, fingerprints: createdFingerprints };
  });

  await writeAudit({
    actorUserId: createdByUserId,
    actorRole: "ADMIN",
    action: "license.create.batch",
    targetType: "LicenseKey",
    targetId: batchNo,
    after: {
      count,
      batchNo,
      keyFingerprints: fingerprints,
      durationKind: input.durationKind,
      durationLabel: durationLabel(
        input.durationKind,
        input.durationYears,
        input.durationDays
      ),
      maxDevices: input.maxDevices,
      inviterCode,
    },
    ip,
    userAgent: ua,
  });

  return { items, count, batchNo };
}

export interface ListLicensesParams {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
  batchNo?: string;
  lifecycle?: LicenseLifecycle;
}

export async function listLicenses(params: ListLicensesParams) {
  const { page, pageSize, status, search, batchNo, lifecycle } = params;
  const now = new Date();

  // 激活生命周期粗筛：Prisma where 不便表达「now 与字段比较」的派生条件，
  // 先按 firstActivatedAt 是否为 null 收窄，再在 JS 里精确过滤。
  // PENDING ⟺ firstActivatedAt === null；ACTIVATED/EXPIRED ⟺ firstActivatedAt !== null。
  const lifecycleCoarse = lifecycle
    ? { firstActivatedAt: lifecycle === "PENDING" ? null : { not: null } }
    : {};

  const where = {
    AND: [
      status ? { status } : {},
      batchNo ? { batchNo } : {},
      lifecycleCoarse,
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

  const all = await prisma.licenseKey.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      ...LICENSE_PUBLIC_FIELDS,
      _count: { select: { activations: { where: { status: "ACTIVE" } } } },
    },
  });

  const mapped = all.map((it) => ({
    ...it,
    activeDevices: it._count.activations,
    lifecycle: computeLicenseLifecycle(
      it.firstActivatedAt,
      it.effectiveExpiresAt,
      now
    ),
    _count: undefined,
  }));

  const filtered = lifecycle
    ? mapped.filter((it) => it.lifecycle === lifecycle)
    : mapped;

  const total = filtered.length;
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return { items: paged, total, page, pageSize };
}

export async function getLicenseDetail(id: string) {
  const [license, activeDevices, recentLogs] = await Promise.all([
    prisma.licenseKey.findUnique({
      where: { id },
      select: {
        ...LICENSE_PUBLIC_FIELDS,
        keyCiphertext: true,
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
  const { keyCiphertext, ...safeLicense } = license;
  return {
    license: {
      ...safeLicense,
      hasStoredKey: Boolean(keyCiphertext),
      lifecycle: computeLicenseLifecycle(
        safeLicense.firstActivatedAt,
        safeLicense.effectiveExpiresAt
      ),
    },
    activeDevices,
    recentLogs,
  };
}

export async function revealLicenseKey(
  id: string,
  password: string,
  actor: { id: string; ip: string | null; ua: string | null }
) {
  if (!verifyLicenseKeyViewPassword(password)) {
    await writeAudit({
      actorUserId: actor.id,
      actorRole: "ADMIN",
      action: "license.key.reveal.denied",
      targetType: "LicenseKey",
      targetId: id,
      after: { reason: "invalid password" },
      ip: actor.ip,
      userAgent: actor.ua,
    });
    throw new AppError(ErrorCode.FORBIDDEN, "查看密码错误");
  }

  const license = await prisma.licenseKey.findUnique({
    where: { id },
    select: {
      id: true,
      keyCiphertext: true,
      keyFingerprint: true,
      displayKeySuffix: true,
    },
  });
  if (!license) throw new AppError(ErrorCode.NOT_FOUND, "License 不存在");
  if (!license.keyCiphertext) {
    throw new AppError(
      ErrorCode.NOT_FOUND,
      "此 License 创建时未保存加密明文，无法查看完整 Key"
    );
  }

  let licenseKey: string;
  try {
    licenseKey = decryptLicenseKey(license.keyCiphertext);
  } catch {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "License Key 解密失败");
  }

  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "license.key.reveal",
    targetType: "LicenseKey",
    targetId: id,
    after: {
      keyFingerprint: license.keyFingerprint,
      displayKeySuffix: license.displayKeySuffix,
    },
    ip: actor.ip,
    userAgent: actor.ua,
  });

  return {
    id: license.id,
    licenseKey,
    keyFingerprint: license.keyFingerprint,
    displayKeySuffix: license.displayKeySuffix,
  };
}

export async function updateLicense(
  id: string,
  patch: { status?: string; note?: string; extendDays?: number },
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

  // 续期：在 status 处理之后
  if (patch.extendDays !== undefined) {
    if (existing.durationKind === "PERMANENT") {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "永久 License 无需续期");
    }
    // 未激活（effectiveExpiresAt 为 null 且 firstActivatedAt 为 null）拒绝
    if (existing.effectiveExpiresAt === null && existing.firstActivatedAt === null) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "License 尚未激活，无法续期");
    }
    const now = new Date();
    const baseDate =
      existing.effectiveExpiresAt && existing.effectiveExpiresAt > now
        ? existing.effectiveExpiresAt
        : now;
    const newExpires = new Date(baseDate.getTime() + patch.extendDays * 86_400_000);
    // 原 durationDays（续期前的模板天数），用于叠加计算可读 durationDays
    const originalDays = existing.durationDays ?? 0;
    const remainingDays = Math.max(
      0,
      Math.ceil((baseDate.getTime() - now.getTime()) / 86_400_000)
    );
    const newDurationDays = remainingDays + patch.extendDays;
    data.effectiveExpiresAt = newExpires;
    data.durationKind = "CUSTOM_DAYS";
    data.durationDays = newDurationDays;
    before.effectiveExpiresAt = existing.effectiveExpiresAt;
    before.durationKind = existing.durationKind;
    before.durationDays = originalDays;
    after.effectiveExpiresAt = newExpires;
    after.extendDays = patch.extendDays;
    after.durationKind = "CUSTOM_DAYS";
    after.durationDays = newDurationDays;
  }

  if (Object.keys(data).length === 0) {
    return getLicenseDetail(id);
  }

  await prisma.licenseKey.update({ where: { id }, data });
  // 续期单独审计；其余合并为 license.update
  if (patch.extendDays !== undefined) {
    await writeAudit({
      actorUserId: actor.id,
      actorRole: "ADMIN",
      action: "license.extend",
      targetType: "LicenseKey",
      targetId: id,
      before: {
        effectiveExpiresAt: before.effectiveExpiresAt,
        durationKind: before.durationKind,
        durationDays: before.durationDays,
      },
      after: {
        effectiveExpiresAt: after.effectiveExpiresAt,
        extendDays: after.extendDays,
        durationKind: after.durationKind,
        durationDays: after.durationDays,
      },
      ip: actor.ip,
      userAgent: actor.ua,
    });
  }
  const hasOtherChanges =
    after.status !== undefined || after.note !== undefined;
  if (hasOtherChanges) {
    await writeAudit({
      actorUserId: actor.id,
      actorRole: "ADMIN",
      action: "license.update",
      targetType: "LicenseKey",
      targetId: id,
      before: {
        ...(after.status !== undefined ? { status: before.status } : {}),
        ...(after.note !== undefined ? { note: before.note } : {}),
      },
      after: {
        ...(after.status !== undefined ? { status: after.status } : {}),
        ...(after.note !== undefined ? { note: after.note } : {}),
      },
      ip: actor.ip,
      userAgent: actor.ua,
    });
  }
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

/**
 * 硬删除 License Key：仅允许删除「待激活」或「已过期」的 key，
 * 避免误删正在使用的 key。
 *
 * 级联：
 * - LicenseActivation：schema 已配置 onDelete: Cascade，Prisma 自动级联。
 * - LicenseValidationLog：licenseKeyId 是裸 String?（非外键），事务内手动 deleteMany。
 * - AuditLog：保留（管理员变更历史），targetId 引用悬空无副作用。
 *
 * 删除前先写一条 license.delete 审计日志记录 before 快照。
 */
export async function deleteLicense(
  id: string,
  actor: { id: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.licenseKey.findUnique({
    where: { id },
    select: {
      id: true,
      keyFingerprint: true,
      displayKeySuffix: true,
      status: true,
      firstActivatedAt: true,
      effectiveExpiresAt: true,
      durationKind: true,
      durationYears: true,
      durationDays: true,
    },
  });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "License 不存在");

  const lifecycle = computeLicenseLifecycle(
    existing.firstActivatedAt,
    existing.effectiveExpiresAt
  );
  if (lifecycle === "ACTIVATED") {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "仅待激活或已过期的 License 可删除"
    );
  }

  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "license.delete",
    targetType: "LicenseKey",
    targetId: id,
    before: {
      keyFingerprint: existing.keyFingerprint,
      displayKeySuffix: existing.displayKeySuffix,
      status: existing.status,
      lifecycle,
      durationKind: existing.durationKind,
      durationYears: existing.durationYears,
      durationDays: existing.durationDays,
      effectiveExpiresAt: existing.effectiveExpiresAt,
    },
    ip: actor.ip,
    userAgent: actor.ua,
  });

  await prisma.$transaction([
    prisma.licenseValidationLog.deleteMany({ where: { licenseKeyId: id } }),
    prisma.licenseKey.delete({ where: { id } }),
  ]);

  return { id, deletedAt: new Date() };
}
