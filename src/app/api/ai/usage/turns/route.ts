import { NextRequest, NextResponse } from "next/server";
import { listUsageTurns, resolveRange } from "@/lib/ai/usage-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/usage/turns?from=&to=&modelId=&targetId=&status=&limit=&cursor=
 * 明细表（PDC §12.9）：游标分页 + 多维过滤。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange(sp.get("range"), sp.get("from"), sp.get("to"));
  const limitRaw = sp.get("limit");
  const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 50;
  const cursor = sp.get("cursor");
  const result = await listUsageTurns({
    range,
    modelId: sp.get("modelId"),
    targetId: sp.get("targetId"),
    status: sp.get("status"),
    limit,
    cursor,
  });
  return NextResponse.json(result);
}
