import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { moduleLogger } from "@/lib/logger";
import { generateLicenseKey } from "@/lib/license/key";
import { encryptLicenseKey } from "@/lib/license/key-vault";
import { createPayUrl, detectPayChannel, type PayChannel } from "@/lib/payment/alipay/api";
import { getSystemUserId } from "@/lib/payment/system-user";
import { sendMail, renderOrderPaidReceiptEmail } from "@/lib/email";

const log = moduleLogger("payment:order");

const MAX_PENDING_PER_USER = 10;
const OUT_TRADE_NO_MAX_ATTEMPTS = 3;
const LICENSE_KEY_RETRY = 5;
const ORDER_TTL_MS = 15 * 60 * 1000; // 15 分钟，与支付宝 timeout_express 一致

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "P2002";
}

/** 生成 outTradeNo：INKP + yyyyMMddHHmmss + 6hex（共 26 字符，< 32 上限） */
function generateOutTradeNo(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = randomBytes(3).toString("hex").toUpperCase(); // 6 位
  return `INKP${ts}${rand}`;
}

/** 从 SubscriptionPlan 计算实付金额（分）：有折扣取折扣，否则原价 */
function computeAmountCents(plan: {
  priceCents: number;
  discountPriceCents: number | null;
}): number {
  return plan.discountPriceCents ?? plan.priceCents;
}

export interface CreateOrderResult {
  orderId: string;
  outTradeNo: string;
  payUrl: string;
  /** 实际使用的支付通道：PC=page（电脑网站支付），移动端=wap（手机网站支付） */
  channel: PayChannel;
  amountCents: number;
  subject: string;
  /** 订单失效时间（15 分钟后） */
  expiresAt: Date;
}

/**
 * 创建订单：查 Plan → 限流 PENDING 堆积 → 生成 outTradeNo →
 * DB 落 PENDING → 按 UA 分流调 page.pay/wap.pay 拿跳转 URL（失败回滚订单）→ 审计。
 */
export async function createOrder(opts: {
  planSlug: string;
  userId: string;
  userEmail: string;
  ip: string | null;
  ua: string | null;
}): Promise<CreateOrderResult> {
  const { planSlug, userId, ip, ua } = opts;

  // 1. 查 ACTIVE 套餐
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { slug: planSlug, status: "ACTIVE" },
  });
  if (!plan) {
    throw new AppError(ErrorCode.NOT_FOUND, "套餐不存在或已下架");
  }

  // 1b. 每日库存校验：dailyStockLimit=null 不限；>=0 时统计今日 PENDING+PAID 订单数
  // 防止触发支付宝小微商户单日收款限额（默认 ≤1000 元/日）
  if (plan.dailyStockLimit !== null) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    // 管理员手动重置：resetAt > startOfToday 时，从此时间点起算
    const since =
      plan.dailyStockResetAt && plan.dailyStockResetAt > startOfToday
        ? plan.dailyStockResetAt
        : startOfToday;
    const soldToday = await prisma.order.count({
      where: {
        planSlug,
        status: { in: ["PENDING", "PAID"] },
        createdAt: { gte: since },
      },
    });
    if (soldToday >= plan.dailyStockLimit) {
      throw new AppError(
        ErrorCode.PLAN_SOLD_OUT,
        "今日库存已售罄，请明天再来或联系客服"
      );
    }
  }

  // 2. 防止未支付订单堆积
  const pendingCount = await prisma.order.count({
    where: { userId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_PER_USER) {
    throw new AppError(
      ErrorCode.RATE_LIMITED,
      `待支付订单过多（${MAX_PENDING_PER_USER} 个），请先完成或取消现有订单`
    );
  }

  const amountCents = computeAmountCents(plan);
  const subject = `InkPress ${plan.name} · ${plan.maxDevices} 设备`;
  const planConfigJson = JSON.stringify({
    durationKind: plan.durationKind,
    durationYears: plan.durationYears,
    maxDevices: plan.maxDevices,
  });
  const notifyUrl = process.env.ALIPAY_NOTIFY_URL?.trim();
  const returnUrlBase = process.env.ALIPAY_RETURN_URL?.trim();
  if (!notifyUrl) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "ALIPAY_NOTIFY_URL 未配置"
    );
  }
  if (!returnUrlBase) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "ALIPAY_RETURN_URL 未配置"
    );
  }

  // 3-4. outTradeNo 冲突重试 + 落库
  let orderId: string | undefined;
  let outTradeNo: string | undefined;
  for (let attempt = 0; attempt < OUT_TRADE_NO_MAX_ATTEMPTS; attempt++) {
    const candidate = generateOutTradeNo();
    try {
      const created = await prisma.order.create({
        data: {
          userId,
          outTradeNo: candidate,
          planSlug: plan.slug,
          planName: plan.name,
          planConfigJson,
          subject,
          amountCents,
          status: "PENDING",
          createdIp: ip,
          createdUa: ua,
        },
        select: { id: true, outTradeNo: true },
      });
      orderId = created.id;
      outTradeNo = created.outTradeNo;
      break;
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  if (!orderId || !outTradeNo) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, "订单号生成失败，请重试");
  }

  // 5. 按 UA 分流生成跳转 URL；失败则删订单保持干净
  try {
    const returnUrl = `${returnUrlBase}?orderId=${orderId}`;
    const channel = detectPayChannel(opts.ua);
    const { payUrl, channel: usedChannel } = await createPayUrl({
      outTradeNo,
      totalAmount: amountCents / 100,
      subject,
      notifyUrl,
      returnUrl,
      channel,
    });

    await writeAudit({
      actorUserId: userId,
      actorRole: "USER",
      action: "order.create",
      targetType: "Order",
      targetId: orderId,
      after: { outTradeNo, planSlug: plan.slug, amountCents, channel: usedChannel },
      ip,
      userAgent: ua,
    });

    return {
      orderId,
      outTradeNo,
      payUrl,
      channel: usedChannel,
      amountCents,
      subject,
      expiresAt: new Date(Date.now() + ORDER_TTL_MS),
    };
  } catch (err) {
    // 支付 URL 生成失败：删除 PENDING 订单，避免脏数据阻塞用户再次下单
    await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
    throw err;
  }
}

export interface OrderForUser {
  id: string;
  outTradeNo: string;
  status: string;
  amountCents: number;
  subject: string;
  planName: string;
  planSlug: string;
  licenseKeyId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

/** 用户轮询：归属校验 + 返回订单状态 */
export async function getOrderForUser(
  orderId: string,
  userId: string
): Promise<OrderForUser> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      outTradeNo: true,
      userId: true,
      status: true,
      amountCents: true,
      subject: true,
      planName: true,
      planSlug: true,
      licenseKeyId: true,
      paidAt: true,
      createdAt: true,
    },
  });
  if (!order) {
    throw new AppError(ErrorCode.NOT_FOUND, "订单不存在");
  }
  if (order.userId !== userId) {
    // 归属不匹配一律 404，避免枚举探测
    throw new AppError(ErrorCode.NOT_FOUND, "订单不存在");
  }
  return order;
}

const ORDER_LIST_SELECT = {
  id: true,
  outTradeNo: true,
  planSlug: true,
  planName: true,
  subject: true,
  amountCents: true,
  status: true,
  tradeNo: true,
  licenseKeyId: true,
  paidAt: true,
  closedAt: true,
  createdAt: true,
} as const;

export async function listMyOrders(
  userId: string,
  { page, pageSize }: { page: number; pageSize: number }
) {
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ORDER_LIST_SELECT,
    }),
    prisma.order.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize };
}

export async function listAllOrders({
  page,
  pageSize,
  status,
  search,
}: {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}) {
  const where = {
    AND: [
      status ? { status } : {},
      search
        ? {
            OR: [
              { outTradeNo: { contains: search } },
              { tradeNo: { contains: search } },
              { planName: { contains: search } },
              { user: { email: { contains: search } } },
            ],
          }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...ORDER_LIST_SELECT,
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getOrderAdmin(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      ...ORDER_LIST_SELECT,
      buyerLogonId: true,
      planConfigJson: true,
      notifyCount: true,
      lastNotifyAt: true,
      closedAt: true,
      createdIp: true,
      createdUa: true,
      updatedAt: true,
      user: { select: { id: true, email: true } },
    },
  });
  if (!order) {
    throw new AppError(ErrorCode.NOT_FOUND, "订单不存在");
  }
  return order;
}

/**
 * 支付成功回调核心：单事务内完成「幂等校验 + 金额校验 + 发券 + 改单 + 审计」。
 *
 * 关键：审计必须用 tx.auditLog.create 保证原子性（不能用 writeAudit，后者用裸 prisma）。
 * License 生成复用 generateLicenseKey + encryptLicenseKey，循环 5 次防 keyHash 冲突。
 *
 * 抛错时外层 catch 返回 fail，支付宝会重试。
 */
interface OrderReceipt {
  orderId: string;
  outTradeNo: string;
  planName: string;
  amountCents: number;
  paidAt: Date;
  tradeNo: string;
  keyFingerprint: string;
  keySuffix: string;
  userEmail: string;
}

export async function fulfillOrderIfPending(opts: {
  outTradeNo: string;
  tradeNo: string;
  totalAmountYuan: string;
  buyerLogonId?: string;
}): Promise<void> {
  const systemUserId = getSystemUserId();

  // 事务返回收据数据；幂等/异常场景返回 null，跳过邮件发送
  const receipt = await prisma.$transaction<OrderReceipt | null>(async (tx) => {
    const order = await tx.order.findUnique({
      where: { outTradeNo: opts.outTradeNo },
      select: {
        id: true,
        userId: true,
        status: true,
        amountCents: true,
        planName: true,
        planConfigJson: true,
      },
    });

    // 订单不存在：可能伪造（虽已验签），返回 success 避免重试
    if (!order) {
      log.warn({ outTradeNo: opts.outTradeNo }, "回调订单不存在");
      return null;
    }

    // 幂等：已处理直接返回
    if (order.status === "PAID") {
      log.info({ orderId: order.id }, "订单已支付，幂等跳过");
      return null;
    }

    // 异常状态：跳过
    if (order.status === "CLOSED" || order.status === "REFUNDED") {
      log.warn(
        { orderId: order.id, status: order.status },
        "订单状态异常，跳过回调"
      );
      return null;
    }

    // 金额校验（关键安全点）
    const expectedYuan = (order.amountCents / 100).toFixed(2);
    if (opts.totalAmountYuan !== expectedYuan) {
      log.error(
        { orderId: order.id, expected: expectedYuan, got: opts.totalAmountYuan },
        "回调金额不匹配"
      );
      throw new Error(`金额不匹配：期望 ${expectedYuan} 元，实收 ${opts.totalAmountYuan} 元`);
    }

    // 从订单快照恢复 License 生成参数
    const cfg = JSON.parse(order.planConfigJson) as {
      durationKind: string;
      durationYears?: number | null;
      maxDevices: number;
    };

    // 查用户邮箱作 ownerEmail
    const user = await tx.user.findUnique({
      where: { id: order.userId },
      select: { email: true },
    });
    if (!user) throw new Error("用户不存在");

    // License 生成：循环防 keyHash 冲突
    let licenseKeyId: string | null = null;
    let keyFingerprint = "";
    let keySuffix = "";
    for (let attempt = 0; attempt < LICENSE_KEY_RETRY; attempt++) {
      const g = generateLicenseKey();
      try {
        const created = await tx.licenseKey.create({
          data: {
            keyHash: g.keyHash,
            keyFingerprint: g.keyFingerprint,
            displayKeySuffix: g.displayKeySuffix,
            keyCiphertext: encryptLicenseKey(g.plaintext),
            durationKind: cfg.durationKind,
            durationYears: cfg.durationYears ?? null,
            maxDevices: cfg.maxDevices,
            status: "ENABLED",
            ownerEmail: user.email,
            note: `在线购买自动发放（订单 ${opts.outTradeNo}）`,
            createdByUserId: systemUserId,
          },
          select: { id: true, keyFingerprint: true, displayKeySuffix: true },
        });
        licenseKeyId = created.id;
        keyFingerprint = created.keyFingerprint;
        keySuffix = created.displayKeySuffix;
        break;
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    if (!licenseKeyId) {
      throw new Error("License 生成失败（keyHash 冲突超限）");
    }

    // 改单
    const paidAt = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        tradeNo: opts.tradeNo,
        buyerLogonId: opts.buyerLogonId ?? null,
        licenseKeyId,
        paidAt,
        notifyCount: { increment: 1 },
        lastNotifyAt: paidAt,
      },
    });

    // 审计（事务内）
    await tx.auditLog.create({
      data: {
        actorUserId: systemUserId,
        actorRole: "SYSTEM",
        action: "order.paid",
        targetType: "Order",
        targetId: order.id,
        afterJson: JSON.stringify({
          channel: "ALIPAY",
          tradeNo: opts.tradeNo,
          licenseKeyId,
          amountCents: order.amountCents,
          keyFingerprint,
        }),
      },
    });

    log.info(
      { orderId: order.id, licenseKeyId },
      "订单支付成功，License 已发放"
    );

    return {
      orderId: order.id,
      outTradeNo: opts.outTradeNo,
      planName: order.planName,
      amountCents: order.amountCents,
      paidAt,
      tradeNo: opts.tradeNo,
      keyFingerprint,
      keySuffix,
      userEmail: user.email,
    };
  });

  // 邮件发送放在事务外：失败不能回滚已 PAID 订单
  if (receipt) {
    try {
      const msg = renderOrderPaidReceiptEmail(receipt.userEmail, {
        orderId: receipt.orderId,
        outTradeNo: receipt.outTradeNo,
        planName: receipt.planName,
        amountCents: receipt.amountCents,
        paidAt: receipt.paidAt,
        tradeNo: receipt.tradeNo,
        keyFingerprint: receipt.keyFingerprint,
        keySuffix: receipt.keySuffix,
      });
      await sendMail(msg);
      log.info({ orderId: receipt.orderId }, "支付收据邮件已发送");
    } catch (err) {
      log.warn(
        { orderId: receipt.orderId, err },
        "支付收据邮件发送失败（订单已成功，忽略）"
      );
    }
  }
}
