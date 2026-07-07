import { NextResponse } from "next/server";
import {
  LOG_LEVEL_KEY,
  getPersistedLogLevel,
  persistLogLevel,
} from "@/lib/log-level";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
];

/**
 * GET /api/settings/log-level
 * 返回持久化级别（未设置则 null）、当前 logger 生效级别、合法级别集合。
 */
export async function GET() {
  const persisted = await getPersistedLogLevel();
  return NextResponse.json({
    persisted,
    effective: logger.level,
    key: LOG_LEVEL_KEY,
    valid: VALID_LEVELS,
  });
}

/**
 * PUT /api/settings/log-level
 * body: { level: "debug" | "info" | ... }
 * 持久化 + 即时应用（根 logger 过滤；完整生效建议重启）。
 */
export async function PUT(req: Request) {
  let body: { level?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const level = typeof body.level === "string" ? body.level : "";
  try {
    const applied = await persistLogLevel(level);
    return NextResponse.json({ persisted: applied, effective: logger.level });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "非法日志级别" },
      { status: 400 }
    );
  }
}
