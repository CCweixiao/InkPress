import { NextResponse } from "next/server";
import { licenseGuard } from "@/lib/license/guard";
import { defaultLicenseServiceUrl, isLicenseRequired } from "@/lib/license/store";
import { attachGateCookie } from "@/lib/license/gate-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await licenseGuard();

  const res = NextResponse.json({
    ...status,
    required: isLicenseRequired(),
    defaultServiceBaseUrl: defaultLicenseServiceUrl(),
  });

  await attachGateCookie(res, status);

  return res;
}
