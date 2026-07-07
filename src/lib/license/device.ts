import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inkpressHomeDir } from "@/lib/paths";

const INSTALL_ID_FILE = path.join(inkpressHomeDir(), ".license-installation-id");

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getOrCreateInstallId(): string {
  try {
    if (fs.existsSync(INSTALL_ID_FILE)) {
      const value = fs.readFileSync(INSTALL_ID_FILE, "utf8").trim();
      if (value) return value;
    }
    fs.mkdirSync(path.dirname(INSTALL_ID_FILE), { recursive: true });
    const value = crypto.randomUUID();
    fs.writeFileSync(INSTALL_ID_FILE, value, { mode: 0o600 });
    return value;
  } catch {
    return crypto.randomUUID();
  }
}

function macHash(): string | undefined {
  const macs = Object.values(os.networkInterfaces())
    .flatMap((items) => items ?? [])
    .map((item) => item.mac)
    .filter((mac) => mac && mac !== "00:00:00:00:00:00")
    .sort();
  return macs.length > 0 ? sha256Hex(macs.join("|")) : undefined;
}

export function collectLicenseDevice() {
  const installId = getOrCreateInstallId();
  const hostnameHash = sha256Hex(os.hostname());
  const machineIdHash = sha256Hex(installId);
  const mac = macHash();
  const deviceIdHash = sha256Hex(
    [machineIdHash, hostnameHash, mac ?? "", os.platform(), os.arch()].join(":")
  );
  return {
    deviceIdHash,
    machineIdHash,
    macHash: mac,
    hostnameHash,
    os: os.platform() as "darwin" | "win32" | "linux",
    arch: os.arch(),
  };
}

