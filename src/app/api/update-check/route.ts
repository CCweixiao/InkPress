import { NextResponse } from "next/server";
import { defaultLicenseServiceUrl } from "@/lib/license/store";

/**
 * GET /api/update-check
 *
 * 本地代理：转发到远端 inkpress-service 的公开 check-update 端点。
 *
 * 为什么不直接从渲染进程调用远端：
 * - CORS：远端 /api/releases/check-update 默认不开放给桌面 origin
 * - 配置一致：serviceBaseUrl 已在 license/store 维护，统一在此消费
 * - 平台探测在 Node 侧更准（process.platform/arch），渲染进程拿不到
 *
 * 客户端 UI（UpdateNotification）调用本路由，根据 hasUpdate 决定是否展示提示。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RemoteUpdateCheckResult = {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releasedAt?: string;
  channel?: string;
  changelogMarkdown?: string | null;
  highlights?: string[];
  downloadUrl?: string;
  downloadPageUrl?: string;
  fileName?: string;
  fileSizeBytes?: number;
};

type RemoteEnvelope =
  | { ok: true; data: RemoteUpdateCheckResult }
  | { ok: false; error?: { code?: string; message?: string } };

/** 把 process.platform + process.arch 映射到发布平台的 schema 值 */
function detectPlatform(): string | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  if (p === "darwin" && a === "x64") return "darwin-x64";
  if (p === "win32" && a === "x64") return "win32-x64";
  if (p === "linux" && a === "x64") return "linux-x64";
  return null;
}

export async function GET() {
  const currentVersion = process.env.APP_VERSION ?? "0.0.0";
  const baseUrl = defaultLicenseServiceUrl();
  const platform = detectPlatform();

  const url = new URL("/api/releases/check-update", baseUrl);
  url.searchParams.set("currentVersion", currentVersion);
  if (platform) url.searchParams.set("platform", platform);
  // channel 默认 stable：客户端目前没有「Beta 通道」开关，普通用户只看 stable 更新

  try {
    const upstream = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      // 不要让 fetch 抛 AbortError：默认超时由底层 TCP 控制
    });

    const body = (await upstream.json()) as RemoteEnvelope;

    if (!body.ok) {
      return NextResponse.json(
        {
          hasUpdate: false,
          currentVersion,
          latestVersion: null,
          error: body.error?.message ?? "远端校验失败",
        },
        { status: 200 } // 即使远端报错也返回 200，UI 静默跳过
      );
    }

    const data = body.data;
    // 把 downloadUrl/downloadPageUrl 补全为远端绝对地址（远端返回的是相对路径）
    const absoluteDownloadUrl = data.downloadUrl
      ? new URL(data.downloadUrl, baseUrl).toString()
      : undefined;
    const absoluteDownloadPageUrl = data.downloadPageUrl
      ? new URL(data.downloadPageUrl, baseUrl).toString()
      : undefined;

    return NextResponse.json(
      {
        ...data,
        downloadUrl: absoluteDownloadUrl,
        downloadPageUrl: absoluteDownloadPageUrl,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch {
    // 网络错误/远端不可达：返回 200 + hasUpdate:false，UI 静默跳过
    return NextResponse.json(
      {
        hasUpdate: false,
        currentVersion,
        latestVersion: null,
        error: "网络错误",
      },
      { status: 200 }
    );
  }
}
