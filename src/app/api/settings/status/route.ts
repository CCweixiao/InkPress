import { NextResponse } from "next/server";
import { hasWechatConfig } from "@/lib/wechat/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 只读返回微信凭证配置状态（不泄露实际值）。凭证来源：SystemConfig 表 inkpress.wechat */
export async function GET() {
  const configured = await hasWechatConfig();
  return NextResponse.json({
    hasWxAppid: configured,
    hasWxSecret: configured,
  });
}
