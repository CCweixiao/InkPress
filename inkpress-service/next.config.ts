import type { NextConfig } from "next";

/**
 * 安全响应头（PDC §9.1）。
 *
 * 在 next.config 的 headers() 统一下发，覆盖全部路由（含 /api/v1/* 机机接口——
 * JSON 响应不受 CSP 限制，无副作用），不与 auth middleware 的 matcher 耦合。
 *
 * - HSTS 仅在生产 HTTPS（SECURE_COOKIES=true）下启用，避免开发态 HTTP 自锁。
 * - CSP 针对本服务的小型管理 UI（Tailwind v4 + shadcn + Auth.js）调校：
 *   脚本侧严格 'self'，样式侧放开 'unsafe-inline'（Tailwind/shadcn 运行期注入内联样式）。
 * - SECURITY_HEADERS_ENABLE=false 可整体关闭，便于排障。
 */
function buildSecurityHeaders() {
  const secure = process.env.SECURE_COOKIES === "true";
  const headers: { key: string; value: string }[] = [
    {
      key: "X-Frame-Options",
      value: "DENY", // 等价 CSP frame-ancestors 'none'，兼容老浏览器
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    },
  ];
  if (secure) {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    });
  }
  return headers;
}

const nextConfig: NextConfig = {
  // Docker 部署用 standalone 输出（自包含 server.js + traced 依赖）
  output: "standalone",
  // 原生 / 服务端专用模块保持 external，不被 webpack 打包
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
    "@node-rs/argon2",
    "nodemailer",
    "resend",
    "pino",
  ],
  turbopack: {
    // 本项目为独立项目，置于 InkPress 主仓库子目录下。Turbopack 默认会把
    // 父级 pnpm-workspace.yaml 当作 workspace root，从而误编译主仓库源码；
    // 显式锁定到当前目录，使构建只扫描 inkpress-service。
    root: process.cwd(),
  },
  async headers() {
    if (process.env.SECURITY_HEADERS_ENABLE === "false") return [];
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
