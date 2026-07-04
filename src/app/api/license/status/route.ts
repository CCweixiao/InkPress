import { NextResponse } from "next/server";
import { licenseGuard } from "@/lib/license/guard";
import { defaultLicenseServiceUrl, isLicenseRequired } from "@/lib/license/store";
import { signGate, GATE_COOKIE_NAME } from "@/lib/license/gate-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await licenseGuard();

  const res = NextResponse.json({
    ...status,
    required: isLicenseRequired(),
    defaultServiceBaseUrl: defaultLicenseServiceUrl(),
  });

  // 写入 gate cookie（5 分钟 TTL，供 Edge middleware 廉价重定向）
  try {
    const gateValue = await signGate({
      allowed: status.allowed,
      mode: status.mode,
    });
    res.cookies.set(GATE_COOKIE_NAME, gateValue, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 300, // 5 分钟
      path: "/",
    });
  } catch {
    // gate cookie 写入失败不影响 status 返回
  }

  return res;
}
