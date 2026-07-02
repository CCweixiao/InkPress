import { NextResponse } from "next/server";
import { writeResetMarker } from "@/lib/data-portability";
import { inkpressHomeDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/data/reset
 * body: { confirm: "RESET" }
 * 写入恢复出厂标记。需重启 InkPress：Electron 主进程启动时清空数据目录后重建。
 * 开发模式无主进程，需手动删除 ~/.inkpress 或 dev.db。
 */
export async function POST(req: Request) {
  let body: { confirm?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (body.confirm !== "RESET") {
    return NextResponse.json(
      { error: "请传 { confirm: \"RESET\" } 以确认恢复出厂。" },
      { status: 400 }
    );
  }
  try {
    writeResetMarker();
    return NextResponse.json({
      ok: true,
      message: "已标记恢复出厂。请重启 InkPress（主进程将清空数据目录后重建）。",
      home: inkpressHomeDir(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "标记失败" },
      { status: 500 }
    );
  }
}
