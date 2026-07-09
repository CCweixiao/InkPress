# Releases 版本-架构包模型改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将扁平 `SoftwareRelease` 单表替换为 `ReleaseVersion`(版本父实体) → `ReleaseAsset`(架构包子实体) 模型，支持 GH Action tag 同步版本元信息、管理后台新建/编辑/手动上传架构包，对外客户端 API 保持兼容。

**Architecture:** 两张新表替换旧表，一次性 SQL 数据迁移。Service 层全部查询切到新模型，对外三个客户端端点（check-update / downloads / download）保持响应形状不变。新增 sync-version 端点供 GH Action 调用，新增 admin 端点供版本 CRUD 和 asset 上传/替换/删除。

**Tech Stack:** Next.js 15 (App Router) · Prisma 7 (SQLite) · Zod · 阿里云 OSS (ali-oss) · React (Server Components + Client Components)

## Global Constraints

- **无测试框架**：本项目无 vitest/jest，验证手段为 `pnpm typecheck` + `pnpm lint` + `pnpm build` + 手动 curl。
- **数据变更入口**：业务数据变更必须走 `prisma/migrations/<timestamp>_<name>/migration.sql`（CLAUDE.md 规则），entrypoint 只跑 `migrate deploy`。
- **枚举字段**：SQLite 不支持 Prisma enum，所有枚举字段用 String，取值集合在 zod schema + TS 联合类型约束。
- **API 响应格式**：统一用 `ok()` / `fail()` / `failFromError()`，鉴权用 `requireAdmin()`，token 鉴权用 `assertReleaseToken()`。
- **客户端 API 兼容**：`platform` 字段对外仍用合并串 `darwin-arm64`，内部拆成 `os`+`arch`。
- **工作目录**：所有命令在 `inkpress-service/` 下执行。
- **审计**：所有写操作写 AuditLog，审计失败不阻塞主流程（`.catch(log.warn)`）。

---

## File Structure

**新增文件：**
- `prisma/migrations/<timestamp>_release_version_asset/migration.sql` — 建表 + 数据迁移 + drop 旧表
- `src/app/api/releases/sync-version/route.ts` — CI/GH Action 同步版本元信息
- `src/app/api/admin/releases/versions/route.ts` — 管理员新建版本 (POST) + 列表查询改造 (GET)
- `src/app/api/admin/releases/versions/[id]/route.ts` — 版本编辑 (PATCH) + 删除 (DELETE)
- `src/app/api/admin/releases/versions/[id]/assets/route.ts` — 上传架构包 (POST multipart)
- `src/app/api/admin/releases/versions/[id]/assets/[assetId]/route.ts` — 替换 (PATCH) + 删除 (DELETE) 架构包
- `src/app/admin/releases/new/page.tsx` — 新建版本页
- `src/components/releases/version-create-form.tsx` — 新建版本表单（Client Component）
- `src/components/releases/asset-manager.tsx` — 架构包管理（上传/替换/删除，Client Component）

**修改文件：**
- `prisma/schema.prisma` — 移除 SoftwareRelease，新增 ReleaseVersion + ReleaseAsset
- `src/lib/release/service.ts` — 全部查询切到新模型
- `src/lib/release/version.ts` — 无改动（复用 isVersionNewer）
- `src/lib/validation/schemas.ts` — 新增 os/arch 枚举、syncVersionSchema、createVersionSchema、updateVersionSchema、asset 上传校验
- `src/app/admin/releases/page.tsx` — 列表重构为版本中心
- `src/app/admin/releases/[id]/page.tsx` — 详情页加 asset 管理
- `src/components/releases/release-edit-form.tsx` — 读写 version 级（已有字段，source 路径不变）
- `src/components/releases/admin-table.tsx` — 适配版本级（inline 状态切换）
- `src/app/api/admin/releases/route.ts` — 列表查询改 version 级
- `src/app/api/admin/releases/[id]/route.ts` — 改为 version 操作（重定向到 versions/[id] 或内联）
- `src/app/api/releases/check-update/route.ts` — 内部查询换模型，响应形状不变
- `src/app/api/releases/register/route.ts` — deprecated 适配新模型
- `src/app/api/releases/[id]/download/route.ts` — id 现在是 asset.id，service 层处理
- `.github/workflows/release.yml` — 加 sync-version 步骤
- `package.json` — `release:register` 脚本适配（可选）

---

## Task 1: Prisma Schema 与数据迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_release_version_asset/migration.sql`

**Interfaces:**
- Produces: `ReleaseVersion` 模型（字段见 spec §1.1）、`ReleaseAsset` 模型（字段见 spec §1.2）。后续所有 task 依赖这两个模型名。

- [ ] **Step 1: 修改 schema.prisma — 移除 SoftwareRelease，新增 ReleaseVersion + ReleaseAsset**

打开 `prisma/schema.prisma`，找到 `model SoftwareRelease { ... }`（约 266-297 行），整段删除，替换为：

```prisma
// ===== 软件发布版本（版本父实体：一个版本号一行，承载公共元信息）=====
model ReleaseVersion {
  id                String   @id @default(cuid())
  // 业务唯一键：同包名 + 同版本号 → upsert 覆盖（"相同版本替换"语义）
  packageName       String   // "inkpress"，未来可扩展其他产品
  version           String   // semver "0.5.0"
  // 显示元信息
  displayName       String   // "InkPress 桌面版"
  logoUrl           String?  // 软件图标 URL（可空，前端兜底用内置 logo）
  // 修改内容
  changelogMarkdown String?  // markdown 原文，详情页渲染
  highlightsJson    String   @default("[]") // 结构化要点 JSON string[]
  // 状态与分类（版本级：HIDDEN 隐藏则全部架构包下架）
  status            String   @default("PUBLISHED") // PUBLISHED | HIDDEN
  channel           String   @default("stable") // stable | beta | rc | snapshot
  // 审计
  source            String   @default("ci") // ci | admin
  releasedAt        DateTime @default(now()) // 发布时间（"最新版"判定 + 排序）
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  // 架构包子实体
  assets            ReleaseAsset[]

  @@unique([packageName, version])
  @@index([packageName, status, releasedAt])
  @@index([packageName, channel])
}

// ===== 软件发布架构包（子实体：每版本下每个 os+arch 一行）=====
model ReleaseAsset {
  id              String   @id @default(cuid())
  versionId       String
  version         ReleaseVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  // 架构（拆分 os + arch，可独立筛选）
  os              String   // darwin | win32 | linux
  arch            String   // arm64 | x64
  // 文件元信息
  fileName        String   // "InkPress-0.5.0-arm64.dmg"
  fileSizeBytes   Int      // 字节数（前端格式化为 MB）
  fileHashSha256  String?  // 完整性校验（服务端上传时计算）
  downloadUrl     String   // OSS 完整直链
  storageKey      String   // OSS object key（删除资产时清理用）
  // 审计
  source          String   @default("admin") // ci | admin
  // 下载计数（资产级）
  downloadCount   Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([versionId, os, arch])
  @@index([versionId])
  @@index([os, arch])
}
```

- [ ] **Step 2: 创建空迁移文件骨架**

```bash
cd inkpress-service
pnpm prisma migrate dev --create-only --name release_version_asset
```

这会生成 `prisma/migrations/<timestamp>_release_version_asset/migration.sql`，内容是 Prisma 自动 diff 出的 DDL。**不要直接 apply**，下一步要手动插入数据迁移。

- [ ] **Step 3: 手动编辑 migration.sql — 在建表之后、drop 旧表之前插入数据迁移**

将生成的 migration.sql 改为以下完整内容（顺序：建新表 → 迁数据 → 删旧表）：

```sql
-- CreateTable
CREATE TABLE "ReleaseVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "changelogMarkdown" TEXT,
    "highlightsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "source" TEXT NOT NULL DEFAULT 'ci',
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ReleaseAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileHashSha256" TEXT,
    "downloadUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReleaseAsset_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReleaseVersion" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseVersion_packageName_version_key" ON "ReleaseVersion"("packageName", "version");
CREATE INDEX "ReleaseVersion_packageName_status_releasedAt_idx" ON "ReleaseVersion"("packageName", "status", "releasedAt");
CREATE INDEX "ReleaseVersion_packageName_channel_idx" ON "ReleaseVersion"("packageName", "channel");
CREATE UNIQUE INDEX "ReleaseAsset_versionId_os_arch_key" ON "ReleaseAsset"("versionId", "os", "arch");
CREATE INDEX "ReleaseAsset_versionId_idx" ON "ReleaseAsset"("versionId");
CREATE INDEX "ReleaseAsset_os_arch_idx" ON "ReleaseAsset"("os", "arch");

-- ========================================
-- 数据迁移：SoftwareRelease → ReleaseVersion + ReleaseAsset
-- ========================================

-- 步骤 A: 每个 (packageName, version) 取最新行，插入 ReleaseVersion
INSERT INTO "ReleaseVersion" (
  "id", "packageName", "version", "displayName", "logoUrl",
  "changelogMarkdown", "highlightsJson", "status", "channel",
  "source", "releasedAt", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))),
  packageName,
  version,
  displayName,
  logoUrl,
  changelogMarkdown,
  highlightsJson,
  status,
  channel,
  source,
  releasedAt,
  createdAt,
  updatedAt
FROM (
  SELECT sr.*,
    row_number() OVER (PARTITION BY sr.packageName, sr.version ORDER BY sr.releasedAt DESC) rn
  FROM "SoftwareRelease" sr
) ranked
WHERE ranked.rn = 1;

-- 步骤 B: 每条 SoftwareRelease → ReleaseAsset，platform 拆 os+arch
-- platform 取值固定为 "darwin-arm64" / "darwin-x64" / "win32-x64" / "linux-x64"
-- storageKey: 从 downloadUrl 提取 pathname 作为 OSS key，失败则用 downloadUrl 本身
INSERT INTO "ReleaseAsset" (
  "id", "versionId", "os", "arch",
  "fileName", "fileSizeBytes", "fileHashSha256",
  "downloadUrl", "storageKey", "source", "downloadCount",
  "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))),
  rv.id,
  substr(sr.platform, 1, instr(sr.platform, '-') - 1),
  substr(sr.platform, instr(sr.platform, '-') + 1),
  sr.fileName,
  sr.fileSizeBytes,
  sr.fileHashSha256,
  sr.downloadUrl,
  -- storageKey：尝试从 url 提取 path，否则用完整 url
  CASE
    WHEN instr(sr.downloadUrl, '://') > 0 THEN
      substr(sr.downloadUrl, instr(sr.downloadUrl, '://') + 4)
    ELSE sr.downloadUrl
  END,
  sr.source,
  sr.downloadCount,
  sr.createdAt,
  sr.updatedAt
FROM "SoftwareRelease" sr
JOIN "ReleaseVersion" rv ON rv.packageName = sr.packageName AND rv.version = sr.version;

-- ========================================
-- 删除旧表
-- ========================================

-- DropTable
DROP TABLE "SoftwareRelease";
```

- [ ] **Step 4: 应用迁移并验证**

```bash
cd inkpress-service
pnpm prisma migrate dev
```

Expected: 迁移成功，无报错。验证数据：

```bash
# 用 prisma studio 或 sqlite 命令检查（dev.db）
sqlite3 dev.db "SELECT count(*) as versions FROM ReleaseVersion;"
sqlite3 dev.db "SELECT count(*) as assets FROM ReleaseAsset;"
sqlite3 dev.db "SELECT rv.version, count(ra.id) as assets FROM ReleaseVersion rv LEFT JOIN ReleaseAsset ra ON ra.versionId = rv.id GROUP BY rv.id;"
```

预期：versions 数 = 之前 SoftwareRelease 的唯一 (packageName, version) 数；assets 数 = 之前 SoftwareRelease 总行数。

- [ ] **Step 5: 生成 Prisma Client + typecheck**

```bash
cd inkpress-service
pnpm db:generate
pnpm typecheck
```

Expected: typecheck 此时会有大量报错（service.ts 等引用了已删除的 SoftwareRelease）。**这是预期的** — 后续 task 会逐个修复。记录报错文件列表供后续参考。

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/prisma
git commit -m "$(cat <<'EOF'
feat(release): schema 迁移为 ReleaseVersion + ReleaseAsset 双表

移除扁平 SoftwareRelease，新增版本父实体 ReleaseVersion 和架构包子实体
ReleaseAsset（os+arch 拆分）。含 SoftwareRelease → 新表的一次性数据迁移。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Validation Schemas

**Files:**
- Modify: `src/lib/validation/schemas.ts`

**Interfaces:**
- Produces: `ReleaseOsSchema` / `ReleaseArchSchema` / `ReleaseOs` / `ReleaseArch` 类型；`syncVersionSchema` / `SyncVersionInput`；`createVersionSchema` / `CreateVersionInput`；`updateVersionSchema`（替换旧的）；`assetUploadSchema`（query 参数校验 os/arch）。
- 后续 service + API route task 依赖这些 schema 和类型。

- [ ] **Step 1: 新增 os / arch 枚举**

在 `src/lib/validation/schemas.ts` 中，找到 `ReleasePlatformSchema`（约 349 行），在其后新增：

```ts
export const ReleaseOsSchema = z.enum(["darwin", "win32", "linux"]);
export type ReleaseOs = z.infer<typeof ReleaseOsSchema>;

export const ReleaseArchSchema = z.enum(["arm64", "x64"]);
export type ReleaseArch = z.infer<typeof ReleaseArchSchema>;

/** 对外兼容：将 os + arch 拼回合并串 platform（供客户端 API 响应） */
export function composePlatform(os: string, arch: string): string {
  return `${os}-${arch}`;
}

/** 对外兼容：将客户端上报的合并串 platform 拆成 os + arch */
export function splitPlatform(platform: string): { os: string; arch: string } {
  const idx = platform.indexOf("-");
  if (idx <= 0) return { os: platform, arch: "" };
  return { os: platform.slice(0, idx), arch: platform.slice(idx + 1) };
}
```

- [ ] **Step 2: 新增 syncVersionSchema（CI 同步）**

在上一步之后新增：

```ts
/**
 * CI / GH Action 同步版本元信息请求体。
 * 不含文件信息——包由管理员后续上传。
 */
export const syncVersionSchema = z.object({
  packageName: z.string().trim().min(1).max(64),
  version: looseSemver,
  channel: ReleaseChannelSchema.default("stable"),
  changelogMarkdown: z.string().trim().max(20000).optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  releasedAt: z.string().datetime().optional(),
});
export type SyncVersionInput = z.infer<typeof syncVersionSchema>;
```

- [ ] **Step 3: 新增 createVersionSchema（管理员新建）+ 替换 updateReleaseSchema**

找到旧的 `updateReleaseSchema`（约 393 行），将其替换为 `updateVersionSchema`，并新增 `createVersionSchema`：

```ts
/** 管理员手动新建版本请求体（只建版本骨架，不含包） */
export const createVersionSchema = z.object({
  packageName: z.string().trim().min(1).max(64).default("inkpress"),
  version: looseSemver,
  displayName: z.string().trim().min(1).max(120),
  logoUrl: z.string().trim().url().max(2048).optional(),
  changelogMarkdown: z.string().trim().max(20000).optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  channel: ReleaseChannelSchema.default("stable"),
  status: ReleaseStatusSchema.default("PUBLISHED"),
  releasedAt: z.string().datetime().optional(),
});
export type CreateVersionInput = z.infer<typeof createVersionSchema>;

/** 管理员编辑版本元信息（不能改 packageName/version） */
export const updateVersionSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  logoUrl: z.string().trim().url().max(2048).nullable().optional(),
  changelogMarkdown: z.string().trim().max(20000).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  status: ReleaseStatusSchema.optional(),
  channel: ReleaseChannelSchema.optional(),
});
export type UpdateVersionInput = z.infer<typeof updateVersionSchema>;
```

注意：保留 `registerReleaseSchema`（旧 CI 端点过渡用），不动。

- [ ] **Step 4: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck 2>&1 | grep schemas || echo "schemas.ts 自身无错"
```

（此时 service.ts 等仍报错，只确认 schemas.ts 本身语法正确。）

```bash
git add src/lib/validation/schemas.ts
git commit -m "$(cat <<'EOF'
feat(release): 新增 os/arch 枚举与 version/asset 相关 zod schema

新增 ReleaseOs/ReleaseArch、syncVersionSchema、createVersionSchema、
updateVersionSchema，以及 composePlatform/splitPlatform 兼容工具函数。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Service 层重写

**Files:**
- Modify: `src/lib/release/service.ts`（几乎全部重写）

**Interfaces:**
- Consumes: `ReleaseVersion` / `ReleaseAsset` Prisma 模型（Task 1）、`SyncVersionInput` / `CreateVersionInput` / `UpdateVersionInput` / `ReleaseOs` / `ReleaseArch` / `composePlatform` / `splitPlatform`（Task 2）
- Produces（对外函数签名，后续 API task 依赖）：
  - `syncVersion(input, meta)` → `{ id, action: "created"|"updated" }`
  - `createVersion(input, meta)` → `{ id }`
  - `listAllVersions(opts)` → `{ items, total, page, pageSize }`
  - `getVersionById(id)` → ReleaseVersion + assets
  - `updateVersion(id, patch, meta)` → 更新后的 version
  - `deleteVersion(id, meta)` → void
  - `uploadAsset(versionId, { os, arch, fileName, buffer }, meta)` → `{ id }`
  - `replaceAsset(versionId, assetId, { fileName, buffer }, meta)` → `{ id }`
  - `deleteAsset(versionId, assetId, meta)` → void
  - `listPublishedReleases(packageName, opts)` → 兼容旧形状（platforms 数组）
  - `checkForUpdate(opts)` → 兼容旧形状
  - `incrementDownloadCount(assetId, ip)` → 签名 URL string
  - `registerRelease(input, meta)` → 旧端点适配（upsert version + asset）
  - 保留导出 `PLATFORM_LABELS` / `CHANNEL_META`

- [ ] **Step 1: 重写 service.ts — 顶部导入与常量**

将 `src/lib/release/service.ts` 全文替换为以下内容。先写导入、常量、工具函数：

```ts
import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { moduleLogger } from "@/lib/logger";
import { signOssUrlFromUrl, deleteObject, uploadBufferToOssKey, publicUrl } from "@/lib/oss";
import { shouldCountDownload } from "@/lib/release/download-dedup";
import { isVersionNewer } from "@/lib/release/version";
import {
  composePlatform,
  splitPlatform,
  type ReleaseChannel,
  type ReleaseOs,
  type ReleaseArch,
  type SyncVersionInput,
  type CreateVersionInput,
  type UpdateVersionInput,
} from "@/lib/validation/schemas";
import type { Prisma } from "@/generated/prisma/client";

const log = moduleLogger("release");

/** 平台展示标签（前端 UI + API 返回都用） */
export const PLATFORM_LABELS: Record<string, string> = {
  "darwin-arm64": "macOS · Apple Silicon",
  "darwin-x64": "macOS · Intel",
  "win32-x64": "Windows · x64",
  "linux-x64": "Linux · x64",
};

/** 通道展示标签 + UI 用色提示 */
export const CHANNEL_META: Record<
  ReleaseChannel,
  { label: string; description: string; tone: "default" | "secondary" | "outline" | "destructive" }
> = {
  stable: { label: "正式版", description: "经过完整测试的稳定版本，推荐所有用户使用", tone: "default" },
  beta: { label: "公测版", description: "功能基本完成，欢迎用户体验并反馈", tone: "secondary" },
  rc: { label: "候选版", description: "即将转正的发布候选，仅修复 blocker", tone: "outline" },
  snapshot: { label: "快照版", description: "开发自动构建，可能不稳定，仅供尝鲜/调试", tone: "destructive" },
};

function parseHighlights(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: 写 syncVersion（CI tag 同步）**

在 service.ts 继续追加：

```ts
/**
 * CI / GH Action 同步版本元信息：upsert on (packageName, version)。
 * 同版本重新打 tag → 覆盖元信息，不动 status，不动 assets。
 */
export async function syncVersion(
  input: SyncVersionInput,
  meta: { ip: string | null; ua: string | null }
): Promise<{ id: string; action: "created" | "updated" }> {
  const highlightsJson = JSON.stringify(input.highlights ?? []);
  const releasedAt = input.releasedAt ? new Date(input.releasedAt) : new Date();

  const existing = await prisma.releaseVersion.findUnique({
    where: { packageName_version: { packageName: input.packageName, version: input.version } },
    select: { id: true },
  });
  const action: "created" | "updated" = existing ? "updated" : "created";

  // 默认 displayName 取 packageName 首字母大写兜底
  const displayName = input.displayName ?? input.packageName;

  const result = await prisma.releaseVersion.upsert({
    where: { packageName_version: { packageName: input.packageName, version: input.version } },
    create: {
      packageName: input.packageName,
      version: input.version,
      displayName,
      changelogMarkdown: input.changelogMarkdown ?? null,
      highlightsJson,
      channel: input.channel,
      source: "ci",
      status: "PUBLISHED",
      releasedAt,
    },
    update: {
      displayName,
      changelogMarkdown: input.changelogMarkdown ?? null,
      highlightsJson,
      channel: input.channel,
      releasedAt,
      // status 和 assets 故意不动
    },
    select: { id: true },
  });

  log.info({ id: result.id, action, package: input.packageName, version: input.version }, "版本已同步");

  await writeAudit({
    actorUserId: null,
    actorRole: "SYSTEM",
    action: action === "created" ? "release.sync.create" : "release.sync.update",
    targetType: "ReleaseVersion",
    targetId: result.id,
    after: { package: input.packageName, version: input.version },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));

  return { id: result.id, action };
}
```

- [ ] **Step 3: 写 createVersion（管理员手动新建）**

```ts
/** 管理员手动新建版本（只建骨架，无 asset） */
export async function createVersion(
  input: CreateVersionInput,
  meta: { actorUserId: string; ip: string | null; ua: string | null }
): Promise<{ id: string }> {
  const highlightsJson = JSON.stringify(input.highlights ?? []);
  const releasedAt = input.releasedAt ? new Date(input.releasedAt) : new Date();

  try {
    const row = await prisma.releaseVersion.create({
      data: {
        packageName: input.packageName,
        version: input.version,
        displayName: input.displayName,
        logoUrl: input.logoUrl ?? null,
        changelogMarkdown: input.changelogMarkdown ?? null,
        highlightsJson,
        channel: input.channel,
        status: input.status,
        source: "admin",
        releasedAt,
      },
      select: { id: true, packageName: true, version: true },
    });

    await writeAudit({
      actorUserId: meta.actorUserId,
      actorRole: "ADMIN",
      action: "release.version.create",
      targetType: "ReleaseVersion",
      targetId: row.id,
      after: { package: row.packageName, version: row.version },
      ip: meta.ip,
      userAgent: meta.ua,
    }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));

    return { id: row.id };
  } catch (err) {
    // 唯一约束冲突 → 友好提示
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(ErrorCode.CONFLICT, "该版本号已存在");
    }
    throw err;
  }
}
```

- [ ] **Step 4: 写 listAllVersions / getVersionById / updateVersion / deleteVersion**

```ts
/** 管理员：全量版本列表（含 HIDDEN），含 asset 数与下载总量 */
export async function listAllVersions(opts: {
  packageName?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.ReleaseVersionWhereInput = {};
  if (opts.packageName) where.packageName = opts.packageName;
  if (opts.status) where.status = opts.status;

  const [items, total] = await Promise.all([
    prisma.releaseVersion.findMany({
      where,
      orderBy: [{ releasedAt: "desc" }, { version: "desc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: {
        assets: { select: { id: true, os: true, arch: true, downloadCount: true, fileName: true, fileSizeBytes: true } },
      },
    }),
    prisma.releaseVersion.count({ where }),
  ]);

  // 聚合：每个版本的 asset 数 + 下载总量
  const enriched = items.map((v) => {
    const downloadCount = v.assets.reduce((sum, a) => sum + a.downloadCount, 0);
    return { ...v, assetCount: v.assets.length, downloadCount };
  });

  return { items: enriched, total, page: opts.page, pageSize: opts.pageSize };
}

/** 管理员：单条版本详情（含 assets） */
export async function getVersionById(id: string) {
  const row = await prisma.releaseVersion.findUnique({
    where: { id },
    include: { assets: { orderBy: [{ os: "asc" }, { arch: "asc" }] } },
  });
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");
  return row;
}

/** 管理员：编辑版本元信息（不能改 packageName/version） */
export async function updateVersion(
  id: string,
  patch: UpdateVersionInput,
  meta: { actorUserId: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.releaseVersion.findUnique({ where: { id } });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");

  const data: Prisma.ReleaseVersionUpdateInput = { source: "admin" };
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.logoUrl !== undefined) data.logoUrl = patch.logoUrl;
  if (patch.changelogMarkdown !== undefined) data.changelogMarkdown = patch.changelogMarkdown;
  if (patch.highlights !== undefined) data.highlightsJson = JSON.stringify(patch.highlights);
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.channel !== undefined) data.channel = patch.channel;

  const updated = await prisma.releaseVersion.update({
    where: { id },
    data,
    select: { id: true, packageName: true, version: true, status: true, channel: true },
  });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.version.update",
    targetType: "ReleaseVersion",
    targetId: id,
    before: { status: existing.status, channel: existing.channel },
    after: { status: updated.status, channel: updated.channel, version: updated.version },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));

  return updated;
}

/** 管理员：删除版本（级联删 asset + 清理 OSS 文件） */
export async function deleteVersion(
  id: string,
  meta: { actorUserId: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.releaseVersion.findUnique({
    where: { id },
    include: { assets: { select: { storageKey: true } } },
  });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");

  // 先删 OSS 文件（best effort），再删 DB（级联删 asset）
  await Promise.all(existing.assets.map((a) => deleteObject(a.storageKey)));

  await prisma.releaseVersion.delete({ where: { id } });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.version.delete",
    targetType: "ReleaseVersion",
    targetId: id,
    before: { package: existing.packageName, version: existing.version, assetCount: existing.assets.length },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));
}
```

- [ ] **Step 5: 写 uploadAsset / replaceAsset / deleteAsset**

需要确认 `uploadBufferToOssKey` 的签名。先查看 `src/lib/oss.ts` 中该函数（约 158 行附近）。它签名是 `uploadBufferToOssKey(key, buffer, contentType?, opts?)`。

```ts
import { createHash } from "node:crypto";

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assetOssKey(packageName: string, version: string, os: string, arch: string, fileName: string): string {
  return `releases/${packageName}/${version}/${os}-${arch}/${fileName}`;
}

/** 管理员：上传架构包（multipart → OSS → upsert asset） */
export async function uploadAsset(
  versionId: string,
  input: { os: ReleaseOs; arch: ReleaseArch; fileName: string; buffer: Buffer },
  meta: { actorUserId: string; ip: string | null; ua: string | null }
): Promise<{ id: string }> {
  const version = await prisma.releaseVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");

  const storageKey = assetOssKey(version.packageName, version.version, input.os, input.arch, input.fileName);
  const fileSizeBytes = input.buffer.byteLength;
  const fileHashSha256 = sha256Hex(input.buffer);

  // 上传到 OSS
  await uploadBufferToOssKey(storageKey, input.buffer);

  const downloadUrl = publicUrl(storageKey);

  const asset = await prisma.releaseAsset.upsert({
    where: { versionId_os_arch: { versionId, os: input.os, arch: input.arch } },
    create: {
      versionId,
      os: input.os,
      arch: input.arch,
      fileName: input.fileName,
      fileSizeBytes,
      fileHashSha256,
      downloadUrl,
      storageKey,
      source: "admin",
    },
    update: {
      fileName: input.fileName,
      fileSizeBytes,
      fileHashSha256,
      downloadUrl,
      storageKey,
      // downloadCount 故意不动（保留计数）
    },
    select: { id: true },
  });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.asset.upload",
    targetType: "ReleaseAsset",
    targetId: asset.id,
    after: { versionId, os: input.os, arch: input.arch, fileName: input.fileName, size: fileSizeBytes },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));

  return { id: asset.id };
}

/** 管理员：替换架构包文件（同 os+arch，覆盖文件，保留 downloadCount） */
export async function replaceAsset(
  versionId: string,
  assetId: string,
  input: { fileName: string; buffer: Buffer },
  meta: { actorUserId: string; ip: string | null; ua: string | null }
): Promise<{ id: string }> {
  const existing = await prisma.releaseAsset.findUnique({ where: { id: assetId } });
  if (!existing || existing.versionId !== versionId) {
    throw new AppError(ErrorCode.NOT_FOUND, "架构包不存在");
  }

  // 一次查询拿 packageName + version 拼 OSS key
  const version = await prisma.releaseVersion.findUnique({
    where: { id: versionId },
    select: { packageName: true, version: true },
  });
  if (!version) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");

  const storageKey = assetOssKey(
    version.packageName,
    version.version,
    existing.os,
    existing.arch,
    input.fileName
  );

  const fileSizeBytes = input.buffer.byteLength;
  const fileHashSha256 = sha256Hex(input.buffer);

  // 删旧 OSS 文件（key 不同时），传新文件
  if (storageKey !== existing.storageKey) {
    await deleteObject(existing.storageKey);
  }
  await uploadBufferToOssKey(storageKey, input.buffer);

  const downloadUrl = publicUrl(storageKey);

  await prisma.releaseAsset.update({
    where: { id: assetId },
    data: { fileName: input.fileName, fileSizeBytes, fileHashSha256, storageKey, downloadUrl, source: "admin" },
  });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.asset.replace",
    targetType: "ReleaseAsset",
    targetId: assetId,
    after: { fileName: input.fileName, size: fileSizeBytes },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));

  return { id: assetId };
}

/** 管理员：删除架构包（删 OSS 文件 + 删 asset 行） */
export async function deleteAsset(
  versionId: string,
  assetId: string,
  meta: { actorUserId: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.releaseAsset.findUnique({ where: { id: assetId } });
  if (!existing || existing.versionId !== versionId) {
    throw new AppError(ErrorCode.NOT_FOUND, "架构包不存在");
  }

  await deleteObject(existing.storageKey);
  await prisma.releaseAsset.delete({ where: { id: assetId } });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.asset.delete",
    targetType: "ReleaseAsset",
    targetId: assetId,
    before: { os: existing.os, arch: existing.arch, fileName: existing.fileName },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));
}
```

注意：需在 service.ts 顶部确保 `publicUrl` 从 oss.ts 导出。若 `publicUrl` 未导出，在 oss.ts 增加导出（见 Step 6）。

- [ ] **Step 6: 确保 oss.ts 导出 publicUrl**

查看 `src/lib/oss.ts` 中 `publicUrl()` 函数（约 51 行）。确保它有 `export` 关键字（`export function publicUrl`）。Step 1 的顶部导入已包含 `publicUrl`，此处只需确认 oss.ts 的导出存在。

- [ ] **Step 7: 写 listPublishedReleases（兼容旧形状）**

```ts
type SerializedAsset = {
  id: string;
  version: string;
  fileName: string;
  fileSizeBytes: number;
  fileHashSha256: string | null;
  downloadUrl: string;
  releasedAt: Date;
  channel: ReleaseChannel;
  changelogMarkdown: string | null;
  highlights: string[];
};

/** 公开查询：按 packageName 取所有 PUBLISHED，组装为兼容旧「每平台最新版」形状 */
export async function listPublishedReleases(packageName: string, opts: { history?: boolean } = {}) {
  const versions = await prisma.releaseVersion.findMany({
    where: { packageName, status: "PUBLISHED" },
    orderBy: [{ releasedAt: "desc" }, { version: "desc" }],
    include: { assets: true },
  });

  if (versions.length === 0) return null;

  // 展开所有 asset，按 platform 分组
  const byPlatform = new Map<string, { version: typeof versions[0]; asset: typeof versions[0]["assets"][0] }>();
  for (const v of versions) {
    for (const a of v.assets) {
      const platform = composePlatform(a.os, a.arch);
      if (!byPlatform.has(platform)) {
        byPlatform.set(platform, { version: v, asset: a });
      }
    }
  }

  const latestByPlatform = Array.from(byPlatform.entries()).map(([platform, { version, asset }]) => ({
    platform,
    label: PLATFORM_LABELS[platform] ?? platform,
    release: serializeAsset(version, asset),
  }));

  // 包级最新元信息（取 releasedAt 最大的版本）
  const newest = versions[0]!;

  // 历史记录：所有 version 的所有 asset 展平
  let history: SerializedAsset[] | undefined;
  if (opts.history) {
    history = [];
    for (const v of versions) {
      for (const a of v.assets) {
        history.push(serializeAsset(v, a));
      }
    }
  }

  return {
    packageName: newest.packageName,
    displayName: newest.displayName,
    logoUrl: newest.logoUrl,
    latestVersion: newest.version,
    releasedAt: newest.releasedAt,
    changelogMarkdown: newest.changelogMarkdown,
    highlights: parseHighlights(newest.highlightsJson),
    platforms: latestByPlatform,
    history,
  };
}

function serializeAsset(
  version: { id: string; version: string; releasedAt: Date; channel: string; changelogMarkdown: string | null; highlightsJson: string },
  asset: { id: string; fileName: string; fileSizeBytes: number; fileHashSha256: string | null }
): SerializedAsset {
  return {
    id: asset.id,
    version: version.version,
    fileName: asset.fileName,
    fileSizeBytes: asset.fileSizeBytes,
    fileHashSha256: asset.fileHashSha256,
    downloadUrl: `/api/releases/${asset.id}/download`,
    releasedAt: version.releasedAt,
    channel: version.channel as ReleaseChannel,
    changelogMarkdown: version.changelogMarkdown,
    highlights: parseHighlights(version.highlightsJson),
  };
}
```

- [ ] **Step 8: 写 checkForUpdate（兼容旧形状）+ incrementDownloadCount**

```ts
const CHANNEL_TIER: Record<ReleaseChannel, ReleaseChannel[]> = {
  stable: ["stable"],
  beta: ["stable", "beta"],
  rc: ["stable", "beta", "rc"],
  snapshot: ["stable", "beta", "rc", "snapshot"],
};

export type UpdateCheckResult = {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releasedAt?: Date;
  channel?: ReleaseChannel;
  changelogMarkdown?: string | null;
  highlights?: string[];
  downloadUrl?: string;
  downloadPageUrl?: string;
  fileName?: string;
  fileSizeBytes?: number;
};

export async function checkForUpdate(opts: {
  packageName?: string;
  currentVersion: string;
  platform?: string;
  channel?: ReleaseChannel;
}): Promise<UpdateCheckResult> {
  const packageName = opts.packageName ?? "inkpress";
  const userChannel: ReleaseChannel = opts.channel ?? "stable";
  const allowedChannels = CHANNEL_TIER[userChannel];

  const where: Prisma.ReleaseVersionWhereInput = {
    packageName,
    status: "PUBLISHED",
    channel: { in: allowedChannels },
  };

  const versions = await prisma.releaseVersion.findMany({
    where,
    orderBy: [{ releasedAt: "desc" }],
    take: 20,
    include: { assets: true },
  });

  // 按客户端上报的 platform 过滤 asset（若有）
  let clientOs: string | null = null;
  let clientArch: string | null = null;
  if (opts.platform) {
    const { os, arch } = splitPlatform(opts.platform);
    clientOs = os;
    clientArch = arch;
  }

  // 收集所有有匹配 asset 的候选 (version, asset)
  let latestVersion: string | null = null;
  let latestRow: { version: typeof versions[0]; asset: NonNullable<typeof versions[0]["assets"][0]> } | null = null;

  for (const v of versions) {
    const asset = v.assets.find((a) => (!clientOs || a.os === clientOs) && (!clientArch || a.arch === clientArch));
    if (!asset) continue;
    if (latestVersion === null || isVersionNewer(v.version, latestVersion)) {
      latestVersion = v.version;
      latestRow = { version: v, asset };
    }
  }

  if (!latestRow || latestVersion === null) {
    return { hasUpdate: false, currentVersion: opts.currentVersion, latestVersion: null };
  }

  const hasUpdate = isVersionNewer(latestVersion, opts.currentVersion);
  if (!hasUpdate) {
    return { hasUpdate: false, currentVersion: opts.currentVersion, latestVersion };
  }

  return {
    hasUpdate: true,
    currentVersion: opts.currentVersion,
    latestVersion,
    releasedAt: latestRow.version.releasedAt,
    channel: latestRow.version.channel as ReleaseChannel,
    changelogMarkdown: latestRow.version.changelogMarkdown,
    highlights: parseHighlights(latestRow.version.highlightsJson),
    downloadUrl: `/api/releases/${latestRow.asset.id}/download`,
    downloadPageUrl: "/downloads",
    fileName: latestRow.asset.fileName,
    fileSizeBytes: latestRow.asset.fileSizeBytes,
  };
}

/** 公开下载跟踪：id 现在是 asset.id */
export async function incrementDownloadCount(assetId: string, ip: string | null): Promise<string> {
  const row = await prisma.releaseAsset.findFirst({
    where: { id: assetId, version: { status: "PUBLISHED" } },
    select: { id: true, downloadUrl: true },
  });
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在或已下架");

  const shouldCount = ip ? shouldCountDownload(ip, assetId) : true;
  if (shouldCount) {
    await prisma.releaseAsset.updateMany({
      where: { id: assetId },
      data: { downloadCount: { increment: 1 } },
    });
  }

  return signOssUrlFromUrl(row.downloadUrl, 600);
}
```

- [ ] **Step 9: 写 registerRelease（旧 CI 端点适配新模型）**

```ts
import type { RegisterReleaseInput } from "@/lib/validation/schemas";

/**
 * 旧 CI 端点适配：upsert version + 对应 asset（platform 拆 os+arch）。
 * @deprecated 新流程请用 syncVersion + 管理员上传 asset。
 */
export async function registerRelease(
  input: RegisterReleaseInput,
  meta: { ip: string | null; ua: string | null }
): Promise<{ id: string; action: "created" | "updated" }> {
  const { os, arch } = splitPlatform(input.platform);
  const highlightsJson = JSON.stringify(input.highlights ?? []);
  const releasedAt = input.releasedAt ? new Date(input.releasedAt) : new Date();

  // upsert version
  const version = await prisma.releaseVersion.upsert({
    where: { packageName_version: { packageName: input.packageName, version: input.version } },
    create: {
      packageName: input.packageName,
      version: input.version,
      displayName: input.displayName,
      logoUrl: input.logoUrl ?? null,
      changelogMarkdown: input.changelogMarkdown ?? null,
      highlightsJson,
      channel: input.channel,
      source: "ci",
      status: "PUBLISHED",
      releasedAt,
    },
    update: {
      displayName: input.displayName,
      logoUrl: input.logoUrl ?? null,
      changelogMarkdown: input.changelogMarkdown ?? null,
      highlightsJson,
      channel: input.channel,
      releasedAt,
    },
    select: { id: true },
  });

  // upsert asset
  const storageKey = assetOssKey(input.packageName, input.version, os, arch, input.fileName);
  const asset = await prisma.releaseAsset.upsert({
    where: { versionId_os_arch: { versionId: version.id, os, arch } },
    create: {
      versionId: version.id,
      os,
      arch,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHashSha256: input.fileHashSha256 ?? null,
      downloadUrl: input.downloadUrl,
      storageKey,
      source: "ci",
    },
    update: {
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHashSha256: input.fileHashSha256 ?? null,
      downloadUrl: input.downloadUrl,
      storageKey,
      source: "ci",
    },
    select: { id: true },
  });

  log.info({ versionId: version.id, assetId: asset.id, package: input.packageName, platform: input.platform, version: input.version }, "软件版本已登记（旧端点）");

  await writeAudit({
    actorUserId: null,
    actorRole: "SYSTEM",
    action: "release.register",
    targetType: "ReleaseAsset",
    targetId: asset.id,
    after: { package: input.packageName, platform: input.platform, version: input.version, fileName: input.fileName },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => log.warn({ err }, "审计日志写入失败（已忽略）"));

  return { id: asset.id, action: "updated" };
}
```

- [ ] **Step 10: 移除旧的 updateRelease / deleteRelease / listAllReleases / getReleaseById**

这些旧函数已被新函数替代（updateVersion/deleteVersion/listAllVersions/getVersionById）。删除旧函数体，避免重复。

- [ ] **Step 11: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck
```

此时 service.ts 本身应无错，但引用旧函数名（如 `listAllReleases`/`getReleaseById`/`updateRelease`/`deleteRelease`）的 route 文件仍会报错。后续 task 修复。

```bash
git add src/lib/release/service.ts src/lib/oss.ts
git commit -m "$(cat <<'EOF'
feat(release): service 层重写为 version→asset 模型

新增 syncVersion/createVersion/listAllVersions/getVersionById/
updateVersion/deleteVersion/uploadAsset/replaceAsset/deleteAsset。
listPublishedReleases/checkForUpdate/incrementDownloadCount 保持对外
兼容形状。registerRelease 适配新模型（deprecated）。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: sync-version API 端点

**Files:**
- Create: `src/app/api/releases/sync-version/route.ts`

**Interfaces:**
- Consumes: `syncVersion` / `syncVersionSchema` / `assertReleaseToken`

- [ ] **Step 1: 创建路由文件**

创建 `src/app/api/releases/sync-version/route.ts`：

```ts
import { NextRequest } from "next/server";
import { assertReleaseToken } from "@/lib/release/token";
import { syncVersion } from "@/lib/release/service";
import { syncVersionSchema } from "@/lib/validation/schemas";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * POST /api/releases/sync-version — CI / GH Action 同步版本元信息。
 *
 * 鉴权：X-Release-Token（共享密钥）
 * 行为：upsert on (packageName, version) → 只同步元信息，不传包
 * 语义：同版本重新打 tag → 覆盖元信息，不动 status，不动 assets
 */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    assertReleaseToken(req.headers.get("x-release-token"));

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 64 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = syncVersionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const result = await syncVersion(parsed.data, {
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });

    return ok(result, { status: result.action === "created" ? 201 : 200, requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
```

- [ ] **Step 2: typecheck + 手动验证 + commit**

```bash
cd inkpress-service
pnpm typecheck
pnpm dev  # 后台启动
```

手动验证（另一个终端）：

```bash
# 无 token → 401
curl -s -X POST http://localhost:3001/api/releases/sync-version \
  -H "Content-Type: application/json" \
  -d '{"packageName":"inkpress","version":"99.0.0"}' | head

# 有 token → 201
curl -s -X POST http://localhost:3001/api/releases/sync-version \
  -H "Content-Type: application/json" \
  -H "x-release-token: $RELEASE_REGISTER_TOKEN" \
  -d '{"packageName":"inkpress","version":"99.0.0","channel":"stable","changelogMarkdown":"test"}'
```

确认返回 `{"ok":true,"data":{"id":"...","action":"created"}}`。停掉 dev server。

```bash
git add src/app/api/releases/sync-version/route.ts
git commit -m "$(cat <<'EOF'
feat(release): 新增 sync-version 端点供 GH Action 同步版本元信息

POST /api/releases/sync-version，X-Release-Token 鉴权，
upsert on (packageName, version)，只同步元信息不传包。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Admin 版本 CRUD 端点

**Files:**
- Create: `src/app/api/admin/releases/versions/route.ts`
- Create: `src/app/api/admin/releases/versions/[id]/route.ts`
- Modify: `src/app/api/admin/releases/route.ts`（列表 GET 改为调 listAllVersions）

**Interfaces:**
- Consumes: `listAllVersions` / `createVersion` / `getVersionById` / `updateVersion` / `deleteVersion` / `createVersionSchema` / `updateVersionSchema`

- [ ] **Step 1: 创建 versions 列表 + 新建端点**

创建 `src/app/api/admin/releases/versions/route.ts`：

```ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllVersions, createVersion } from "@/lib/release/service";
import { createVersionSchema } from "@/lib/validation/schemas";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** GET /api/admin/releases/versions — 全部版本（含 HIDDEN + asset 聚合） */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 50)));

    const result = await listAllVersions({
      packageName: sp.get("package") ?? undefined,
      status: sp.get("status") ?? undefined,
      page,
      pageSize,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}

/** POST /api/admin/releases/versions — 管理员手动新建版本（只建骨架） */
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 32 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = createVersionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const result = await createVersion(parsed.data, {
      actorUserId: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(result, { status: 201, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
```

- [ ] **Step 2: 创建版本编辑/删除端点**

创建 `src/app/api/admin/releases/versions/[id]/route.ts`：

```ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { getVersionById, updateVersion, deleteVersion } from "@/lib/release/service";
import { updateVersionSchema } from "@/lib/validation/schemas";
import { getClientIp, readJsonBody, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

/** GET /api/admin/releases/versions/:id — 版本详情（含 assets） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const { id } = await params;
    const row = await getVersionById(id);
    return ok(row, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}

/** PATCH /api/admin/releases/versions/:id — 编辑版本元信息 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;

    let body: unknown;
    try {
      body = await readJsonBody(req, { limitBytes: 32 * 1024 });
    } catch (err) {
      return failFromError(err, requestId);
    }
    const parsed = updateVersionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: parsed.error.issues[0]?.message ?? "参数错误",
        details: parsed.error.issues,
        requestId,
      });
    }

    const updated = await updateVersion(id, parsed.data, {
      actorUserId: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok(updated, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}

/** DELETE /api/admin/releases/versions/:id — 删除版本（级联 asset + 清 OSS） */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id } = await params;
    await deleteVersion(id, {
      actorUserId: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok({ id }, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
```

- [ ] **Step 3: 更新旧 admin releases 列表端点**

修改 `src/app/api/admin/releases/route.ts` 的 GET，将 `listAllReleases` 改为 `listAllVersions`：

```ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllVersions } from "@/lib/release/service";
import { ok, failFromError, getRequestId } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req.headers);
  try {
    await requireAdmin();
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") ?? 50)));

    const result = await listAllVersions({
      packageName: sp.get("package") ?? undefined,
      status: sp.get("status") ?? undefined,
      page,
      pageSize,
    });
    return ok(result, { requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
```

- [ ] **Step 4: 更新旧 admin releases [id] 端点（转为 version 操作）**

修改 `src/app/api/admin/releases/[id]/route.ts`：将 `updateRelease`/`deleteRelease` 改为 `updateVersion`/`deleteVersion`，`updateReleaseSchema` 改为 `updateVersionSchema`。整段 PATCH/DELETE 的函数体中替换调用即可，鉴权与响应逻辑不变。

- [ ] **Step 5: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck
git add src/app/api/admin/releases/
git commit -m "$(cat <<'EOF'
feat(release): admin 版本 CRUD 端点（新建/编辑/删除/详情）

新增 /api/admin/releases/versions (GET/POST) 和
/api/admin/releases/versions/[id] (GET/PATCH/DELETE)。
旧 /api/admin/releases 端点转为调用新 service。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Admin 架构包上传/替换/删除端点

**Files:**
- Create: `src/app/api/admin/releases/versions/[id]/assets/route.ts`
- Create: `src/app/api/admin/releases/versions/[id]/assets/[assetId]/route.ts`

**Interfaces:**
- Consumes: `uploadAsset` / `replaceAsset` / `deleteAsset` / `ReleaseOsSchema` / `ReleaseArchSchema`

- [ ] **Step 1: 创建 asset 上传端点（multipart）**

创建 `src/app/api/admin/releases/versions/[id]/assets/route.ts`：

```ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { uploadAsset } from "@/lib/release/service";
import { ReleaseOsSchema, ReleaseArchSchema } from "@/lib/validation/schemas";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { ErrorCode } from "@/lib/errors";

/** 单 asset 上限 2GB */
const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * POST /api/admin/releases/versions/:id/assets — 上传架构包（multipart/form-data）。
 *
 * 表单字段：
 *   - os: darwin | win32 | linux
 *   - arch: arm64 | x64
 *   - file: 二进制文件
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id: versionId } = await params;

    const formData = await req.formData();
    const osRaw = formData.get("os");
    const archRaw = formData.get("arch");
    const file = formData.get("file");

    if (typeof osRaw !== "string" || typeof archRaw !== "string" || !(file instanceof File)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "需要 os、arch（字符串）和 file（文件）字段",
        requestId,
      });
    }

    const os = ReleaseOsSchema.safeParse(osRaw);
    const arch = ReleaseArchSchema.safeParse(archRaw);
    if (!os.success || !arch.success) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "os 或 arch 取值不合法",
        requestId,
      });
    }
    if (file.size > MAX_ASSET_BYTES) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: `文件超过上限 2GB（当前 ${(file.size / 1024 / 1024 / 1024).toFixed(2)}GB）`,
        requestId,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadAsset(
      versionId,
      { os: os.data, arch: arch.data, fileName: file.name, buffer },
      { actorUserId: session.user.id, ip, ua: truncateUa(req.headers.get("user-agent")) }
    );
    return ok(result, { status: 201, requestId });
  } catch (err) {
    return failFromError(err, requestId);
  }
}
```

- [ ] **Step 2: 创建 asset 替换/删除端点**

创建 `src/app/api/admin/releases/versions/[id]/assets/[assetId]/route.ts`：

```ts
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { replaceAsset, deleteAsset } from "@/lib/release/service";
import { getClientIp, truncateUa } from "@/lib/http";
import { ok, fail, failFromError, getRequestId } from "@/lib/api-response";
import { AppError, ErrorCode } from "@/lib/errors";

const MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * PATCH /api/admin/releases/versions/:id/assets/:assetId — 替换架构包文件。
 * multipart/form-data，字段 file: 二进制文件。保留 downloadCount。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id: versionId, assetId } = await params;

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: "需要 file（文件）字段",
        requestId,
      });
    }
    if (file.size > MAX_ASSET_BYTES) {
      return fail(ErrorCode.VALIDATION_ERROR, {
        message: `文件超过上限 2GB`,
        requestId,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await replaceAsset(
      versionId,
      assetId,
      { fileName: file.name, buffer },
      { actorUserId: session.user.id, ip, ua: truncateUa(req.headers.get("user-agent")) }
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}

/** DELETE /api/admin/releases/versions/:id/assets/:assetId — 删除架构包 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const requestId = getRequestId(req.headers);
  const ip = getClientIp(req.headers);
  try {
    const session = await requireAdmin();
    const { id: versionId, assetId } = await params;
    await deleteAsset(versionId, assetId, {
      actorUserId: session.user.id,
      ip,
      ua: truncateUa(req.headers.get("user-agent")),
    });
    return ok({ id: assetId }, { requestId });
  } catch (err) {
    if (err instanceof AppError) {
      return fail(err.code, { message: err.message, requestId });
    }
    return failFromError(err, requestId);
  }
}
```

- [ ] **Step 3: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck
git add src/app/api/admin/releases/versions/
git commit -m "$(cat <<'EOF'
feat(release): admin 架构包上传/替换/删除端点（multipart）

新增 POST assets（上传）、PATCH assets/[assetId]（替换保留计数）、
DELETE assets/[assetId]（删除）。服务端计算 sha256，OSS key 规范化。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 客户端 API 端点适配

**Files:**
- Modify: `src/app/api/releases/check-update/route.ts`（service 已兼容，检查调用签名）
- Modify: `src/app/api/releases/register/route.ts`（service 已适配，无需改）
- Modify: `src/app/api/releases/[id]/download/route.ts`（id 现在是 assetId，service 已处理）

**Interfaces:**
- Consumes: `checkForUpdate` / `incrementDownloadCount` / `registerRelease`（service 层已兼容）

- [ ] **Step 1: 检查 check-update route 调用签名**

读 `src/app/api/releases/check-update/route.ts`。service 层 `checkForUpdate` 的 `platform` 参数类型从 `ReleasePlatform` 改为 `string`（接受合并串），确认 route 传入的 `platform` 是字符串。若 route 中有 `as ReleasePlatform` 断言，改为直接传 `string`。无需改 service 返回值处理（形状兼容）。

- [ ] **Step 2: 确认 download route 无需改**

读 `src/app/api/releases/[id]/download/route.ts`。它调用 `incrementDownloadCount(id, ip)`，service 已改为按 assetId 查询 + JOIN version 校验。route 本身无需改动——`id` 参数语义从 release.id 变 asset.id，但 route 不关心语义。确认无需改动。

- [ ] **Step 3: typecheck + build + commit**

```bash
cd inkpress-service
pnpm typecheck
pnpm build
```

若 build 成功，commit：

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(release): 客户端 API 端点适配新模型（保持响应形状兼容）

check-update/register/download 内部查询已切到 version→asset 模型，
对外响应形状不变，桌面客户端零改动。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 管理后台列表页（版本中心）

**Files:**
- Modify: `src/app/admin/releases/page.tsx`
- Modify: `src/components/releases/admin-table.tsx`

**Interfaces:**
- Consumes: `listAllVersions`（返回 items 含 assetCount/downloadCount/assets）

- [ ] **Step 1: 重写列表页**

将 `src/app/admin/releases/page.tsx` 全文替换为：

```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-guard";
import { listAllVersions, CHANNEL_META } from "@/lib/release/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { ReleaseChannel } from "@/lib/validation/schemas";

function ChannelBadge({ channel }: { channel: string }) {
  const meta = CHANNEL_META[channel as ReleaseChannel];
  if (!meta) return <Badge variant="outline">{channel}</Badge>;
  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminReleasesPage() {
  await requireAdmin();
  const { items } = await listAllVersions({ page: 1, pageSize: 100 });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">软件版本</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            版本中心。GH Action 推 tag 自动同步版本元信息，管理员可编辑、上传架构包。
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/releases/new">+ 新建版本</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">版本</th>
              <th className="px-3 py-2">展示名</th>
              <th className="px-3 py-2">通道</th>
              <th className="px-3 py-2">架构包</th>
              <th className="px-3 py-2">下载总量</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">发布时间</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  暂无版本。推送 <code className="font-mono">v*</code> tag 后 GH Action 会自动同步，
                  或点击「新建版本」手动创建。
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/admin/releases/${it.id}`} className="font-mono text-xs text-primary hover:underline">
                    v{it.version}
                  </Link>
                </td>
                <td className="px-3 py-2">{it.displayName}</td>
                <td className="px-3 py-2"><ChannelBadge channel={it.channel} /></td>
                <td className="px-3 py-2 text-xs">
                  {it.assetCount === 0 ? (
                    <span className="text-amber-600">待上传</span>
                  ) : (
                    <span>{it.assetCount}</span>
                  )}
                  {it.assets.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {it.assets.map((a) => `${a.os}-${a.arch}`).join(", ")}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="font-medium">{it.downloadCount}</span>
                  <span className="ml-1 text-muted-foreground">次</span>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={it.status === "PUBLISHED" ? "default" : "warning"}>
                    {it.status === "PUBLISHED" ? "公开" : "隐藏"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{it.source}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(it.releasedAt)}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <Link href={`/admin/releases/${it.id}`} className="text-primary hover:underline">详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 更新 admin-table.tsx（inline 状态切换组件）**

读 `src/components/releases/admin-table.tsx`。它当前调用 `PATCH /api/admin/releases/[id]` 改 status。更新为调用 `PATCH /api/admin/releases/versions/[id]`。把 fetch URL 中的 `/api/admin/releases/${id}` 改为 `/api/admin/releases/versions/${id}`。

- [ ] **Step 3: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck
git add src/app/admin/releases/page.tsx src/components/releases/admin-table.tsx
git commit -m "$(cat <<'EOF'
feat(release): 管理后台列表页重构为版本中心

每行一个版本，显示架构包数/下载总量/通道/状态/来源。
新增「新建版本」入口。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 管理后台详情页 + Asset 管理组件

**Files:**
- Modify: `src/app/admin/releases/[id]/page.tsx`
- Modify: `src/components/releases/release-edit-form.tsx`
- Create: `src/components/releases/asset-manager.tsx`

**Interfaces:**
- Consumes: `getVersionById`（返回 version + assets 数组）

- [ ] **Step 1: 更新详情页**

将 `src/app/admin/releases/[id]/page.tsx` 改为用 `getVersionById`（含 assets），渲染版本编辑表单 + AssetManager 组件。读现有文件了解结构后，在 `<ReleaseEditForm>` 下方增加 `<AssetManager>` 区块：

```tsx
import { requireAdmin } from "@/lib/auth/admin-guard";
import { getVersionById } from "@/lib/release/service";
import { ReleaseEditForm } from "@/components/releases/release-edit-form";
import { AssetManager } from "@/components/releases/asset-manager";

export default async function AdminReleaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const version = await getVersionById(id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">
          {version.displayName}{" "}
          <span className="font-mono text-base text-muted-foreground">v{version.version}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {version.packageName} · {version.source} · {version.assets.length} 个架构包
        </p>
      </div>

      <ReleaseEditForm
        id={version.id}
        initialDisplayName={version.displayName}
        initialLogoUrl={version.logoUrl ?? ""}
        initialChannel={version.channel as "stable" | "beta" | "rc" | "snapshot"}
        initialStatus={version.status as "PUBLISHED" | "HIDDEN"}
        initialChangelogMarkdown={version.changelogMarkdown ?? ""}
        initialHighlights={JSON.parse(version.highlightsJson)}
        packageLabel={`${version.displayName} v${version.version}`}
      />

      <div className="border-t pt-6">
        <h2 className="mb-3 text-lg font-semibold">架构包</h2>
        <AssetManager versionId={version.id} initialAssets={version.assets} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 更新 release-edit-form.tsx 的提交 URL**

读 `src/components/releases/release-edit-form.tsx`。将 `handleSave` 中 fetch URL `/api/admin/releases/${props.id}` 改为 `/api/admin/releases/versions/${props.id}`。将 `handleDelete` 中 fetch URL 同样改为 `/api/admin/releases/versions/${props.id}`。其余逻辑不变。

- [ ] **Step 3: 创建 AssetManager 组件**

创建 `src/components/releases/asset-manager.tsx`：

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AssetRow {
  id: string;
  os: string;
  arch: string;
  fileName: string;
  fileSizeBytes: number;
  downloadCount: number;
  source: string;
}

export function AssetManager({
  versionId,
  initialAssets,
}: {
  versionId: string;
  initialAssets: AssetRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [error, setError] = useState<string | null>(null);

  // 上传表单状态
  const [showUpload, setShowUpload] = useState(false);
  const [os, setOs] = useState("darwin");
  const [arch, setArch] = useState("arm64");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // 替换状态
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);

  function formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleUpload() {
    if (!uploadFile) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append("os", os);
      fd.append("arch", arch);
      fd.append("file", uploadFile);
      const res = await fetch(`/api/admin/releases/versions/${versionId}/assets`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setShowUpload(false);
        setUploadFile(null);
        router.refresh();
      } else {
        setError(data?.error?.message ?? "上传失败");
      }
    });
  }

  function handleReplace(assetId: string) {
    if (!replaceFile) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append("file", replaceFile);
      const res = await fetch(`/api/admin/releases/versions/${versionId}/assets/${assetId}`, {
        method: "PATCH",
        body: fd,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setReplaceId(null);
        setReplaceFile(null);
        router.refresh();
      } else {
        setError(data?.error?.message ?? "替换失败");
      }
    });
  }

  function handleDelete(assetId: string) {
    if (!confirm("确认删除这个架构包？OSS 上的文件会被清理，此操作不可恢复。")) return;
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/releases/versions/${versionId}/assets/${assetId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.refresh();
      } else {
        setError(data?.error?.message ?? "删除失败");
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">架构</th>
              <th className="px-3 py-2">文件名</th>
              <th className="px-3 py-2">大小</th>
              <th className="px-3 py-2">下载</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  暂无架构包。点击下方「上传架构包」添加。
                </td>
              </tr>
            )}
            {assets.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{a.os}-{a.arch}</td>
                <td className="px-3 py-2 text-xs">{a.fileName}</td>
                <td className="px-3 py-2 text-xs">{formatSize(a.fileSizeBytes)}</td>
                <td className="px-3 py-2 text-xs">{a.downloadCount} 次</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{a.source}</td>
                <td className="px-3 py-2 text-right">
                  {replaceId === a.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <input type="file" onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)} />
                      <Button size="sm" onClick={() => handleReplace(a.id)} disabled={pending || !replaceFile}>
                        确认替换
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReplaceId(null); setReplaceFile(null); }}>
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setReplaceId(a.id)} disabled={pending} title="替换文件">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(a.id)} disabled={pending} title="删除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showUpload ? (
        <div className="rounded-md border p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>OS</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={os} onChange={(e) => setOs(e.target.value)}>
                <option value="darwin">darwin (macOS)</option>
                <option value="win32">win32 (Windows)</option>
                <option value="linux">linux</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Arch</Label>
              <select className="w-full rounded-md border px-3 py-2 text-sm" value={arch} onChange={(e) => setArch(e.target.value)}>
                <option value="arm64">arm64</option>
                <option value="x64">x64</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>文件</Label>
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={pending || !uploadFile}>
              {pending ? "上传中…" : "确认上传"}
            </Button>
            <Button variant="outline" onClick={() => { setShowUpload(false); setUploadFile(null); }}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          上传架构包
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck
git add src/app/admin/releases/[id]/page.tsx src/components/releases/release-edit-form.tsx src/components/releases/asset-manager.tsx
git commit -m "$(cat <<'EOF'
feat(release): 详情页加架构包管理组件（上传/替换/删除）

详情页渲染版本编辑表单 + AssetManager。AssetManager 支持
选 os/arch 上传新包、替换已有包文件（保留计数）、删除包。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 新建版本页

**Files:**
- Create: `src/app/admin/releases/new/page.tsx`
- Create: `src/components/releases/version-create-form.tsx`

- [ ] **Step 1: 创建新建版本表单组件**

创建 `src/components/releases/version-create-form.tsx`：

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CHANNEL_OPTIONS = [
  { value: "stable", label: "正式版", hint: "推荐所有用户使用" },
  { value: "beta", label: "公测版", hint: "欢迎体验并反馈" },
  { value: "rc", label: "候选版", hint: "仅修复 blocker" },
  { value: "snapshot", label: "快照版", hint: "开发构建" },
] as const;

export function VersionCreateForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [packageName, setPackageName] = useState("inkpress");
  const [version, setVersion] = useState("");
  const [displayName, setDisplayName] = useState("InkPress 桌面版");
  const [channel, setChannel] = useState<"stable" | "beta" | "rc" | "snapshot">("stable");
  const [changelog, setChangelog] = useState("");
  const [highlights, setHighlights] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);

  function updateHighlight(i: number, v: string) {
    setHighlights((arr) => arr.map((x, idx) => (idx === i ? v : x)));
  }
  function addHighlight() {
    setHighlights((arr) => [...arr, ""]);
  }
  function removeHighlight(i: number) {
    setHighlights((arr) => (arr.length === 1 ? [] : arr.filter((_, idx) => idx !== i)));
  }

  function handleSubmit() {
    setError(null);
    start(async () => {
      const cleanedHighlights = highlights.map((h) => h.trim()).filter((h) => h.length > 0);
      const body: Record<string, unknown> = {
        packageName: packageName.trim(),
        version: version.trim(),
        displayName: displayName.trim(),
        channel,
        highlights: cleanedHighlights,
      };
      if (changelog.trim()) body.changelogMarkdown = changelog.trim();

      const res = await fetch("/api/admin/releases/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        router.push("/admin/releases");
        router.refresh();
      } else {
        setError(data?.error?.message ?? "创建失败");
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="packageName">包名</Label>
          <Input id="packageName" value={packageName} onChange={(e) => setPackageName(e.target.value)} maxLength={64} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="version">版本号</Label>
          <Input id="version" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="0.5.0" maxLength={64} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="displayName">展示名称</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} />
      </div>

      <div className="space-y-1.5">
        <Label>通道</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHANNEL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setChannel(opt.value)}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                channel === opt.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent"
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{opt.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="changelog">更新日志（Markdown）</Label>
        <Textarea
          id="changelog"
          value={changelog}
          onChange={(e) => setChangelog(e.target.value)}
          rows={6}
          placeholder={"## 新功能\n- ..."}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>本次更新亮点</Label>
          <Button type="button" variant="outline" size="sm" onClick={addHighlight} disabled={pending}>
            <Plus className="mr-1 h-3 w-3" />
            添加
          </Button>
        </div>
        <div className="space-y-2">
          {highlights.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input value={h} onChange={(e) => updateHighlight(i, e.target.value)} maxLength={200} placeholder={`亮点 ${i + 1}`} />
              <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0" onClick={() => removeHighlight(i)} disabled={pending}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button onClick={handleSubmit} disabled={pending || !version.trim()}>
          {pending ? "创建中…" : "创建版本"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/releases">取消</Link>
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建页面**

创建 `src/app/admin/releases/new/page.tsx`：

```tsx
import { requireAdmin } from "@/lib/auth/admin-guard";
import { VersionCreateForm } from "@/components/releases/version-create-form";

export default async function NewReleasePage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建版本</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          手动创建版本骨架。创建后可在详情页上传架构包。
        </p>
      </div>
      <VersionCreateForm />
    </div>
  );
}
```

- [ ] **Step 3: typecheck + commit**

```bash
cd inkpress-service
pnpm typecheck
git add src/app/admin/releases/new/ src/components/releases/version-create-form.tsx
git commit -m "$(cat <<'EOF'
feat(release): 新建版本页（手动创建版本骨架）

/admin/releases/new，填写包名/版本/通道/changelog/亮点，
提交后只建版本骨架，包在详情页上传。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: GH Action sync-version 步骤

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 在 release job 末尾加 sync-version 步骤**

在 `.github/workflows/release.yml` 的 `release` job 中，在「Create/Update GitHub Release」步骤之后追加：

```yaml
      - name: Sync version to inkpress-service
        continue-on-error: true
        env:
          RELEASE_REGISTER_TOKEN: ${{ secrets.RELEASE_REGISTER_TOKEN }}
          SYNC_URL: ${{ vars.INKPRESS_SYNC_URL || 'https://www.longoflow.com/api/releases/sync-version' }}
        run: |
          if [ -z "$RELEASE_REGISTER_TOKEN" ]; then
            echo "⚠️ RELEASE_REGISTER_TOKEN 未配置，跳过版本同步"
            exit 0
          fi
          VERSION="${{ steps.tag.outputs.tag }}"
          # 从 GH Release 获取 body（generate_release_notes 生成的内容）
          GH_RELEASE_BODY=$(gh release view "$VERSION" --json body -q .body 2>/dev/null || echo "")
          BODY_JSON=$(jq -Rs . <<< "$GH_RELEASE_BODY")
          echo "同步版本 ${VERSION#v} → $SYNC_URL"
          curl -fsS -X POST "$SYNC_URL" \
            -H "X-Release-Token: $RELEASE_REGISTER_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"packageName\":\"inkpress\",\"version\":\"${VERSION#v}\",\"channel\":\"stable\",\"changelogMarkdown\":$BODY_JSON}" \
            && echo "✓ 版本同步成功" \
            || echo "⚠️ 版本同步失败（不阻塞发布）"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

注意：`continue-on-error: true` 确保同步失败不阻塞 GH Release 本身。`GH_TOKEN` 用于 `gh release view` 拿 release body。

- [ ] **Step 2: commit**

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
ci(release): GH Action 推 tag 后同步版本元信息到后台

release.yml 新增 sync-version 步骤，创建 GH Release 后调用
POST /api/releases/sync-version 同步版本号+changelog。
同步失败不阻塞发布。需配置 repo secret RELEASE_REGISTER_TOKEN。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 全量验证与清理

**Files:**
- Verify: 全项目 typecheck + lint + build 通过
- Clean: 移除遗留的旧模型引用

- [ ] **Step 1: 全量 typecheck**

```bash
cd inkpress-service
pnpm typecheck
```

修复任何残留的类型错误。常见问题：
- `ReleasePlatform` 类型在某些文件中仍被引用 → 改为 `string` 或用 `composePlatform`。
- `SoftwareRelease` Prisma 类型引用 → 改为 `ReleaseVersion` / `ReleaseAsset`。

- [ ] **Step 2: lint**

```bash
cd inkpress-service
pnpm lint
```

修复 lint 错误（未使用变量、any 类型等）。

- [ ] **Step 3: build**

```bash
cd inkpress-service
pnpm build
```

Expected: build 成功，无报错。

- [ ] **Step 4: 手动端到端验证**

```bash
cd inkpress-service
pnpm dev
```

在另一个终端执行端到端验证：

```bash
# 1. sync-version 创建空版本
curl -s -X POST http://localhost:3001/api/releases/sync-version \
  -H "Content-Type: application/json" \
  -H "x-release-token: $RELEASE_REGISTER_TOKEN" \
  -d '{"packageName":"inkpress","version":"0.99.0","channel":"beta","changelogMarkdown":"## e2e test"}'
# 预期: {"ok":true,"data":{"id":"...","action":"created"}}

# 2. check-update 能查到（platform 匹配时）
curl -s "http://localhost:3001/api/releases/check-update?currentVersion=0.0.1&platform=darwin-arm64&channel=beta"
# 预期: 有 asset 时 hasUpdate=true；无 asset 时 hasUpdate=false latestVersion=null（因为没包）

# 3. /downloads 页面正常渲染
curl -s http://localhost:3001/downloads | grep -o "InkPress" | head -1
```

登录管理后台验证：
- 访问 `/admin/releases` → 看到 v0.99.0，架构包列显示「待上传」
- 点详情 → 上传一个测试文件（选 darwin/arm64）→ 成功
- 回列表 → 架构包列变为 1
- 访问 `/downloads` → 看到该版本可下载
- 替换该包 → downloadCount 保留
- 删除该包 → 列表回到「待上传」

- [ ] **Step 5: 更新 graphify 知识图谱**

```bash
cd inkpress-service
graphify update .
```

- [ ] **Step 6: 最终 commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(release): 全量 typecheck/lint/build 通过，清理旧模型引用

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Spec 覆盖自检

| Spec 要求 | 对应 Task |
|---|---|
| ReleaseVersion + ReleaseAsset 双表 | Task 1 |
| os + arch 拆分 | Task 1 (schema) + Task 2 (zod) |
| 数据迁移 SoftwareRelease → 新表 | Task 1 Step 3-4 |
| sync-version 端点（CI 同步） | Task 4 |
| GH Action sync 步骤 | Task 11 |
| 管理员新建版本 | Task 5 (API) + Task 10 (UI) |
| 管理员编辑版本 | Task 5 (API) + Task 9 (UI) |
| 手动上传架构包 | Task 6 (API) + Task 9 (AssetManager) |
| 替换架构包（保留计数） | Task 6 (replaceAsset) + Task 9 (AssetManager) |
| 删除架构包 | Task 6 (deleteAsset) + Task 9 |
| 区分架构 | 全链路 os+arch |
| check-update 兼容 | Task 3 Step 8 + Task 7 |
| downloads 页兼容 | Task 3 Step 7 |
| download 跟踪兼容 | Task 3 Step 8 (incrementDownloadCount) |
| 旧 register deprecated | Task 3 Step 9 |
| 审计日志 | 每个 service 函数 |
