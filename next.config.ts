import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// 构建期读取版本，注入 process.env.APP_VERSION（server 运行时可用，避免依赖 cwd/package.json）。
const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
) as { version?: string };

const nextConfig: NextConfig = {
  // 桌面应用打包用 standalone 输出（自包含的 server.js + traced 依赖）
  output: "standalone",
  // 构建期注入 app 版本（非 NEXT_PUBLIC：仅 server 侧 process.env.APP_VERSION）
  env: {
    APP_VERSION: pkg.version ?? "0.0.0",
  },
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
