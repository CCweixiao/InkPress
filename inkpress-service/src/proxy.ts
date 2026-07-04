import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

/**
 * 路由保护 + 动态 CSP（PDC §3.3 / §9.1）。
 *
 * 使用 edge 安全的 authConfig，authorized 回调判定：
 * - /dashboard：需登录
 * - /admin：需登录且 role=ADMIN，否则重定向
 * 未登录由 Auth.js 自动跳转 pages.signIn（=/login）。
 *
 * CSP 必须在 proxy 中按请求生成 nonce。Next.js 会从 request header 的
 * Content-Security-Policy 中解析 nonce，并自动加到框架脚本上；若用
 * next.config.ts 静态 `script-src 'self'`，刷新 /login 时会拦截 inline bootstrap，
 * 继而触发 `Expected a request ID ... self.__next_r`。
 */
const { auth } = NextAuth(authConfig);

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function buildCsp(nonce: string): string {
  const devScript = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";
  const devConnect = process.env.NODE_ENV !== "production" ? " ws: wss:" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${devScript}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${devConnect}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export default auth((req) => {
  if (process.env.SECURITY_HEADERS_ENABLE === "false") {
    return NextResponse.next();
  }

  const nonce = createNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: [
    /*
     * 覆盖页面路由（含 /login /register /dashboard /admin），排除 API、Next 静态资源、
     * 图片优化和带扩展名的静态文件。API 的非 CSP 安全头仍由 next.config.ts 下发。
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
