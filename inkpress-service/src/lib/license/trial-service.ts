/**
 * 试用业务层（7 天免费试用，服务端权威起点）。
 *
 * 威胁模型与 activate 同级：无共享密钥，靠 HTTPS + 限流 + deviceIdHash 强随机性。
 * 幂等 upsert：命中既有记录 → 返回当前 state（不重置试用起点，防重装续命）。
 */
import { prisma } from "@/lib/db";
import type { TrialRegisterInput, TrialStatusInput } from "@/lib/validation/schemas";

/** 试用天数（服务端权威，写入后不变）。 */
export const TRIAL_DAYS = 7;

const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

export type TrialStatus = "TRIAL" | "EXPIRED" | "CONVERTED" | "UNREGISTERED";

export interface TrialStateResult {
  deviceIdHash: string;
  status: Exclude<TrialStatus, "UNREGISTERED">;
  trialStartedAt: string;
  trialExpiresAt: string;
  serverTime: string;
}

function computeStatus(trialExpiresAt: Date, now: Date): "TRIAL" | "EXPIRED" {
  return trialExpiresAt > now ? "TRIAL" : "EXPIRED";
}

/**
 * 登记试用（幂等）。
 * - 命中既有记录 → 直接返回当前 state（不重置试用起点，防重装续命）。
 * - 无记录 → 创建，trialStartedAt=now，trialExpiresAt=now+7d，status=TRIAL。
 */
export async function registerTrial(opts: {
  input: TrialRegisterInput;
  ip: string;
  ua: string | null;
}): Promise<TrialStateResult> {
  const { input, ip, ua } = opts;
  const now = new Date();
  const deviceIdHash = input.device.deviceIdHash;

  const existing = await prisma.deviceTrial.findUnique({
    where: { deviceIdHash },
  });

  if (existing) {
    // 不重置试用起点；刷新最近 IP/UA/版本与运行时 status
    const runtimeStatus = computeStatus(existing.trialExpiresAt, now);
    const updated = await prisma.deviceTrial.update({
      where: { id: existing.id },
      data: {
        ipLast: ip,
        userAgentLast: ua,
        appVersion: input.app.version,
        os: input.device.os,
        arch: input.device.arch,
        machineIdHash: input.device.machineIdHash ?? existing.machineIdHash,
        macHash: input.device.macHash ?? existing.macHash,
        hostnameHash: input.device.hostnameHash ?? existing.hostnameHash,
        // 若 DB 内仍为 TRIAL 但已超期，落 EXPIRED（不阻断返回，仅状态标记）
        status: existing.status === "TRIAL" && runtimeStatus === "EXPIRED" ? "EXPIRED" : existing.status,
      },
    });
    return {
      deviceIdHash,
      status: updated.status as Exclude<TrialStatus, "UNREGISTERED">,
      trialStartedAt: updated.trialStartedAt.toISOString(),
      trialExpiresAt: updated.trialExpiresAt.toISOString(),
      serverTime: now.toISOString(),
    };
  }

  const created = await prisma.deviceTrial.create({
    data: {
      deviceIdHash,
      machineIdHash: input.device.machineIdHash ?? null,
      macHash: input.device.macHash ?? null,
      hostnameHash: input.device.hostnameHash ?? null,
      os: input.device.os,
      arch: input.device.arch,
      appVersion: input.app.version,
      trialStartedAt: now,
      trialExpiresAt: new Date(now.getTime() + TRIAL_MS),
      status: "TRIAL",
      ipFirst: ip,
      ipLast: ip,
      userAgentLast: ua,
    },
  });

  return {
    deviceIdHash,
    status: "TRIAL",
    trialStartedAt: created.trialStartedAt.toISOString(),
    trialExpiresAt: created.trialExpiresAt.toISOString(),
    serverTime: now.toISOString(),
  };
}

/**
 * 轻量探测（每小时一次）：仅按 deviceIdHash 返回状态，未登记返回 UNREGISTERED。
 */
export async function probeTrialStatus(opts: {
  input: TrialStatusInput;
}): Promise<{ status: TrialStatus; trialStartedAt?: string; trialExpiresAt?: string; serverTime: string }> {
  const { input } = opts;
  const now = new Date();
  const record = await prisma.deviceTrial.findUnique({
    where: { deviceIdHash: input.deviceIdHash },
  });
  if (!record) {
    return { status: "UNREGISTERED", serverTime: now.toISOString() };
  }
  const runtimeStatus = computeStatus(record.trialExpiresAt, now);
  // 落库同步状态（不阻塞返回）
  if (record.status === "TRIAL" && runtimeStatus === "EXPIRED") {
    await prisma.deviceTrial.update({
      where: { id: record.id },
      data: { status: "EXPIRED" },
    });
  }
  return {
    status: (record.status === "TRIAL" ? runtimeStatus : record.status) as Exclude<TrialStatus, "UNREGISTERED">,
    trialStartedAt: record.trialStartedAt.toISOString(),
    trialExpiresAt: record.trialExpiresAt.toISOString(),
    serverTime: now.toISOString(),
  };
}
