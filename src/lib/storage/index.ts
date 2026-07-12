import crypto, { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { storageDir } from "@/lib/paths";
import {
  deleteFromOss,
  getOssConfig,
  multipartUploadFileToOss,
  uploadBufferToOss,
  uploadBufferToOssKey,
} from "@/lib/oss";
import { assetObjectPrefix } from "@/lib/storage/layout";
import { getStorageConfig } from "@/lib/storage-config";

export type StorageProviderId =
  | "local"
  | "aliyun-oss"
  | "s3"
  | "r2"
  | "cos"
  | "qiniu"
  | "minio";

export type StoredObject = Awaited<ReturnType<typeof putBufferObject>>;

type PutBase = {
  filename: string;
  contentType: string;
  kind: string;
  prefix?: string;
  spaceId?: string | null;
  articleId?: string | null;
  metadata?: Record<string, unknown>;
  preferCloud?: boolean;
  visibility?: "private" | "public";
};

function extensionFromName(filename: string) {
  return path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
}

function storageApiUrl(id: string) {
  return `/api/storage/${encodeURIComponent(id)}`;
}

function sha256(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeFilename(filename: string) {
  return path.basename(filename).replace(/[^\w.\-]+/g, "-").slice(0, 100) || "file";
}

function keyPrefix(input: Pick<PutBase, "kind" | "prefix" | "spaceId" | "articleId">) {
  return input.prefix?.replace(/^\/+|\/+$/g, "") || assetObjectPrefix(input);
}

function objectKey(input: Pick<PutBase, "kind" | "prefix" | "spaceId" | "articleId" | "filename">) {
  const prefix = keyPrefix(input);
  const date = new Date().toISOString().slice(0, 10);
  return path.posix.join(prefix, date, `${randomUUID()}${extensionFromName(input.filename)}`);
}

async function chooseProvider(preferCloud = true): Promise<StorageProviderId> {
  const config = await getStorageConfig();
  if (preferCloud && config.defaultProvider === "aliyun-oss" && config.providers.aliyunOss?.enabled) {
    return "aliyun-oss";
  }
  return "local";
}

function assertLocalObjectPath(relativePath: string) {
  const root = path.resolve(storageDir());
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("存储对象路径越界。");
  }
  return { root, absolute };
}

async function writeLocalObject(key: string, buffer: Buffer) {
  const { absolute } = assertLocalObjectPath(key);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const tmp = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, absolute);
  return key;
}

async function copyLocalObject(key: string, sourcePath: string) {
  const { absolute } = assertLocalObjectPath(key);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const tmp = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  await fs.copyFile(sourcePath, tmp);
  await fs.rename(tmp, absolute);
  return key;
}

export async function putBufferObject(
  input: PutBase & { buffer: Buffer }
) {
  const provider = await chooseProvider(input.preferCloud ?? true);
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const digest = sha256(input.buffer);

  if (provider === "aliyun-oss") {
    const prefix = keyPrefix(input);
    const [uploaded, config] = await Promise.all([
      uploadBufferToOss(input.buffer, input.filename, input.contentType, prefix),
      getOssConfig(),
    ]);
    return prisma.storageObject.create({
      data: {
        provider,
        bucket: config.bucket,
        key: uploaded.key,
        url: uploaded.url,
        contentType: uploaded.contentType,
        size: uploaded.size,
        sha256: digest,
        visibility: input.visibility ?? "public",
        status: "synced",
        metadataJson,
      },
    });
  }

  const key = objectKey(input);
  await writeLocalObject(key, input.buffer);
  const created = await prisma.storageObject.create({
    data: {
      provider,
      key,
      localPath: key,
      contentType: input.contentType,
      size: input.buffer.byteLength,
      sha256: digest,
      visibility: input.visibility ?? "private",
      status: "local-only",
      metadataJson,
    },
  });
  return prisma.storageObject.update({
    where: { id: created.id },
    data: { url: storageApiUrl(created.id) },
  });
}

export async function putFileObject(
  input: PutBase & { filePath: string }
) {
  const buffer = await fs.readFile(input.filePath);
  const provider = await chooseProvider(input.preferCloud ?? true);
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const digest = sha256(buffer);

  if (provider === "aliyun-oss") {
    const prefix = keyPrefix(input);
    const [uploaded, config] = await Promise.all([
      multipartUploadFileToOss(input.filePath, input.filename, input.contentType, prefix),
      getOssConfig(),
    ]);
    return prisma.storageObject.create({
      data: {
        provider,
        bucket: config.bucket,
        key: uploaded.key,
        url: uploaded.url,
        contentType: uploaded.contentType,
        size: uploaded.size,
        sha256: digest,
        visibility: input.visibility ?? "public",
        status: "synced",
        metadataJson,
      },
    });
  }

  const key = objectKey(input);
  await copyLocalObject(key, input.filePath);
  const stat = await fs.stat(input.filePath);
  const created = await prisma.storageObject.create({
    data: {
      provider,
      key,
      localPath: key,
      contentType: input.contentType,
      size: stat.size,
      sha256: digest,
      visibility: input.visibility ?? "private",
      status: "local-only",
      metadataJson,
    },
  });
  return prisma.storageObject.update({
    where: { id: created.id },
    data: { url: storageApiUrl(created.id) },
  });
}

export async function resolveLocalStorageObject(id: string) {
  const object = await prisma.storageObject.findUnique({ where: { id } });
  if (!object || object.provider !== "local") return null;
  const { absolute } = assertLocalObjectPath(object.localPath ?? object.key);
  return { object, absolute };
}

export async function readStorageObjectBuffer(id: string) {
  const object = await prisma.storageObject.findUnique({ where: { id } });
  if (!object) throw new Error("存储对象不存在。");
  if (object.provider !== "local") {
    if (!object.url || !/^https?:\/\//i.test(object.url)) {
      throw new Error("云存储对象缺少可读取的对象 URL。");
    }
    const response = await fetch(object.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`下载云存储对象失败：HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const { absolute } = assertLocalObjectPath(object.localPath ?? object.key);
  return fs.readFile(absolute);
}

export async function replaceStorageObjectBuffer(input: {
  id: string;
  buffer: Buffer;
  contentType?: string;
}) {
  const object = await prisma.storageObject.findUnique({ where: { id: input.id } });
  if (!object) throw new Error("存储对象不存在。");
  const contentType = input.contentType ?? object.contentType;
  const digest = sha256(input.buffer);
  if (object.provider === "aliyun-oss") {
    const uploaded = await uploadBufferToOssKey(input.buffer, object.key, contentType);
    return prisma.storageObject.update({
      where: { id: object.id },
      data: {
        url: uploaded.url,
        size: uploaded.size,
        contentType,
        sha256: digest,
        status: "synced",
      },
    });
  }
  if (object.provider === "local") {
    await writeLocalObject(object.localPath ?? object.key, input.buffer);
    return prisma.storageObject.update({
      where: { id: object.id },
      data: {
        size: input.buffer.byteLength,
        contentType,
        sha256: digest,
        status: "local-only",
      },
    });
  }
  throw new Error(`暂不支持替换 ${object.provider} 存储对象。`);
}

export async function listStorageObjects(input: {
  prefix?: string;
  provider?: StorageProviderId;
  limit?: number;
} = {}) {
  return prisma.storageObject.findMany({
    where: {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.prefix ? { key: { startsWith: input.prefix } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, input.limit ?? 100)),
  });
}

export async function deleteStorageObject(id: string | null | undefined) {
  if (!id) return;
  const object = await prisma.storageObject.findUnique({ where: { id } });
  if (!object) return;
  if (object.provider === "aliyun-oss") {
    await deleteFromOss(object.key);
  } else if (object.provider === "local") {
    const { absolute } = assertLocalObjectPath(object.localPath ?? object.key);
    await fs.rm(absolute, { force: true });
  }
  await prisma.storageObject.delete({ where: { id } }).catch(() => {});
}

export function originalFilenameMetadata(filename: string) {
  return { originalFilename: safeFilename(filename) };
}
