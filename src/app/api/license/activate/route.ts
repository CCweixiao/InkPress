import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { activateLocalLicense } from "@/lib/license/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  licenseKey: z.string().trim().min(1),
  serviceBaseUrl: z.string().trim().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const status = await activateLocalLicense(parsed.data);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "激活失败" },
      { status: 400 }
    );
  }
}

