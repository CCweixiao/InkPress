/**
 * 客户端试用状态（7 天免费试用）。
 *
 * 状态文件 app-state.enc（中性名，复用 secret-store AES-256-GCM at-rest 加密）。
 *
 * 权威模型：
 * - 首次创建：本地 trialStartedAt=now, trialExpiresAt=now+7d。
 * - 联网成功（register/probe）后，服务端 trialStartedAt/trialExpiresAt 覆盖本地（锁定）。
 * - 之后修改本地时钟无法续命（服务端 trialExpiresAt 权威）。
 *
 * 防时钟回拨：trialLastCheckedAt 使用 max(now, prev) monotonic 更新。
 */
import fs from "node:fs";
import path from "node:path";
import { inkpressHomeDir } from "@/lib/paths";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-store";
import { APP_VERSION } from "@/lib/site";
import { collectLicenseDevice } from "@/lib/license/device";
import { defaultLicenseServiceUrl, normalizeServiceBaseUrl } from "@/lib/license/store";

/** 试用天数（与服务端一致）。 */
export const TRIAL_DAYS = 7;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

// 中性文件名，避免明显的 "trial" 字样
const TRIAL_STATE_FILE = path.join(inkpressHomeDir(), "app-state.enc");

export type TrialStateStatus = "TRIAL" | "EXPIRED" | "CONVERTED";

export type TrialState = {
  deviceIdHash: string;
  trialStartedAt: string; // ISO；首次创建=本地 now；联网成功后被服务端值覆盖
  trialExpiresAt: string; // = trialStartedAt + 7d
  trialLastCheckedAt: string; // monotonic：max(now, prev)，防时钟回拨
  serverRegisteredAt: string | null; // 非 null 表示已锁定到服务端
  serverSyncedAt: string | null;
  status: TrialStateStatus;
};

type TrialServiceState = {
  deviceIdHash: string;
  status: "TRIAL" | "EXPIRED" | "CONVERTED" | "UNREGISTERED";
  trialStartedAt?: string;
  trialExpiresAt?: string;
  serverTime: string;
};

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error?: { code?: string; message?: string } };

function readTrialStateRaw(): TrialState | null {
  try {
    if (!fs.existsSync(TRIAL_STATE_FILE)) return null;
    const decrypted = decryptSecret(fs.readFileSync(TRIAL_STATE_FILE, "utf8"));
    if (!decrypted) return null;
    return JSON.parse(decrypted) as TrialState;
  } catch {
    return null;
  }
}

function writeTrialStateRaw(state: TrialState) {
  fs.mkdirSync(path.dirname(TRIAL_STATE_FILE), { recursive: true });
  fs.writeFileSync(TRIAL_STATE_FILE, encryptSecret(JSON.stringify(state)), {
    mode: 0o600,
  });
}

/** 读或建本地试用状态；deviceIdHash 与当前设备不一致时重建。 */
export function getOrCreateTrialState(): TrialState {
  const device = collectLicenseDevice();
  const existing = readTrialStateRaw();
  if (existing && existing.deviceIdHash === device.deviceIdHash) {
    return existing;
  }
  const now = new Date();
  const state: TrialState = {
    deviceIdHash: device.deviceIdHash,
    trialStartedAt: now.toISOString(),
    trialExpiresAt: new Date(now.getTime() + TRIAL_MS).toISOString(),
    trialLastCheckedAt: now.toISOString(),
    serverRegisteredAt: null,
    serverSyncedAt: null,
    status: "TRIAL",
  };
  writeTrialStateRaw(state);
  return state;
}

export type TrialEvaluation = {
  inTrial: boolean;
  expired: boolean;
  tampered: boolean;
  remainingMs: number;
};

function parseTimeMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * 本地判定试用状态（不联网）。
 * - now < trialLastCheckedAt → 时钟回拨 → 视为篡改 → expired。
 * - now > trialExpiresAt → expired。
 * - 否则 inTrial；更新 trialLastCheckedAt = max(now, prev) 后写回。
 */
export function evaluateTrial(state: TrialState): TrialEvaluation {
  const nowMs = Date.now();
  const lastCheckedMs = parseTimeMs(state.trialLastCheckedAt);
  const expiresMs = parseTimeMs(state.trialExpiresAt);

  const invalidClockState = !Number.isFinite(lastCheckedMs) || !Number.isFinite(expiresMs);
  const tampered = invalidClockState || nowMs < lastCheckedMs - 60_000; // 60s 容差（NTP 微调）
  const remainingMs = Number.isFinite(expiresMs) ? expiresMs - nowMs : 0;
  const alreadyExpired = state.status === "EXPIRED";
  const expired = alreadyExpired || tampered || remainingMs <= 0;

  // monotonic 更新 trialLastCheckedAt
  const safeLastCheckedMs = Number.isFinite(lastCheckedMs) ? lastCheckedMs : nowMs;
  const nextChecked = new Date(Math.max(nowMs, safeLastCheckedMs)).toISOString();
  if (nextChecked !== state.trialLastCheckedAt || state.status !== (expired ? "EXPIRED" : state.status)) {
    const updated: TrialState = {
      ...state,
      trialLastCheckedAt: nextChecked,
      status: expired ? "EXPIRED" : state.status === "CONVERTED" ? "CONVERTED" : "TRIAL",
    };
    writeTrialStateRaw(updated);
  }

  return {
    inTrial: !expired,
    expired,
    tampered,
    remainingMs: expired ? 0 : Math.max(0, remainingMs),
  };
}

/** 用服务端状态覆盖本地（锁定试用起点）。 */
function applyServerState(local: TrialState, remote: TrialServiceState): TrialState {
  const nowMs = Date.now();
  const serverMs = parseTimeMs(remote.serverTime);
  const checkedMs = Math.max(nowMs, Number.isFinite(serverMs) ? serverMs : nowMs);
  const checkedIso = new Date(checkedMs).toISOString();
  const next: TrialState = {
    ...local,
    deviceIdHash: remote.deviceIdHash ?? local.deviceIdHash,
    trialStartedAt: remote.trialStartedAt ?? local.trialStartedAt,
    trialExpiresAt: remote.trialExpiresAt ?? local.trialExpiresAt,
    trialLastCheckedAt: checkedIso,
    serverRegisteredAt: local.serverRegisteredAt ?? remote.trialStartedAt ?? null,
    serverSyncedAt: checkedIso,
    status: remote.status === "UNREGISTERED" ? local.status : remote.status,
  };
  writeTrialStateRaw(next);
  return next;
}

/** POST /api/v1/trial/register — 首次离线试用联网后锁定。 */
export async function registerTrial(): Promise<TrialState> {
  const baseUrl = normalizeServiceBaseUrl(defaultLicenseServiceUrl());
  const device = collectLicenseDevice();
  const local = getOrCreateTrialState();
  const response = await fetch(`${baseUrl}/api/v1/trial/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device,
      app: {
        version: APP_VERSION,
        channel: process.env.NODE_ENV === "production" ? "stable" : "dev",
      },
    }),
  });
  const envelope = (await response
    .json()
    .catch(() => ({ ok: false, error: { message: `试用服务返回 ${response.status}` } }))) as ApiEnvelope<TrialServiceState>;
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.ok ? "试用登记失败" : envelope.error?.message ?? "试用登记失败");
  }
  return applyServerState(local, envelope.data);
}

/** POST /api/v1/trial/status — 轻量探测（每小时一次）。 */
export async function probeTrialStatus(): Promise<TrialState> {
  const baseUrl = normalizeServiceBaseUrl(defaultLicenseServiceUrl());
  const local = getOrCreateTrialState();
  const response = await fetch(`${baseUrl}/api/v1/trial/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceIdHash: local.deviceIdHash }),
  });
  const envelope = (await response
    .json()
    .catch(() => ({ ok: false, error: { message: `试用探测返回 ${response.status}` } }))) as ApiEnvelope<TrialServiceState>;
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.ok ? "试用探测失败" : envelope.error?.message ?? "试用探测失败");
  }
  // UNREGISTERED → 客户端应改走 register
  if (envelope.data.status === "UNREGISTERED") {
    return registerTrial();
  }
  return applyServerState(local, envelope.data);
}

/** 转为正式激活后调用，标记 CONVERTED（不再影响判定）。 */
export function markTrialConverted() {
  const local = readTrialStateRaw();
  if (!local) return;
  writeTrialStateRaw({ ...local, status: "CONVERTED" });
}
