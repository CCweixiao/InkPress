import { NextResponse } from "next/server";
import { deactivateLocalLicense } from "@/lib/license/client";
import { attachGateCookie } from "@/lib/license/gate-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const status = await deactivateLocalLicense();
    const res = NextResponse.json(status);
    await attachGateCookie(res, status);
    return res;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "释放失败" },
      { status: 400 }
    );
  }
}
