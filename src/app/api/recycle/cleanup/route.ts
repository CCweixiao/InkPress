import { NextResponse } from "next/server";
import { cleanupExpired } from "@/lib/recycle";

export const runtime = "nodejs";

/** 清理所有过期回收站项（打开回收站时调用，懒删除） */
export async function POST() {
  const result = await cleanupExpired();
  return NextResponse.json({ ok: true, ...result });
}
