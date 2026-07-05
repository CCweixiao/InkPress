import { prisma } from "@/lib/db";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { moduleLogger } from "@/lib/logger";
import type {
  RegisterReleaseInput,
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

  // update 不包含 status：保护管理员审核结果
  const createData: Prisma.SoftwareReleaseCreateInput = {
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
  };

  const result = await prisma.softwareRelease.upsert({
    where: {
      packageName_platform_version: {
        packageName: input.packageName,
        platform: input.platform,
        version: input.version,
      },
    },
    create: createData,
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

  // 判断 created / updated：通过 releasedAt 推断不准确，单独查一次更可靠
  // upsert 不会返回是否新建，所以用计数对比。SQLite 上很快。
  const totalCount = await prisma.softwareRelease.count({
    where: {
      packageName: input.packageName,
      platform: input.platform,
    },
  });
  // 简单判断：如果是该平台第一条记录，肯定是新建；否则可能是更新
  // 注意并发下不严格准确，但只用于日志/响应展示，不影响数据正确性
  const action: "created" | "updated" =
    totalCount === 1 &&
    (await prisma.softwareRelease.findFirst({
      where: { packageName: input.packageName, platform: input.platform },
      orderBy: { releasedAt: "desc" },
      select: { id: true },
    }))?.id === result.id
      ? "created"
      : "updated";

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

function serializeRelease(row: SoftwareRelease) {
  return {
    id: row.id,
    version: row.version,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes,
    fileHashSha256: row.fileHashSha256,
    downloadUrl: row.downloadUrl,
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
    channel?: "stable" | "beta";
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
