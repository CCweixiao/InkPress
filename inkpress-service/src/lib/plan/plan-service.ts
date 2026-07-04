import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import type {
  PlanDurationKind,
} from "@/lib/validation/schemas";

/**
 * 订阅计划服务层。
 *
 * 关键约定：
 * - 价格以「分」存库（整数运算），对外响应里同时返回元/分两种形态与派生字段
 * - featuresJson 在数据库是 string，本层负责 string[] ↔ JSON 序列化
 * - 公开列表只返回 status=ACTIVE；管理端可看全部
 */

export interface PublicPlan {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  durationKind: string;
  durationYears: number | null;
  maxDevices: number;
  /** 原价：元（保留 2 位小数代表的数字） */
  priceYuan: number;
  /** 折扣价：元（无折扣时等于 priceYuan） */
  discountYuan: number;
  /** 是否处于折扣 */
  hasDiscount: boolean;
  /** 折扣百分比（0-100，无折扣为 0） */
  discountPct: number;
  /** 立省金额（元） */
  saveYuan: number;
  /** 年单价（元）：PERMANENT 为 null */
  perYearYuan: number | null;
  features: string[];
  highlight: string | null;
  sortOrder: number;
}

export interface AdminPlan extends PublicPlan {
  status: string;
  priceCents: number;
  discountPriceCents: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPublicPlan(row: {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  durationKind: string;
  durationYears: number | null;
  maxDevices: number;
  priceCents: number;
  discountPriceCents: number | null;
  featuresJson: string;
  highlight: string | null;
  sortOrder: number;
}): PublicPlan {
  const priceYuan = row.priceCents / 100;
  const discountCents = row.discountPriceCents ?? null;
  const hasDiscount =
    discountCents !== null && discountCents < row.priceCents;
  const discountYuan = hasDiscount ? (discountCents as number) / 100 : priceYuan;
  const saveYuan = hasDiscount ? priceYuan - discountYuan : 0;
  const discountPct = hasDiscount
    ? Math.round((saveYuan / priceYuan) * 100)
    : 0;

  // 年单价：非永久按 durationYears 或 durationKind 推断
  let perYearYuan: number | null = null;
  if (row.durationKind !== "PERMANENT") {
    const years =
      row.durationYears ??
      (row.durationKind === "YEAR_1"
        ? 1
        : row.durationKind === "YEAR_3"
          ? 3
          : row.durationKind === "YEAR_5"
            ? 5
            : null);
    if (years && years > 0) {
      perYearYuan = Math.round((discountYuan / years) * 100) / 100;
    }
  }

  let features: string[] = [];
  try {
    const parsed = JSON.parse(row.featuresJson);
    if (Array.isArray(parsed)) features = parsed.filter((x) => typeof x === "string");
  } catch {
    features = [];
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    durationKind: row.durationKind,
    durationYears: row.durationYears,
    maxDevices: row.maxDevices,
    priceYuan,
    discountYuan,
    hasDiscount,
    discountPct,
    saveYuan,
    perYearYuan,
    features,
    highlight: row.highlight,
    sortOrder: row.sortOrder,
  };
}

function toAdminPlan(row: {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  durationKind: string;
  durationYears: number | null;
  maxDevices: number;
  priceCents: number;
  discountPriceCents: number | null;
  featuresJson: string;
  highlight: string | null;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): AdminPlan {
  return {
    ...toPublicPlan(row),
    status: row.status,
    priceCents: row.priceCents,
    discountPriceCents: row.discountPriceCents,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const PUBLIC_SELECT = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  durationKind: true,
  durationYears: true,
  maxDevices: true,
  priceCents: true,
  discountPriceCents: true,
  featuresJson: true,
  highlight: true,
  sortOrder: true,
} as const;

const ADMIN_SELECT = {
  ...PUBLIC_SELECT,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** 公开端点：只返回 ACTIVE，按 sortOrder 升序 */
export async function listPublicPlans(): Promise<PublicPlan[]> {
  const rows = await prisma.subscriptionPlan.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: PUBLIC_SELECT,
  });
  return rows.map(toPublicPlan);
}

/** 管理端：返回全部，含 status */
export async function listAllPlans(): Promise<AdminPlan[]> {
  const rows = await prisma.subscriptionPlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: ADMIN_SELECT,
  });
  return rows.map(toAdminPlan);
}

export interface CreatePlanInput {
  slug: string;
  name: string;
  tagline?: string;
  durationKind: PlanDurationKind;
  durationYears?: number;
  maxDevices: number;
  priceCents: number;
  discountPriceCents?: number | null;
  features: string[];
  highlight?: "popular" | "best_value" | null;
  sortOrder?: number;
  status?: "ACTIVE" | "INACTIVE";
}

export async function createPlan(
  input: CreatePlanInput,
  actor: { id: string; ip: string | null; ua: string | null }
): Promise<AdminPlan> {
  try {
    const created = await prisma.subscriptionPlan.create({
      data: {
        slug: input.slug,
        name: input.name,
        tagline: input.tagline ?? null,
        durationKind: input.durationKind,
        durationYears: input.durationYears ?? null,
        maxDevices: input.maxDevices,
        priceCents: input.priceCents,
        discountPriceCents: input.discountPriceCents ?? null,
        featuresJson: JSON.stringify(input.features ?? []),
        highlight: input.highlight ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? "ACTIVE",
      },
      select: ADMIN_SELECT,
    });
    await writeAudit({
      actorUserId: actor.id,
      actorRole: "ADMIN",
      action: "plan.create",
      targetType: "SubscriptionPlan",
      targetId: created.id,
      after: {
        slug: created.slug,
        name: created.name,
        priceCents: created.priceCents,
        discountPriceCents: created.discountPriceCents,
      },
      ip: actor.ip,
      userAgent: actor.ua,
    });
    return toAdminPlan(created);
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      throw new AppError(ErrorCode.VALIDATION_ERROR, "slug 已存在");
    }
    throw err;
  }
}

export interface UpdatePlanInput {
  name?: string;
  tagline?: string | null;
  durationKind?: PlanDurationKind;
  durationYears?: number | null;
  maxDevices?: number;
  priceCents?: number;
  discountPriceCents?: number | null;
  features?: string[];
  highlight?: "popular" | "best_value" | null;
  sortOrder?: number;
  status?: "ACTIVE" | "INACTIVE";
}

export async function updatePlan(
  id: string,
  patch: UpdatePlanInput,
  actor: { id: string; ip: string | null; ua: string | null }
): Promise<AdminPlan> {
  const existing = await prisma.subscriptionPlan.findUnique({
    where: { id },
    select: ADMIN_SELECT,
  });
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, "订阅计划不存在");
  }

  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.tagline !== undefined) data.tagline = patch.tagline;
  if (patch.durationKind !== undefined) data.durationKind = patch.durationKind;
  if (patch.durationYears !== undefined) data.durationYears = patch.durationYears;
  if (patch.maxDevices !== undefined) data.maxDevices = patch.maxDevices;
  if (patch.priceCents !== undefined) data.priceCents = patch.priceCents;
  if (patch.discountPriceCents !== undefined) {
    data.discountPriceCents = patch.discountPriceCents;
  }
  if (patch.features !== undefined) data.featuresJson = JSON.stringify(patch.features);
  if (patch.highlight !== undefined) data.highlight = patch.highlight;
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  if (patch.status !== undefined) data.status = patch.status;

  if (Object.keys(data).length === 0) {
    return toAdminPlan(existing);
  }

  const updated = await prisma.subscriptionPlan.update({
    where: { id },
    data,
    select: ADMIN_SELECT,
  });
  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "plan.update",
    targetType: "SubscriptionPlan",
    targetId: id,
    before: {
      name: existing.name,
      priceCents: existing.priceCents,
      discountPriceCents: existing.discountPriceCents,
      status: existing.status,
    },
    after: {
      name: updated.name,
      priceCents: updated.priceCents,
      discountPriceCents: updated.discountPriceCents,
      status: updated.status,
    },
    ip: actor.ip,
    userAgent: actor.ua,
  });
  return toAdminPlan(updated);
}

export async function deletePlan(
  id: string,
  actor: { id: string; ip: string | null; ua: string | null }
): Promise<void> {
  const existing = await prisma.subscriptionPlan.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true },
  });
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, "订阅计划不存在");
  }
  await prisma.subscriptionPlan.delete({ where: { id } });
  await writeAudit({
    actorUserId: actor.id,
    actorRole: "ADMIN",
    action: "plan.delete",
    targetType: "SubscriptionPlan",
    targetId: id,
    before: { slug: existing.slug, name: existing.name },
    ip: actor.ip,
    userAgent: actor.ua,
  });
}
