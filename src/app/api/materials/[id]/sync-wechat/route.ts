import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncAssetToWechat, persistSyncResult } from "@/lib/wechat/asset-sync";
import { withApiLog, logMutation } from "@/lib/api-log";
import { moduleLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = moduleLogger("asset.sync-wechat");

/**
 * 手动重试：把已上传到 OSS 的素材同步到公众号素材库。
 * 典型场景：上传时勾选了同步但失败（凭证未配/网络超时），事后在此重试。
 * 成功/失败都更新 Asset 的 wx* 字段。
 */
export const POST = withApiLog(
  "POST /api/materials/[id]/sync-wechat",
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }

    const result = await syncAssetToWechat({
      url: asset.url,
      contentType: asset.contentType || "application/octet-stream",
      filename: asset.name,
    });
    await persistSyncResult(id, result);
    logMutation("asset", "sync-wechat", { id, ok: result.ok });

    if (!result.ok) {
      log.warn({ id, reason: result.reason }, "素材同步公众号失败（重试）");
      return NextResponse.json({ error: result.reason }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      wxUrl: result.wxUrl,
      wxMediaId: result.wxMediaId,
      wxSyncStatus: "success",
    });
  }
);
