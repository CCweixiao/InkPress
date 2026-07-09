import { createHash } from "node:crypto";
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
  type RegisterReleaseInput,
} from "@/lib/validation/schemas";
import { Prisma } from "@/generated/prisma/client";

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

// ─── helpers for asset upload ───────────────────────────────────────────────

function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function assetOssKey(packageName: string, version: string, os: string, arch: string, fileName: string): string {
  return `releases/${packageName}/${version}/${os}-${arch}/${fileName}`;
}

// ─── syncVersion (CI tag 同步) ──────────────────────────────────────────────

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

// ─── createVersion (管理员手动新建) ─────────────────────────────────────────

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
      throw new AppError(ErrorCode.VALIDATION_ERROR, "该版本号已存在");
    }
    throw err;
  }
}

// ─── listAllVersions / getVersionById / updateVersion / deleteVersion ───────

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

// ─── uploadAsset / replaceAsset / deleteAsset ───────────────────────────────

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

// ─── listPublishedReleases（兼容旧形状）──────────────────────────────────────

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
  platform: string;
  platformLabel: string;
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
  asset: { id: string; fileName: string; fileSizeBytes: number; fileHashSha256: string | null; os: string; arch: string }
): SerializedAsset {
  const platform = composePlatform(asset.os, asset.arch);
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
    platform,
    platformLabel: PLATFORM_LABELS[platform] ?? platform,
  };
}

// ─── checkForUpdate（兼容旧形状）+ incrementDownloadCount ───────────────────

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

// ─── registerRelease（旧 CI 端点适配新模型，deprecated）─────────────────────

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
