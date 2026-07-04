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
  // OSS 私有 Bucket 签名 URL（工单图片渲染需要）
  const ossImgSrc = buildOssImgSrc();
  return [
    "default-src 'self'",
    // 'strict-dynamic' 允许带 nonce 的脚本动态加载子资源（Next.js chunk loading 必需）
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devScript}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${ossImgSrc}`,
    "font-src 'self'",
    `connect-src 'self'${devConnect}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/** 从 OSS_PUBLISH_REGION/BUCKET 构造 img-src 白名单条目 */
function buildOssImgSrc(): string {
  const regionRaw = process.env.OSS_PUBLISH_REGION?.trim();
  const bucket = process.env.OSS_PUBLISH_BUCKET?.trim();
  if (!regionRaw || !bucket) return "";
  let r = regionRaw.replace(/^oss-/, "");
  if (!r.includes("-")) r = `cn-${r}`;
  return ` https://${bucket}.oss-${r}.aliyuncs.com`;
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
     *
     * 必须排除 prefetch 请求：prefetch 返回的是 RSC 数据不是 HTML，给它生成 nonce 会
     * 干扰 Next.js 的 nonce 自动注入，导致实际导航时 inline script 被拦截。
     * 参考: https://nextjs.org/docs/app/guides/content-security-policy
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
