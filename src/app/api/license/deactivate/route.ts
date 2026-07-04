import { NextResponse } from "next/server";
import { deactivateLocalLicense } from "@/lib/license/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const status = await deactivateLocalLicense();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "释放失败" },
      { status: 400 }
    );
  }
}

