import { NextResponse } from "next/server";
import { cleanupExpired } from "@/lib/recycle";
import { moduleLogger } from "@/lib/logger";
import { withApiLog } from "@/lib/api-log";

const log = moduleLogger("recycle.cleanup");

export const runtime = "nodejs";

/** 清理所有过期回收站项（打开回收站时调用，懒删除） */
export const POST = withApiLog("POST /api/recycle/cleanup", async () => {
  const result = await cleanupExpired();
  log.info(result, "已清理过期回收站项");
  return NextResponse.json({ ok: true, ...result });
});
