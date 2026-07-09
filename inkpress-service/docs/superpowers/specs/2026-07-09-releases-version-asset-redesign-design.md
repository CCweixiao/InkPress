# Releases 版本-架构包模型改造设计

> 日期：2026-07-09
> 状态：已批准，待写实现计划

## 背景与动机

InkPress 的打包流程已迁移到 GitHub Actions（`.github/workflows/release.yml`），本地不再负责打包。当前 `/admin/releases` 的设计与新流程存在三个脱节：

1. **数据模型扁平**：`SoftwareRelease` 单表，每个 `(包名, 平台, 版本)` 是独立一行。同一版本 v0.5.0 的 arm64 和 x64 是两条无关记录，版本级公共信息（changelog/channel/status）冗余存储，没有「版本」父概念。
2. **CI 端点假设「CI 传包到 OSS 再登记」**：`POST /api/releases/register` 要求 fileName/fileSizeBytes/downloadUrl 必填。但新流程下 tag 创建时只需同步版本元信息，包留在 GitHub Release 上。
3. **管理后台无「新建」与「手动上传包」能力**：所有记录只能来自 CI 登记，管理员无法补建版本或手动挂载架构包。

## 目标

- tag 推送时，版本元信息自动同步到后台（不含包）。
- 管理后台支持新建版本、编辑版本元信息、手动上传/替换/删除架构包。
- 架构包按 `os` + `arch` 独立区分。
- 现有桌面客户端的 check-update / download / downloads 页**零改动**继续工作。

## 关键设计决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 数据模型 | 引入 Release 版本父实体（ReleaseVersion → ReleaseAsset） | 一个版本统一管理多架构包，消除冗余 |
| Tag 同步触发 | GH Action 主动调后台接口 | tag 推送即同步，全自动，无运维负担 |
| 包存储方式 | 统一 OSS 上传，复用现有下载链路 | 下载跟踪/签名逻辑完全复用 |
| 架构字段表示 | 拆分 os + arch 两字段 | 语义清晰，可独立筛选 |
| 客户端 API | 保持兼容（内部换模型，对外形状不变） | 避免客户端发版的鸡生蛋问题 |

---

## 一、数据模型

### 1.1 新增表：`ReleaseVersion`（版本父实体）

每个版本号（如 v0.5.0）一行，承载版本级公共元信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | |
| packageName | String | "inkpress"，未来扩展其他产品 |
| version | String | semver "0.5.0" |
| displayName | String | "InkPress 桌面版" |
| logoUrl | String? | 软件图标 URL（可空，前端兜底内置 logo）|
| changelogMarkdown | String? | 版本级更新日志（markdown 原文）|
| highlightsJson | String @default("[]") | 结构化要点 JSON string[] |
| channel | String @default("stable") | stable \| beta \| rc \| snapshot |
| status | String @default("PUBLISHED") | PUBLISHED \| HIDDEN — **版本级开关，隐藏则全部架构包下架** |
| source | String @default("ci") | ci \| admin — 谁创建了这个版本 |
| releasedAt | DateTime @default(now()) | 发布时间（最新版判定 + 排序）|
| createdAt | DateTime @default(now()) | |
| updatedAt | DateTime @updatedAt | |

约束与索引：
- `@@unique([packageName, version])` — 同包同版本唯一，tag 同步走 upsert。
- `@@index([packageName, status, releasedAt])`
- `@@index([packageName, channel])`

### 1.2 新增表：`ReleaseAsset`（架构包子实体）

每个版本下每个 `(os, arch)` 一行，承载具体包文件信息。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String @id @default(cuid()) | 下载跟踪 URL 用此 id |
| versionId | String FK | → ReleaseVersion，onDelete: Cascade |
| os | String | darwin \| win32 \| linux |
| arch | String | arm64 \| x64 |
| fileName | String | "InkPress-0.5.0-arm64.dmg" |
| fileSizeBytes | Int | 字节数 |
| fileHashSha256 | String? | 完整性校验，服务端上传时计算 |
| downloadUrl | String | OSS 直链 |
| storageKey | String | OSS object key（删除资产时清理用）|
| source | String @default("admin") | ci \| admin — 谁挂的这个包 |
| downloadCount | Int @default(0) | **下载计数下沉到资产级** |
| createdAt | DateTime @default(now()) | |
| updatedAt | DateTime @updatedAt | |

约束与索引：
- `@@unique([versionId, os, arch])` — 同版本同架构唯一，重新上传走 upsert（覆盖文件，**保留 downloadCount**）。
- `@@index([versionId])`
- `@@index([os, arch])`

关系：`ReleaseVersion.assets` ↔ `ReleaseAsset.version`

### 1.3 现有 `SoftwareRelease` 数据迁移

一次性 versioned migration（`prisma/migrations/<timestamp>_release_version_asset/migration.sql`）：

1. 按 `(packageName, version)` 分组，每组取 releasedAt 最新的一条作为代表行 → 插入 `ReleaseVersion`。
2. 每条 `SoftwareRelease` → 插入 `ReleaseAsset`，`platform`（`darwin-arm64`）拆成 `os`（`darwin`）+ `arch`（`arm64`），`downloadCount` 随迁到 asset。`storageKey` 从 `downloadUrl` 反解 OSS object key（无法反解则填 downloadUrl 本身，仅影响删除清理，不影响下载）。
3. `DROP TABLE SoftwareRelease`。

`platform` 拆分依赖现有取值固定为单 `-` 分割：`darwin-arm64` / `darwin-x64` / `win32-x64` / `linux-x64`，全部符合。

### 1.4 资产上传约束

- **文件大小上限**：单 asset ≤ 2 GB（multipart 上传，远超当前 DMG ~100 MB 量级，留足余量）。
- **OSS key 规范**：`releases/{packageName}/{version}/{os}-{arch}/{fileName}`，便于按版本/架构前缀清理。
- **sha256**：服务端流式读取上传文件时计算，不信任客户端上报值。

---

## 二、Tag 同步流程

### 2.1 新增端点 `POST /api/releases/sync-version`

GH Action 在创建 GitHub Release 之后调用此端点，**只同步版本元信息，不传包**。

**鉴权**：复用现有 `X-Release-Token`（`assertReleaseToken`，timingSafeEqual 防时序攻击）。

**请求体**（新 schema `syncVersionSchema`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| packageName | string ≤64 | 是 | |
| version | string（looseSemver）| 是 | 允许 `v` 前缀 |
| channel | ReleaseChannel | 否 | 默认 stable |
| changelogMarkdown | string ≤20000 | 否 | 取 GH Release body |
| highlights | string[] ≤20 | 否 | |
| displayName | string ≤120 | 否 | |
| releasedAt | ISO datetime | 否 | 默认 now |

**不含** fileName/size/hash/downloadUrl — 属于 asset，由管理员后续上传。

**行为**：`upsert` on `(packageName, version)`
- **create**：插入 ReleaseVersion，`source=ci`，`status=PUBLISHED`，无 asset。
- **update**（同版本重新打 tag）：覆盖 changelog/highlights/channel/displayName/releasedAt，**不动 status**（保护管理员审核结果，与现有 register 语义一致）。assets 不受影响 — 已上传的包保留。

**审计**：写 AuditLog，`action=release.sync.create` / `release.sync.update`，`actorRole=SYSTEM`。

### 2.2 GH Action 改动（`.github/workflows/release.yml`）

在 `release` job 现有「Create/Update GitHub Release」步骤之后，增加一步：

```yaml
- name: Sync version to inkpress-service
  env:
    RELEASE_REGISTER_TOKEN: ${{ secrets.RELEASE_REGISTER_TOKEN }}
    SYNC_URL: ${{ vars.INKPRESS_SYNC_URL || 'https://www.longoflow.com/api/releases/sync-version' }}
  run: |
    VERSION="${{ steps.tag.outputs.tag }}"
    BODY=$(jq -Rs . <<< "$GH_RELEASE_BODY")
    curl -fsS -X POST "$SYNC_URL" \
      -H "X-Release-Token: $RELEASE_REGISTER_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"packageName\":\"inkpress\",\"version\":\"${VERSION#v}\",\"channel\":\"stable\",\"changelogMarkdown\":$BODY}"
```

需新增 repo secret `RELEASE_REGISTER_TOKEN`（与后台 `.env.production` 的 `RELEASE_REGISTER_TOKEN` 一致）。

### 2.3 完整时序

```
本地: git tag v0.5.0 && git push origin v0.5.0
  ↓
GH Action 触发:
  1. build arm64 DMG
  2. publish GH Release（包挂 GH）
  3. sync-version → 后台创建 ReleaseVersion(0.5.0)，无 asset
  ↓
管理员后台:
  4. 看到 v0.5.0 版本（标记"待上传包"）
  5. 从 GH Release 下载 DMG → 后台上传 → 创建 ReleaseAsset(darwin/arm64)
  6. /downloads 与 check-update 立即对该架构可见
```

---

## 三、管理后台 UI

### 3.1 列表页 `/admin/releases`（重构为版本中心）

从「每行一个架构包」改为「每行一个版本」：

| 版本 | 通道 | 架构包 | 下载总量 | 状态 | 来源 | 时间 | |
|---|---|---|---|---|---|---|---|
| v0.5.0 | 正式版 | 2 | 156 | 公开 | ci | 7/9 | [详情] |
| v0.4.2 | 正式版 | 4 | 1023 | 公开 | admin | 7/5 | [详情] |
| v0.3.0 | 正式版 | 1 | 89 | 隐藏 | ci | 6/20 | [详情] |

- **架构包列**：已上传 asset 数（如 `2`）。若版本 status=PUBLISHED 但 asset 数为 0，显示「待上传」徽标（版本骨架已建但无可下载包）。
- **下载总量**：该版本所有 asset 的 downloadCount 之和。
- 新增「+ 新建版本」入口。

### 3.2 详情/编辑页 `/admin/releases/[id]`（版本级编辑 + asset 管理）

分两个区块：

**区块 A — 版本元信息编辑**（复用现有表单字段，读写 version 级）：
- displayName / logoUrl / channel / status / changelogMarkdown / highlights
- 保存 → `PATCH /api/admin/releases/versions/[id]`
- 删除版本 → `DELETE /api/admin/releases/versions/[id]`（级联删 asset + 清理 OSS 文件）

**区块 B — 架构包管理**（新增）：

| 架构 | 大小 | 下载 | 来源 | 时间 | |
|---|---|---|---|---|---|
| darwin · arm64 | 95 MB | 156 次 | admin | 7/9 | [替换][删] |
| darwin · x64 | 92 MB | 0 次 | admin | 7/9 | [替换][删] |

[+ 上传架构包]

- **上传**：弹窗选 `os`(darwin/win32/linux) + `arch`(arm64/x64) + 文件 → multipart 上传 → 后端存 OSS（key 规范 `releases/{packageName}/{version}/{os}-{arch}/{fileName}`）→ 计算 size + sha256 → upsert ReleaseAsset。`source=admin`。
- **替换**：同 `(versionId, os, arch)` 重新上传 → 覆盖 OSS 文件（删旧 object）+ 更新 asset 元信息。**downloadCount 保留不清零**。
- **删除**：删 OSS object + 删 asset 行。版本本身不受影响（所有 asset 删光则该版本在 /downloads 不可见但记录保留）。

### 3.3 新建版本页 `/admin/releases/new`（新增）

表单：packageName（默认 inkpress）+ version + channel + displayName + changelog + highlights。提交后只建版本骨架（无 asset），包在详情页单独上传。`source=admin`。用于非 CI 触发的手动手版。

### 3.4 新增 API 端点汇总

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/admin/releases/versions` | 管理员手动新建版本 |
| PATCH | `/api/admin/releases/versions/[id]` | 编辑版本元信息 |
| DELETE | `/api/admin/releases/versions/[id]` | 删除版本（级联 asset + 清 OSS）|
| POST | `/api/admin/releases/versions/[id]/assets` | 上传架构包（multipart）|
| PATCH | `/api/admin/releases/versions/[id]/assets/[assetId]` | 替换架构包文件 |
| DELETE | `/api/admin/releases/versions/[id]/assets/[assetId]` | 删除架构包 |
| POST | `/api/releases/sync-version` | CI/GH Action 同步版本元信息（token 鉴权）|

---

## 四、客户端 API 兼容

核心原则：**内部走 version→asset 新模型，对外响应形状不变**。现有桌面客户端零改动。

### 4.1 `GET /api/releases/check-update`（自动更新轮询）

当前响应是扁平 per-platform 形状。改造后查询逻辑：

1. 查 ReleaseVersion `WHERE { packageName, status:PUBLISHED, channel:in[...] }`，按 releasedAt 倒序 take 20。
2. 客户端上报的 `platform`（合并串 `darwin-arm64`）→ 拆成 `os`+`arch`，JOIN ReleaseAsset 过滤。
3. 版本号比较用 version 级（isVersionNewer），在候选中找最大版本号。
4. 响应体字段（latestVersion/downloadUrl/fileName/fileSizeBytes/channel/changelogMarkdown/highlights）从 version+asset 组合输出，**形状完全不变**。

`downloadUrl` 仍返回 `/api/releases/{assetId}/download` — id 从旧 release.id 变为 asset.id，对客户端是不透明字符串，无感。

**边界情况**：若客户端上报的 os+arch 在候选版本中无对应 asset（例如最新版 v0.5.0 只传了 darwin-arm64，但客户端是 win32-x64），该版本不作为候选，继续向前找有匹配 asset 的更早版本。与现有「WHERE platform 过滤」语义一致。

### 4.2 `GET /downloads`（公开下载页）

`listPublishedReleases` 改造：

1. 查所有 PUBLISHED ReleaseVersion，按 releasedAt 倒序。
2. 每个 version 展开 assets（PUBLISHED 版本下所有 asset 可见）。
3. 组装成与当前相同的响应形状：`{ packageName, displayName, logoUrl, latestVersion, ..., platforms: [{ platform:"darwin-arm64", label, release:{...} }] }`。

`platform` 字段值（`darwin-arm64`）由后端从 `os`+`arch` 拼回。前端组件 `downloads-page.tsx` 不需改动。

### 4.3 `GET /api/releases/[id]/download`（下载跟踪 + 302）

`[id]` 现在是 ReleaseAsset.id。逻辑不变：

1. 查 ReleaseAsset `WHERE { id }` JOIN version 校验 `version.status=PUBLISHED`。
2. 计数幂等 + `asset.downloadCount++`。
3. `signOssUrlFromUrl(asset.downloadUrl, 600)` → 302。

变化点：校验 status 需 JOIN version 表（status 下沉到 version 级）。其余完全复用。

### 4.4 `POST /api/releases/register`（旧 CI 端点）

保留但标记 deprecated。逻辑改为：收到的 fileName/size/url → 创建/更新 version + 对应 asset（拆 platform 为 os+arch，source=ci）。GH Action 切到 sync-version 后，此端点仅在过渡期使用，之后可移除。

---

## 五、迁移与上线顺序

### 5.1 上线阶段

**发版 1 — schema + migration + 后端逻辑切换**
- migration 建新表 + 迁数据 + drop SoftwareRelease。
- service 层全切到新模型（version→asset）。
- 三个对外端点保持兼容响应。
- `sync-version` 新端点上线。
- 旧 register 端点适配新表（deprecated，过渡期保留）。

**GH Action 改动**（与发版 1 独立）
- release.yml 加 sync-version 步骤。
- 配置 repo secret `RELEASE_REGISTER_TOKEN`。

**发版 2 — 管理后台 UI**（可与发版 1 同期或稍后）
- 列表页重构为版本中心。
- 详情页加 asset 上传/替换/删除。
- 新建版本页。

**清理**（后续）
- 确认线上无流量打旧 register 端点后移除。

### 5.2 风险点

- **migration 不可逆**：drop SoftwareRelease 后无法回滚。上线前对 dev.db 完整验证迁移结果（版本数 = 唯一 (package,version) 数，asset 数 = 原 release 行数）。
- **自动更新中断窗口**：若发版 1 部署失败导致 API 500，客户端无法 check-update。需确认 migration + 后端在 Docker 单次重启内一并起效。
- **id 格式**：新表用 Prisma `@default(cuid())`，迁移历史数据时 SQL 内用 `lower(hex(randomblob(16)))` 生成伪 id（仅一次性，新数据走 Prisma 默认值）。

---

## 六、涉及文件清单

**新增**：
- `prisma/migrations/<timestamp>_release_version_asset/migration.sql`
- `src/app/admin/releases/new/page.tsx`（新建版本页）
- `src/app/api/releases/sync-version/route.ts`
- `src/app/api/admin/releases/versions/route.ts`（POST 新建）
- `src/app/api/admin/releases/versions/[id]/route.ts`（PATCH/DELETE）
- `src/app/api/admin/releases/versions/[id]/assets/route.ts`（POST 上传）
- `src/app/api/admin/releases/versions/[id]/assets/[assetId]/route.ts`（PATCH/DELETE）
- `src/components/releases/version-create-form.tsx`
- `src/components/releases/asset-manager.tsx`

**修改**：
- `prisma/schema.prisma` — 新增 ReleaseVersion/ReleaseAsset，移除 SoftwareRelease
- `src/lib/release/service.ts` — 全部查询切到新模型，保持对外函数签名兼容
- `src/lib/validation/schemas.ts` — 新增 syncVersionSchema/createVersionSchema/asset 相关 schema，os/arch 枚举
- `src/app/admin/releases/page.tsx` — 列表重构为版本中心
- `src/app/admin/releases/[id]/page.tsx` — 详情页加 asset 管理
- `src/components/releases/release-edit-form.tsx` — 读写 version 级
- `src/components/releases/admin-table.tsx` — 适配版本级
- `src/app/api/admin/releases/route.ts` — 列表查询改 version 级
- `src/app/api/admin/releases/[id]/route.ts` — 改为 version 操作
- `src/app/api/releases/check-update/route.ts` — 内部查询换模型
- `src/app/api/releases/register/route.ts` — deprecated 适配
- `src/app/api/releases/[id]/download/route.ts` — asset 级 + JOIN version
- `.github/workflows/release.yml` — 加 sync-version 步骤
- `src/app/downloads/page.tsx` — 无改动（数据形状兼容）
- `src/components/downloads/downloads-page.tsx` — 无改动

---

## 七、不在本次范围

- 客户端 SDK / Electron 自动更新逻辑改动（API 兼容，无需改）。
- Windows / Linux CI 构建流水线（`release-macos-intel.yml`、`release-windows.yml` 独立，sync 步骤同理复用）。
- asset 的外部链接（GH asset URL）支持 — 当前统一 OSS 上传，未来若需可扩展 asset.source=external。
