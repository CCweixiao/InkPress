import type { NextResponse } from "next/server";
import type { LicenseRuntimeStatus } from "@/lib/license/client";
import { GATE_COOKIE_NAME, signGate } from "@/lib/license/gate-cookie";

export async function attachGateCookie(
  res: NextResponse,
  status: Pick<LicenseRuntimeStatus, "allowed" | "mode">
): Promise<void> {
  try {
    const gateValue = await signGate({
      allowed: status.allowed,
      mode: status.mode,
    });
    res.cookies.set(GATE_COOKIE_NAME, gateValue, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 300,
      path: "/",
    });
  } catch {
    // gate cookie 写入失败不影响业务响应
  }
}
