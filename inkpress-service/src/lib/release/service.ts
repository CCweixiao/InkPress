import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { moduleLogger } from "@/lib/logger";
import { signOssUrlFromUrl } from "@/lib/oss";
import { shouldCountDownload } from "@/lib/release/download-dedup";
import { isVersionNewer } from "@/lib/release/version";
import type {
  RegisterReleaseInput,
  ReleaseChannel,
  ReleasePlatform,
} from "@/lib/validation/schemas";
import type { Prisma, SoftwareRelease } from "@/generated/prisma/client";

const log = moduleLogger("release");

/** 平台展示标签（前端 UI + API 返回都用） */
export const PLATFORM_LABELS: Record<ReleasePlatform, string> = {
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

/**
 * CI 制品登记：upsert on (packageName, platform, version)。
 *
 * 「相同版本替换」语义：同版本号重发覆盖文件信息（size/hash/url/changelog），
 * 但不动 status 字段——管理员审核过的 HIDDEN 状态不被 CI 覆盖。
 *
 * @returns action "created" | "updated"
 */
export async function registerRelease(
  input: RegisterReleaseInput,
  meta: { ip: string | null; ua: string | null }
): Promise<{ id: string; action: "created" | "updated" }> {
  const highlightsJson = JSON.stringify(input.highlights ?? []);
  const releasedAt = input.releasedAt ? new Date(input.releasedAt) : new Date();

  // upsert 前先查一次，准确判定 created/updated（并发下最坏情况是误报 updated，
  // 仅影响日志/审计/HTTP 状态码，不影响数据正确性——唯一约束兜底）
  const existing = await prisma.softwareRelease.findUnique({
    where: {
      packageName_platform_version: {
        packageName: input.packageName,
        platform: input.platform,
        version: input.version,
      },
    },
    select: { id: true },
  });
  const action: "created" | "updated" = existing ? "updated" : "created";

  // update 不包含 status：保护管理员审核结果（CI 不能越权改 status）
  const result = await prisma.softwareRelease.upsert({
    where: {
      packageName_platform_version: {
        packageName: input.packageName,
        platform: input.platform,
        version: input.version,
      },
    },
    create: {
      packageName: input.packageName,
      platform: input.platform,
      version: input.version,
      displayName: input.displayName,
      logoUrl: input.logoUrl ?? null,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHashSha256: input.fileHashSha256 ?? null,
      downloadUrl: input.downloadUrl,
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
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes,
      fileHashSha256: input.fileHashSha256 ?? null,
      downloadUrl: input.downloadUrl,
      changelogMarkdown: input.changelogMarkdown ?? null,
      highlightsJson,
      channel: input.channel,
      source: "ci",
      releasedAt,
      // 注意：status 故意不在 update 里
    },
    select: { id: true },
  });

  log.info(
    { id: result.id, action, package: input.packageName, platform: input.platform, version: input.version },
    "软件版本已登记"
  );

  await writeAudit({
    actorUserId: null,
    actorRole: "SYSTEM",
    action: action === "created" ? "release.register.create" : "release.register.update",
    targetType: "SoftwareRelease",
    targetId: result.id,
    after: {
      package: input.packageName,
      platform: input.platform,
      version: input.version,
      fileName: input.fileName,
      size: input.fileSizeBytes,
    },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => {
    // 审计失败不阻塞登记
    log.warn({ err }, "审计日志写入失败（已忽略）");
  });

  return { id: result.id, action };
}

/** 公开查询：按 packageName 取所有 PUBLISHED，按 releasedAt 倒序 */
export async function listPublishedReleases(packageName: string, opts: { history?: boolean } = {}) {
  const rows = await prisma.softwareRelease.findMany({
    where: { packageName, status: "PUBLISHED" },
    orderBy: [{ releasedAt: "desc" }, { version: "desc" }],
  });

  if (rows.length === 0) return null;

  // 按平台分组
  const byPlatform = new Map<ReleasePlatform, typeof rows>();
  for (const row of rows) {
    const key = row.platform as ReleasePlatform;
    if (!byPlatform.has(key)) byPlatform.set(key, []);
    byPlatform.get(key)!.push(row);
  }

  // 每个平台最新版
  const latestByPlatform = Array.from(byPlatform.entries()).map(([platform, items]) => ({
    platform,
    label: PLATFORM_LABELS[platform] ?? platform,
    release: serializeRelease(items[0]!),
  }));

  // 全包最新元信息（取所有平台最新中 releasedAt 最大那条作为「包级」展示）
  const newestRow = rows[0]!;

  return {
    packageName: newestRow.packageName,
    displayName: newestRow.displayName,
    logoUrl: newestRow.logoUrl,
    latestVersion: newestRow.version,
    releasedAt: newestRow.releasedAt,
    changelogMarkdown: newestRow.changelogMarkdown,
    highlights: parseHighlights(newestRow.highlightsJson),
    platforms: latestByPlatform,
    history: opts.history
      ? rows.map(serializeReleaseWithPlatform)
      : undefined,
  };
}

function parseHighlights(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 公开序列化：downloadUrl 替换为同源跟踪 URL（/api/releases/[id]/download）。
 * 真实 OSS 直链不暴露给前端，避免绕过计数；管理员页通过 getReleaseById 拿原始 URL。
 */
function serializeRelease(row: SoftwareRelease) {
  return {
    id: row.id,
    version: row.version,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes,
    fileHashSha256: row.fileHashSha256,
    downloadUrl: `/api/releases/${row.id}/download`,
    releasedAt: row.releasedAt,
    channel: row.channel,
    changelogMarkdown: row.changelogMarkdown,
    highlights: parseHighlights(row.highlightsJson),
  };
}

function serializeReleaseWithPlatform(row: SoftwareRelease) {
  return {
    ...serializeRelease(row),
    platform: row.platform as ReleasePlatform,
    platformLabel: PLATFORM_LABELS[row.platform as ReleasePlatform] ?? row.platform,
  };
}

/** 管理员：单条详情（含 downloadCount 与原始 downloadUrl，不脱敏） */
export async function getReleaseById(id: string) {
  const row = await prisma.softwareRelease.findUnique({ where: { id } });
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");
  return row;
}

/**
 * 公开下载跟踪：
 * 1. 校验版本存在且 status=PUBLISHED
 * 2. 计数幂等：同 IP + 同版本 30 分钟内只 +1（防刷量）
 * 3. 返回短期签名 URL（10 分钟过期，private bucket 必需）
 *
 * HIDDEN / 不存在 → 抛 NOT_FOUND，端点返回 404。
 *
 * @param id   release id
 * @param ip   客户端 IP（用于幂等去重，传空则跳过去重始终计数）
 * @returns    签名后的 OSS URL（10 分钟有效），用于 302 跳转
 */
export async function incrementDownloadCount(
  id: string,
  ip: string | null
): Promise<string> {
  // 1. 校验存在 + PUBLISHED
  const row = await prisma.softwareRelease.findFirst({
    where: { id, status: "PUBLISHED" },
    select: { id: true, downloadUrl: true },
  });
  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, "版本不存在或已下架");
  }

  // 2. 计数幂等 + 原子自增
  const shouldCount = ip ? shouldCountDownload(ip, id) : true;
  if (shouldCount) {
    await prisma.softwareRelease.updateMany({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
  }

  // 3. 签名 URL（OSS bucket 是 private，必须签名才能访问）
  return signOssUrlFromUrl(row.downloadUrl, 600);
}

/**
 * 用户渠道对应的「可感知更新」范围（保守到激进）。
 * stable 用户只看 stable；beta 用户看 stable + beta；以此类推。
 */
const CHANNEL_TIER: Record<ReleaseChannel, ReleaseChannel[]> = {
  stable: ["stable"],
  beta: ["stable", "beta"],
  rc: ["stable", "beta", "rc"],
  snapshot: ["stable", "beta", "rc", "snapshot"],
};

export type UpdateCheckResult = {
  hasUpdate: boolean;
  currentVersion: string;
  /** 已发布的最新版本号；DB 中无任何匹配版本时为 null */
  latestVersion: string | null;
  // 以下字段仅 hasUpdate=true 时填充
  releasedAt?: Date;
  channel?: ReleaseChannel;
  changelogMarkdown?: string | null;
  highlights?: string[];
  /** 同源下载跟踪 URL（/api/releases/{id}/download） */
  downloadUrl?: string;
  /** 下载页面（相对 origin） */
  downloadPageUrl?: string;
  fileName?: string;
  fileSizeBytes?: number;
};

/**
 * 客户端轮询「是否有新版本」：
 * 1. 按平台（如提供）+ 渠道范围取所有 PUBLISHED，按 releasedAt 倒序
 * 2. 在结果中找版本号最大者（SQLite 字符串排序 ≠ semver，必须客户端比较）
 * 3. 用 isVersionNewer 比对 currentVersion
 *
 * 设计权衡：
 * - 不直接 ORDER BY version DESC：SQLite 字符串比较下 "0.10.0" < "0.9.0"，会取错
 * - 取 take=20 是上限保护：单平台单渠道历史版本极少超过这个量级
 */
export async function checkForUpdate(opts: {
  packageName?: string;
  currentVersion: string;
  platform?: ReleasePlatform;
  channel?: ReleaseChannel;
}): Promise<UpdateCheckResult> {
  const packageName = opts.packageName ?? "inkpress";
  const userChannel: ReleaseChannel = opts.channel ?? "stable";
  const allowedChannels = CHANNEL_TIER[userChannel];

  const where: Prisma.SoftwareReleaseWhereInput = {
    packageName,
    status: "PUBLISHED",
    channel: { in: allowedChannels },
  };
  if (opts.platform) where.platform = opts.platform;

  const rows = await prisma.softwareRelease.findMany({
    where,
    orderBy: [{ releasedAt: "desc" }],
    take: 20,
  });

  if (rows.length === 0) {
    return {
      hasUpdate: false,
      currentVersion: opts.currentVersion,
      latestVersion: null,
    };
  }

  // 在候选中找最大版本号
  let latestRow = rows[0]!;
  for (const row of rows) {
    if (isVersionNewer(row.version, latestRow.version)) {
      latestRow = row;
    }
  }

  const hasUpdate = isVersionNewer(latestRow.version, opts.currentVersion);
  if (!hasUpdate) {
    return {
      hasUpdate: false,
      currentVersion: opts.currentVersion,
      latestVersion: latestRow.version,
    };
  }

  return {
    hasUpdate: true,
    currentVersion: opts.currentVersion,
    latestVersion: latestRow.version,
    releasedAt: latestRow.releasedAt,
    channel: latestRow.channel as ReleaseChannel,
    changelogMarkdown: latestRow.changelogMarkdown,
    highlights: parseHighlights(latestRow.highlightsJson),
    downloadUrl: `/api/releases/${latestRow.id}/download`,
    downloadPageUrl: "/downloads",
    fileName: latestRow.fileName,
    fileSizeBytes: latestRow.fileSizeBytes,
  };
}

/** 管理员：全量列表 */
export async function listAllReleases(opts: {
  packageName?: string;
  status?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.SoftwareReleaseWhereInput = {};
  if (opts.packageName) where.packageName = opts.packageName;
  if (opts.status) where.status = opts.status;

  const [items, total] = await Promise.all([
    prisma.softwareRelease.findMany({
      where,
      orderBy: [{ releasedAt: "desc" }, { version: "desc" }],
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.softwareRelease.count({ where }),
  ]);
  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

/** 管理员：编辑（不改 packageName/platform/version） */
export async function updateRelease(
  id: string,
  patch: {
    displayName?: string;
    logoUrl?: string | null;
    changelogMarkdown?: string | null;
    highlights?: string[];
    status?: "PUBLISHED" | "HIDDEN";
    channel?: ReleaseChannel;
  },
  meta: { actorUserId: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.softwareRelease.findUnique({ where: { id } });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");

  const data: Prisma.SoftwareReleaseUpdateInput = {
    source: "admin",
  };
  if (patch.displayName !== undefined) data.displayName = patch.displayName;
  if (patch.logoUrl !== undefined) data.logoUrl = patch.logoUrl;
  if (patch.changelogMarkdown !== undefined)
    data.changelogMarkdown = patch.changelogMarkdown;
  if (patch.highlights !== undefined) data.highlightsJson = JSON.stringify(patch.highlights);
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.channel !== undefined) data.channel = patch.channel;

  const updated = await prisma.softwareRelease.update({
    where: { id },
    data,
    select: { id: true, packageName: true, platform: true, version: true, status: true, channel: true },
  });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.update",
    targetType: "SoftwareRelease",
    targetId: id,
    before: {
      status: existing.status,
      channel: existing.channel,
    },
    after: {
      status: updated.status,
      channel: updated.channel,
      package: updated.packageName,
      platform: updated.platform,
      version: updated.version,
    },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => {
    log.warn({ err }, "审计日志写入失败（已忽略）");
  });

  return updated;
}

/** 管理员：硬删除（误登时用） */
export async function deleteRelease(
  id: string,
  meta: { actorUserId: string; ip: string | null; ua: string | null }
) {
  const existing = await prisma.softwareRelease.findUnique({ where: { id } });
  if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "版本不存在");

  await prisma.softwareRelease.delete({ where: { id } });

  await writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: "ADMIN",
    action: "release.delete",
    targetType: "SoftwareRelease",
    targetId: id,
    before: {
      package: existing.packageName,
      platform: existing.platform,
      version: existing.version,
      fileName: existing.fileName,
    },
    ip: meta.ip,
    userAgent: meta.ua,
  }).catch((err) => {
    log.warn({ err }, "审计日志写入失败（已忽略）");
  });
}
