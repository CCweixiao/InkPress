import { NextRequest, NextResponse } from "next/server";
import { resolveRange, heatmapUsage } from "@/lib/ai/usage-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ai/usage/heatmap?range=&from=&to= — 每日 token 活跃度热力图（PDC §12.9）。 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange(sp.get("range"), sp.get("from"), sp.get("to"));
  const cells = await heatmapUsage(range);
  return NextResponse.json({ cells });
}
