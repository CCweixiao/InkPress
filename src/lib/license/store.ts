import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inkpressHomeDir } from "@/lib/paths";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-store";

const LICENSE_STATE_FILE = path.join(inkpressHomeDir(), "license-state.enc");

export type LocalLicenseState = {
  serviceBaseUrl: string;
  activationId: string;
  deviceIdHash: string;
  licenseFingerprint: string;
  licenseToken: string;
  activationSecret: string;
  status: string;
  effectiveExpiresAt: string | null;
  maxDevices: number;
  activatedDevices?: number;
  nextCheckAt?: string;
  lastValidatedAt: string;
  offlineGraceExpiresAt: string;
  metadata?: Record<string, unknown>;
};

export function normalizeServiceBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("License 服务地址必须以 http:// 或 https:// 开头");
  }
  return trimmed;
}

export function defaultLicenseServiceUrl(): string {
  return (
    process.env.INKPRESS_LICENSE_SERVICE_URL ??
    process.env.NEXT_PUBLIC_INKPRESS_LICENSE_SERVICE_URL ??
    ""
  ).trim();
}

export function isLicenseRequired(): boolean {
  const raw = process.env.INKPRESS_LICENSE_REQUIRED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return process.env.NODE_ENV === "production";
}

export function licenseFingerprint(licenseKey: string): string {
  return crypto.createHash("sha256").update(licenseKey).digest("hex").slice(0, 12);
}

export function readLocalLicenseState(): LocalLicenseState | null {
  try {
    if (!fs.existsSync(LICENSE_STATE_FILE)) return null;
    const decrypted = decryptSecret(fs.readFileSync(LICENSE_STATE_FILE, "utf8"));
    if (!decrypted) return null;
    return JSON.parse(decrypted) as LocalLicenseState;
  } catch {
    return null;
  }
}

export function writeLocalLicenseState(state: LocalLicenseState) {
  fs.mkdirSync(path.dirname(LICENSE_STATE_FILE), { recursive: true });
  fs.writeFileSync(LICENSE_STATE_FILE, encryptSecret(JSON.stringify(state)), {
    mode: 0o600,
  });
}

export function clearLocalLicenseState() {
  try {
    fs.rmSync(LICENSE_STATE_FILE, { force: true });
  } catch {
    // ignore
  }
}

