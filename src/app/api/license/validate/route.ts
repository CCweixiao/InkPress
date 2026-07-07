import { NextResponse } from "next/server";
import { validateLocalLicense } from "@/lib/license/client";
import { attachGateCookie } from "@/lib/license/gate-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await validateLocalLicense();
  const res = NextResponse.json(status, { status: status.allowed ? 200 : 402 });
  await attachGateCookie(res, status);
  return res;
}
