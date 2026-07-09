/**
 * 全局拦截 proxy（Node.js runtime，Next.js 16 强制）。
 *
 * 核心思路：昂贵的 license 检查留在 server route / instrumentation；
 * 这里只读签名 cookie `ip-gate` 做廉价重定向。
 *
 * - allowed === false → 重定向 /license?reason=...
 * - cookie 缺失/过期/验签失败 → 放行（由页面/弹窗触发 status 刷新并回写 cookie）
 *
 * Matcher 排除：/license、/api/license/*、/_next/*、静态资源。
 *
 * Next.js 16 升级要点：
 * - middleware.ts → proxy.ts（文件名约定改名）
 * - experimental-edge 运行时已废弃；proxy.ts 强制 Node.js runtime，
 *   禁止再导出 `runtime` 配置（否则报 Route segment config is not allowed）。
 * - verifyGate 用 Web Crypto API，Node 18+ 全局可用，无需改动。
 */
import { NextRequest, NextResponse } from "next/server";
import { GATE_COOKIE_NAME, verifyGate } from "@/lib/license/gate-cookie";

// 不拦截的路径前缀
const PUBLIC_PATHS = [
  "/license",
  "/api/license",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公开路径放行
  if (isPublicPath(pathname)) return NextResponse.next();

  // 读 gate cookie
  const cookie = req.cookies.get(GATE_COOKIE_NAME)?.value;
  const gate = await verifyGate(cookie);

  if (gate) {
    if (!gate.allowed) {
      const reason = gate.mode === "trial-expired" ? "trial_expired" : "invalid";
      const url = req.nextUrl.clone();
      url.pathname = "/license";
      url.searchParams.set("reason", reason);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // cookie 缺失/过期 → 放行（页面 focus 会触发 status 刷新并回写 cookie）
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除：
     * - _next/static, _next/image, favicon
     * - 公开 API
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
