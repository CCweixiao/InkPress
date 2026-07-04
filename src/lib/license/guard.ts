import { NextResponse } from "next/server";
import { validateLocalLicense } from "@/lib/license/client";
import { isLicenseRequired } from "@/lib/license/store";

export async function licenseGuard() {
  if (!isLicenseRequired()) {
    return {
      required: false,
      allowed: true,
      mode: "not-required" as const,
      state: null,
    };
  }
  return validateLocalLicense();
}

export async function requireLicenseForApi() {
  const status = await licenseGuard();
  if (status.allowed) return null;
  return NextResponse.json(
    {
      error: status.message ?? "License 未激活或已失效。",
      code: "LICENSE_REQUIRED",
      license: status,
    },
    { status: 402 }
  );
}
