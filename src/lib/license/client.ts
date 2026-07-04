import crypto from "node:crypto";
import { APP_VERSION } from "@/lib/site";
import { collectLicenseDevice } from "@/lib/license/device";
import { bodyHashOf, signRequest } from "@/lib/license/request-signature";
import {
  clearLocalLicenseState,
  defaultLicenseServiceUrl,
  licenseFingerprint,
  normalizeServiceBaseUrl,
  readLocalLicenseState,
  type LocalLicenseState,
  writeLocalLicenseState,
} from "@/lib/license/store";

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error?: { code?: string; message?: string } };

type ActivateResponse = {
  activationId: string;
  status: "ACTIVE";
  effectiveExpiresAt: string | null;
  maxDevices: number;
  activatedDevices: number;
  licenseToken: string;
  activationSecret: string;
  nextCheckAt: string;
  offlineGraceSeconds?: number;
  metadata?: Record<string, unknown>;
};

type ValidateResponse = {
  status: "ACTIVE" | "EXPIRED" | "DISABLED" | "REVOKED" | "DEVICE_MISMATCH";
  effectiveExpiresAt: string | null;
  licenseToken?: string;
  nextCheckAt?: string;
  offlineGraceSeconds?: number;
  metadata?: Record<string, unknown>;
  message?: string;
};

export type LicenseRuntimeStatus = {
  required: boolean;
  allowed: boolean;
  mode: "active" | "offline-grace" | "inactive" | "invalid" | "not-required";
  state: Omit<LocalLicenseState, "activationSecret" | "licenseToken"> | null;
  message?: string;
};

function offlineGraceExpiresAt(seconds = 72 * 60 * 60): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function publicState(state: LocalLicenseState | null): LicenseRuntimeStatus["state"] {
  if (!state) return null;
  const { activationSecret: _secret, licenseToken: _token, ...safe } = state;
  return safe;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof Error;
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response.json().catch(() => ({
    ok: false,
    error: { message: `License 服务返回 ${response.status}` },
  }))) as ApiEnvelope<T>;
}

export async function activateLocalLicense(input: {
  licenseKey: string;
  serviceBaseUrl?: string;
}): Promise<LicenseRuntimeStatus> {
  const serviceBaseUrl = normalizeServiceBaseUrl(
    input.serviceBaseUrl || defaultLicenseServiceUrl()
  );
  const device = collectLicenseDevice();
  const response = await fetch(`${serviceBaseUrl}/api/v1/licenses/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      licenseKey: input.licenseKey,
      device,
      app: {
        version: APP_VERSION,
        channel: process.env.NODE_ENV === "production" ? "stable" : "dev",
      },
    }),
  });
  const envelope = await parseEnvelope<ActivateResponse>(response);
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.ok ? "激活失败" : envelope.error?.message ?? "激活失败");
  }
  const now = new Date().toISOString();
  const state: LocalLicenseState = {
    serviceBaseUrl,
    activationId: envelope.data.activationId,
    deviceIdHash: device.deviceIdHash,
    licenseFingerprint: licenseFingerprint(input.licenseKey),
    licenseToken: envelope.data.licenseToken,
    activationSecret: envelope.data.activationSecret,
    status: envelope.data.status,
    effectiveExpiresAt: envelope.data.effectiveExpiresAt,
    maxDevices: envelope.data.maxDevices,
    activatedDevices: envelope.data.activatedDevices,
    nextCheckAt: envelope.data.nextCheckAt,
    lastValidatedAt: now,
    offlineGraceExpiresAt: offlineGraceExpiresAt(envelope.data.offlineGraceSeconds),
    metadata: envelope.data.metadata,
  };
  writeLocalLicenseState(state);
  return { required: true, allowed: true, mode: "active", state: publicState(state) };
}

function signedHeaders(state: LocalLicenseState, path: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString("hex");
  return {
    "content-type": "application/json",
    "x-inkpress-client-id": state.licenseFingerprint,
    "x-inkpress-device-id": state.deviceIdHash,
    "x-inkpress-timestamp": timestamp,
    "x-inkpress-nonce": nonce,
    "x-inkpress-signature": signRequest({
      secret: state.activationSecret,
      method: "POST",
      path,
      timestamp,
      nonce,
      bodyHash: bodyHashOf(body),
    }),
  };
}

export async function validateLocalLicense(): Promise<LicenseRuntimeStatus> {
  const state = readLocalLicenseState();
  if (!state) {
    return { required: true, allowed: false, mode: "inactive", state: null };
  }
  const path = "/api/v1/licenses/validate";
  const body = JSON.stringify({
    activationId: state.activationId,
    deviceIdHash: state.deviceIdHash,
    appVersion: APP_VERSION,
    licenseToken: state.licenseToken,
  });
  try {
    const response = await fetch(`${state.serviceBaseUrl}${path}`, {
      method: "POST",
      headers: signedHeaders(state, path, body),
      body,
    });
    const envelope = await parseEnvelope<ValidateResponse>(response);
    if (!response.ok || !envelope.ok) {
      return {
        required: true,
        allowed: false,
        mode: "invalid",
        state: publicState(state),
        message: envelope.ok ? "License 校验失败" : envelope.error?.message,
      };
    }
    const next: LocalLicenseState = {
      ...state,
      status: envelope.data.status,
      effectiveExpiresAt: envelope.data.effectiveExpiresAt,
      licenseToken: envelope.data.licenseToken ?? state.licenseToken,
      nextCheckAt: envelope.data.nextCheckAt,
      lastValidatedAt: new Date().toISOString(),
      offlineGraceExpiresAt: offlineGraceExpiresAt(envelope.data.offlineGraceSeconds),
      metadata: envelope.data.metadata ?? state.metadata,
    };
    writeLocalLicenseState(next);
    return {
      required: true,
      allowed: envelope.data.status === "ACTIVE",
      mode: envelope.data.status === "ACTIVE" ? "active" : "invalid",
      state: publicState(next),
      message: envelope.data.message,
    };
  } catch (error) {
    if (isNetworkError(error) && new Date(state.offlineGraceExpiresAt).getTime() > Date.now()) {
      return {
        required: true,
        allowed: true,
        mode: "offline-grace",
        state: publicState(state),
        message: "License 服务暂不可用，当前处于离线宽限期。",
      };
    }
    return {
      required: true,
      allowed: false,
      mode: "invalid",
      state: publicState(state),
      message: error instanceof Error ? error.message : "License 校验失败",
    };
  }
}

export async function deactivateLocalLicense(): Promise<LicenseRuntimeStatus> {
  const state = readLocalLicenseState();
  if (!state) return { required: true, allowed: false, mode: "inactive", state: null };
  const path = "/api/v1/licenses/deactivate";
  const body = JSON.stringify({
    activationId: state.activationId,
    deviceIdHash: state.deviceIdHash,
  });
  const response = await fetch(`${state.serviceBaseUrl}${path}`, {
    method: "POST",
    headers: signedHeaders(state, path, body),
    body,
  });
  const envelope = await parseEnvelope<unknown>(response);
  if (!response.ok || !envelope.ok) {
    throw new Error(envelope.ok ? "释放失败" : envelope.error?.message ?? "释放失败");
  }
  clearLocalLicenseState();
  return { required: true, allowed: false, mode: "inactive", state: null };
}

