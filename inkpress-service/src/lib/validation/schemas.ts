import { z } from "zod";
import { MAX_IMAGE_BYTES } from "@/lib/tickets/constants";

/**
 * Zod 校验 schema（PDC §9.4：所有 route handler 必须使用 Zod）。
 * 角色等「枚举」用 z.enum 约束取值集合（DB 侧为 String）。
 */
export const UserRole = z.enum(["USER", "ADMIN"]);
export const UserStatus = z.enum(["ACTIVE", "DISABLED", "DELETED"]);
export const EmailCodePurposeSchema = z.enum([
  "REGISTER",
  "RESET_PASSWORD",
  "CHANGE_EMAIL",
]);
export type EmailCodePurpose = z.infer<typeof EmailCodePurposeSchema>;

/** 邮箱：先 trim/lower，再用正则校验，避免依赖具体 Zod 版本的 email 实现 */
export const emailSchema = z
  .string()
  .max(254)
  .refine((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()), {
    message: "邮箱格式错误",
  })
  .transform((s) => s.trim().toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128, "密码不能超过 128 位")
  .regex(/[a-zA-Z]/, "密码需包含字母")
  .regex(/\d/, "密码需包含数字");

/** 发送邮箱验证码 */
export const sendEmailCodeSchema = z.object({
  email: emailSchema,
  purpose: EmailCodePurposeSchema.default("REGISTER"),
});

/** 注册：邮箱 + 密码 + 6 位验证码（从简设计，不采集昵称） */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  code: z
    .string()
    .regex(/^\d{6}$/, "验证码为 6 位数字"),
});

/** 登录（Credentials，提交给 NextAuth 的 credentials 形态较松，这里用于直接登录态校验） */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

/** 修改密码 */
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

/** 找回密码：邮箱 + 验证码 + 新密码 */
export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^\d{6}$/, "验证码为 6 位数字"),
  newPassword: passwordSchema,
});

// ===== License / 管理端（Phase 2） =====
export const LicenseDurationKindSchema = z.enum([
  "YEAR_1",
  "YEAR_3",
  "YEAR_5",
  "CUSTOM_YEARS",
  "CUSTOM_DAYS",
  "PERMANENT",
]);
export type LicenseDurationKind = z.infer<typeof LicenseDurationKindSchema>;

export const LicenseKeyStatusSchema = z.enum(["ENABLED", "DISABLED", "REVOKED"]);
export const LicenseLifecycleSchema = z.enum(["PENDING", "ACTIVATED", "EXPIRED"]);
export type LicenseLifecycle = z.infer<typeof LicenseLifecycleSchema>;
export const ActivationStatusSchema = z.enum(["ACTIVE", "DEACTIVATED", "REVOKED"]);
export const LicenseApiActionSchema = z.enum(["ACTIVATE", "VALIDATE", "DEACTIVATE"]);
export const LicenseApiResultSchema = z.enum([
  "ALLOWED",
  "DENIED",
  "RATE_LIMITED",
  "ERROR",
]);

/** 创建 License Key（PDC §7.2 CreateLicenseRequest） */
export const createLicenseSchema = z
  .object({
    durationKind: LicenseDurationKindSchema,
    durationYears: z.number().int().min(1).max(100).optional(),
    durationDays: z.number().int().min(1).max(36500).optional(),
    maxDevices: z.number().int().min(1).max(100),
    ownerEmail: emailSchema,
    inviterCode: z.string().trim().min(1).max(16).optional(),
    note: z.string().trim().max(500).optional(),
    batchNo: z.string().trim().max(64).optional(),
    count: z.number().int().min(1).max(100).default(1),
  })
  .refine(
    (v) => v.durationKind !== "CUSTOM_YEARS" || (v.durationYears ?? 0) >= 1,
    { message: "CUSTOM_YEARS 需提供 durationYears（≥1）", path: ["durationYears"] }
  )
  .refine(
    (v) => v.durationKind !== "CUSTOM_DAYS" || (v.durationDays ?? 0) >= 1,
    { message: "CUSTOM_DAYS 需提供 durationDays（≥1）", path: ["durationDays"] }
  );

/** 更新 License 状态/备注/续期 */
export const updateLicenseSchema = z
  .object({
    status: LicenseKeyStatusSchema.optional(),
    note: z.string().trim().max(500).optional(),
    extendDays: z.number().int().min(1).max(3650).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.note !== undefined || v.extendDays !== undefined,
    {
      message: "至少提供 status、note 或 extendDays 之一",
    }
  );

/** 管理员修改用户 */
export const patchUserSchema = z
  .object({
    status: UserStatus.optional(),
    role: UserRole.optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, {
    message: "至少提供 status 或 role 之一",
  });

/** 列表分页/筛选查询参数（page/pageSize 来自 query 字符串，需 coerce） */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ===== 订阅计划 =====
export const PlanDurationKindSchema = z.enum([
  "YEAR_1",
  "YEAR_3",
  "YEAR_5",
  "PERMANENT",
]);
export type PlanDurationKind = z.infer<typeof PlanDurationKindSchema>;

export const PlanHighlightSchema = z.enum(["popular", "best_value"]);
export const PlanStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/** 价格（分）：1 分 ~ 1000 万元 */
const priceCentsField = z.number().int().min(1).max(1_000_000_00);

/** 创建订阅计划 */
export const createPlanSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-z0-9][a-z0-9_]*$/, "slug 只能包含小写字母、数字、下划线"),
    name: z.string().trim().min(1).max(64),
    tagline: z.string().trim().max(100).optional(),
    durationKind: PlanDurationKindSchema,
    durationYears: z.number().int().min(1).max(100).optional(),
    maxDevices: z.number().int().min(1).max(100),
    priceCents: priceCentsField,
    discountPriceCents: priceCentsField.nullable().optional(),
    features: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    highlight: PlanHighlightSchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    status: PlanStatusSchema.default("ACTIVE"),
  })
  .refine((v) => v.discountPriceCents === null || v.discountPriceCents === undefined || v.discountPriceCents < v.priceCents, {
    message: "折扣价必须低于原价",
    path: ["discountPriceCents"],
  });

/** 更新订阅计划（全量替换式 PATCH，字段全部可选） */
export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    tagline: z.string().trim().max(100).nullable().optional(),
    durationKind: PlanDurationKindSchema.optional(),
    durationYears: z.number().int().min(1).max(100).nullable().optional(),
    maxDevices: z.number().int().min(1).max(100).optional(),
    priceCents: priceCentsField.optional(),
    discountPriceCents: priceCentsField.nullable().optional(),
    features: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    highlight: PlanHighlightSchema.nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    status: PlanStatusSchema.optional(),
  })
  .refine(
    (v) =>
      v.discountPriceCents === null ||
      v.discountPriceCents === undefined ||
      v.priceCents === undefined ||
      v.discountPriceCents < v.priceCents,
    { message: "折扣价必须低于原价", path: ["discountPriceCents"] }
  );

// ===== License 客户端 API（Phase 3，PDC §7） =====

/** 设备指纹 hash：hex（客户端 sha256，主键 machineIdHash / deviceIdHash） */
const fingerprintHashSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8,128}$/, "设备指纹需为 hex hash");

export const deviceSchema = z.object({
  deviceIdHash: fingerprintHashSchema,
  machineIdHash: fingerprintHashSchema.optional(),
  macHash: fingerprintHashSchema.optional(),
  hostnameHash: fingerprintHashSchema.optional(),
  os: z.enum(["darwin", "win32", "linux"]),
  arch: z.string().trim().max(32),
});

export const appMetaSchema = z.object({
  version: z.string().trim().min(1).max(64),
  buildNumber: z.string().trim().max(32).optional(),
  channel: z.enum(["stable", "beta", "dev"]).optional(),
});

/** 激活请求：License Key + 设备指纹 + 应用元信息（PDC §7 ActivateLicenseRequest） */
export const activateLicenseSchema = z.object({
  licenseKey: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => /^INKP-[A-Z0-9]{4,16}(-[A-Z0-9]{1,16}){1,3}$/.test(s), {
      message: "License Key 格式错误",
    }),
  device: deviceSchema,
  app: appMetaSchema,
});

export type ActivateLicenseInput = z.infer<typeof activateLicenseSchema>;

/** 校验请求（PDC §7 ValidateLicenseRequest） */
export const validateLicenseSchema = z.object({
  activationId: z.string().trim().min(1).max(64),
  deviceIdHash: fingerprintHashSchema,
  appVersion: z.string().trim().min(1).max(64),
  licenseToken: z.string().max(4096).optional(),
});

export type ValidateLicenseInput = z.infer<typeof validateLicenseSchema>;

/** 解绑请求 */
export const deactivateLicenseSchema = z.object({
  activationId: z.string().trim().min(1).max(64),
  deviceIdHash: fingerprintHashSchema,
});

export type DeactivateLicenseInput = z.infer<typeof deactivateLicenseSchema>;

/** 签名请求头（PDC §5.3，header 名小写） */
export const signedHeadersSchema = z.object({
  clientId: z.string().trim().min(8).max(128),
  deviceId: z.string().trim().min(8).max(128),
  timestamp: z.coerce.number().int().positive(),
  nonce: z.string().trim().min(8).max(128),
  signature: z.string().regex(/^[0-9a-fA-F]{8,256}$/, "签名格式错误"),
});

// ===== 订单 / 支付 =====
export const OrderStatusSchema = z.enum(["PENDING", "PAID", "CLOSED", "REFUNDED"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** 创建订单：planSlug 与 SubscriptionPlan.slug 同规则 */
export const createOrderSchema = z.object({
  planSlug: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9_]*$/, "slug 只能包含小写字母、数字、下划线"),
});

// ===== 工单系统 =====
export const TicketTypeSchema = z.enum([
  "PAYMENT",
  "LICENSE",
  "ACCOUNT",
  "USAGE",
  "HELP",
  "BUG",
  "FEATURE",
  "OTHER",
]);
export type TicketType = z.infer<typeof TicketTypeSchema>;

export const TicketStatusSchema = z.enum(["OPEN", "ANSWERED", "RESOLVED", "CLOSED"]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const TicketPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;

export const attachmentSchema = z.object({
  key: z.string().min(1).max(512),
  name: z.string().min(1).max(200),
  size: z.number().int().nonnegative().max(MAX_IMAGE_BYTES),
  contentType: z.string().regex(/^image\//, "仅支持图片"),
});

export const createTicketSchema = z.object({
  type: TicketTypeSchema,
  subject: z.string().trim().min(4, "标题至少 4 字").max(80),
  description: z.string().trim().min(10, "描述至少 10 字").max(5000),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

export const createTicketReplySchema = z.object({
  content: z.string().trim().min(1, "回复内容不能为空").max(5000),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

export const updateTicketStatusSchema = z.object({
  status: TicketStatusSchema,
  priority: TicketPrioritySchema.optional(),
});


