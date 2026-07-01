import { NextRequest, NextResponse } from "next/server";
import {
  resolveRange,
  summarizeUsage,
  usageInsights,
} from "@/lib/ai/usage-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/usage/summary?range=7d|30d|custom&from=&to=
 * KPI 横条聚合 + 洞察区（PDC §12.8 KPI/洞察、§12.9 口径）。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const range = resolveRange(sp.get("range"), sp.get("from"), sp.get("to"));
  const [summary, insights] = await Promise.all([
    summarizeUsage(range),
    usageInsights(range),
  ]);
  return NextResponse.json({
    summary,
    insights,
    range: { from: range.from, to: range.to },
  });
}

