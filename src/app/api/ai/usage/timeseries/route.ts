import { NextRequest, NextResponse } from "next/server";
import { resolveRange, timeseriesUsage } from "@/lib/ai/usage-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/usage/timeseries?bucket=hour|day|week&groupBy=model|target|status&range=&from=&to=
 * 主趋势图（PDC §12.9）：按 bucket + 维度聚合 token/cost。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const bucket = (sp.get("bucket") as "hour" | "day" | "week") ?? "day";
  const groupBy = (sp.get("groupBy") as "model" | "target" | "status") ?? "model";
  const range = resolveRange(sp.get("range"), sp.get("from"), sp.get("to"));
  const points = await timeseriesUsage(
    range,
    bucket === "hour" || bucket === "week" ? bucket : "day",
    groupBy === "target" || groupBy === "status" ? groupBy : "model"
  );
  return NextResponse.json({ points, bucket, groupBy });
}
