import type { NextConfig } from "next";

/**
 * 安全响应头（PDC §9.1）。
 *
 * 静态安全头在 next.config 的 headers() 统一下发；CSP 需要 per-request nonce，
 * 由 src/proxy.ts 动态设置，避免阻断 Next.js 自身的 inline bootstrap 脚本。
 *
 * - HSTS 仅在生产 HTTPS（SECURE_COOKIES=true）下启用，避免开发态 HTTP 自锁。
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
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
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
