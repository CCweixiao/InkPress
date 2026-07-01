import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 桌面应用打包用 standalone 输出（自包含的 server.js + traced 依赖）
  output: "standalone",
  // better-sqlite3 / Prisma 适配器为原生模块，必须保持 external（不被 webpack 打包）
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
    "adm-zip",
    "ali-oss",
    "@resvg/resvg-js",
    // Claude Agent SDK 会 spawn 原生 Claude Code 子进程，依赖 node: 内建，不能被打包
    "@anthropic-ai/claude-agent-sdk",
  ],
};

export default nextConfig;
