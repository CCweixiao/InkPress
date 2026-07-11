import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// 构建期读取版本，注入 process.env.APP_VERSION（server 运行时可用，避免依赖 cwd/package.json）。
const pkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
) as { version?: string };
const serverExternalPackages = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts", "server-externals.json"), "utf8")
) as string[];
const outputFileTracingExcludes = [
  "./.git/**/*",
  "./.next/cache/**/*",
  "./dist/**/*",
  "./dist-electron/**/*",
  "./storage/**/*",
  "./tests/**/*",
  "./docs/**/*",
  "./graphify-out/**/*",
  "./inkpress-service/**/*",
  "./coverage/**/*",
  "./playwright-report/**/*",
  "./test-results/**/*",
  "./dev.db*",
  "./dev.database/**/*",
  "./*.log",
];

const nextConfig: NextConfig = {
  // 桌面应用打包用 standalone 输出（自包含的 server.js + traced 依赖）
  output: "standalone",
  // 构建期注入 app 版本（非 NEXT_PUBLIC：仅 server 侧 process.env.APP_VERSION）
  env: {
    APP_VERSION: pkg.version ?? "0.0.0",
  },
  // better-sqlite3 / Prisma 适配器为原生模块，必须保持 external（不被 webpack 打包）
  // 单一清单由 Next tracing 与 prepare-standalone 共用，防止新增 external 时漏打包依赖。
  serverExternalPackages,
  // 内容仓库会按运行时路径读取用户数据，静态追踪无法判断具体文件，曾把整个
  // 项目（包括旧 dist、storage、测试和文档）复制进 standalone 后再删除。
  // 这些目录要么是构建产物，要么是开发/用户态数据，正式包不应包含；桌面所需
  // 的 public/themes/system skills/migrations 由 prepare 脚本按清单独立复制并校验。
  outputFileTracingExcludes: {
    // `/*` 覆盖业务 route；`next-server` 覆盖 standalone 的全局服务 trace。
    // Turbopack 的 instrumentation trace 不走这里，prepare 会用根目录白名单防御。
    "/*": outputFileTracingExcludes,
    "next-server": outputFileTracingExcludes,
  },
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
