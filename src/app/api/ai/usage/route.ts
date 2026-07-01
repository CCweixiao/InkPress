import { NextRequest, NextResponse } from "next/server";
import { clearUsage } from "@/lib/ai/usage-ledger";
import { withApiLog } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_TOKEN = "CLEAR_USAGE";

/**
 * DELETE /api/ai/usage — 清空 token 统计（PDC §12.6 危险操作）。
 *
 * 仅删 AgentUsageTurn 流水，不动文章 / 消息 / Claude session。
 * 必须显式二次确认：body { confirm: "CLEAR_USAGE" }，否则 400 拒绝。
 */
export const DELETE = withApiLog("DELETE /api/ai/usage", async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== CONFIRM_TOKEN) {
    return NextResponse.json(
      { error: "需要二次确认：请在 body 中提供 { confirm: \"CLEAR_USAGE\" }。" },
      { status: 400 }
    );
  }
  const deleted = await clearUsage();
  return NextResponse.json({ ok: true, deleted });
});
