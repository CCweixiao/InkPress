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
  images: {
    // 禁用 next/image 优化器：避免运行时把缓存写到 .next/cache/images/
    // （Next.js standalone 模式下 cwd=Resources/standalone/，缓存落在
    // .app bundle 的 sealed resource 区，运行时写入会破坏代码签名）。
    // 项目内 next/image 仅用于 3 处静态 logo（28×28 PNG），无优化收益；
    // 素材库 / 文章内嵌图走原生 <img>，不受此配置影响。
    unoptimized: true,
  },
};

export default nextConfig;
