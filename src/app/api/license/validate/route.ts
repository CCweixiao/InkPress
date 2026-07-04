import { NextResponse } from "next/server";
import { validateLocalLicense } from "@/lib/license/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await validateLocalLicense();
  return NextResponse.json(status, { status: status.allowed ? 200 : 402 });
}

