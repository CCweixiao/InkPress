import { NextResponse } from "next/server";
import { licenseGuard } from "@/lib/license/guard";
import { defaultLicenseServiceUrl, isLicenseRequired } from "@/lib/license/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await licenseGuard();
  return NextResponse.json({
    ...status,
    required: isLicenseRequired(),
    defaultServiceBaseUrl: defaultLicenseServiceUrl(),
  });
}

