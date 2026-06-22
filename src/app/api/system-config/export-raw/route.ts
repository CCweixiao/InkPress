import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LLM_CONFIG_KEY } from "@/lib/ai/llm-config";
import { AGENT_CONFIG_KEY } from "@/lib/ai/agent-config";
import { OSS_CONFIG_KEY } from "@/lib/oss-config";
import { WECHAT_CONFIG_KEY } from "@/lib/wechat/config";
import { withApiLog, logMutation } from "@/lib/api-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 导出四大类配置的**真实值**（含密钥明文，绕过 maskConfigs）。
 *
 * 供前端加密导出使用：明文只在响应里短暂存在，由浏览器立即用用户密码
 * AES-256-GCM 加密后下载，服务端不接触密码、不落盘明文。
 *
 * 扩展性：新增配置类型只需往 EXPORT_KEYS 加入其 CONFIG_KEY。
 */
const EXPORT_KEYS = [
  LLM_CONFIG_KEY,
  AGENT_CONFIG_KEY,
  OSS_CONFIG_KEY,
  WECHAT_CONFIG_KEY,
];

export const GET = withApiLog(
  "GET /api/system-config/export-raw",
  async () => {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: EXPORT_KEYS } },
      select: { key: true, value: true },
    });
    logMutation("systemConfig", "export-raw", { keys: rows.map((r) => r.key) });
    // 按 EXPORT_KEYS 顺序排列，缺的 key 跳过（未配置不导出）
    const configs = EXPORT_KEYS.map((k) =>
      rows.find((r) => r.key === k)
    ).filter((r): r is { key: string; value: string } => !!r);
    return NextResponse.json({ ok: true, configs });
  }
);
