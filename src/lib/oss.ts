import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type OssConfig,
} from "@/lib/oss-config";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";
import {
  getStorageConfig,
  hasAliyunOssStorageConfig,
} from "@/lib/storage-config";

const log = moduleLogger("oss");

export type UploadedFile = {
  key: string;
  url: string;
  name: string;
  size: number;
  contentType: string;
};

export async function getOssConfig(): Promise<OssConfig> {
  const config = await getStorageConfig();
  const oss = config.providers.aliyunOss;
  if (!oss?.enabled) throw new Error("尚未配置 OSS，请先在「设置」中配置 OSS 存储。");
  return oss;
}

/** OSS 是否已配置（不抛错，用于判断是否走 OSS 上传） */
export async function hasOssConfig(): Promise<boolean> {
  return hasAliyunOssStorageConfig();
}

function createClient(config: OssConfig) {
  const endpoint = config.domain.replace(/^https?:\/\//, "");
  const cname =
    !endpoint.startsWith("oss-") && !endpoint.includes(".aliyuncs.com");

  return new OSS({
    bucket: config.bucket,
    endpoint,
    cname,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  });
}

/** 根据 domain 拼最终可访问 URL（兼容 CDN 自定义域名与 OSS 默认域名） */
function publicUrl(config: OssConfig, key: string) {
  const domain = /^https?:\/\//.test(config.domain)
    ? config.domain
    : `https://${config.domain}`;
  const normalized = domain.replace(/\/+$/, "");
  const host = normalized.replace(/^https?:\/\//, "");
  if (
    host.startsWith("oss-") ||
    host.startsWith("internal-") ||
    host.match(/^oss-[^.]+\.aliyuncs\.com$/)
  ) {
    return `${normalized.replace("://", `://${config.bucket}.`)}/${key}`;
  }
  return `${normalized}/${key}`;
}

function safeObjectKey(key: string) {
  const normalized = key.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized.startsWith("..")) {
    throw new Error("OSS 对象 key 不合法。");
  }
  return normalized;
}

function extensionFromName(filename: string) {
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext || "";
}

function safeFilename(filename: string) {
  return (
    path.basename(filename).replace(/[^\w.\-]+/g, "-").slice(0, 100) || "file"
  );
}

function objectKeyFor(filename: string, dir: string) {
  const cleanDir = dir.replace(/^\/+|\/+$/g, "");
  return `${cleanDir}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extensionFromName(filename)}`;
}

export async function uploadToOss(
  file: File,
  dir = "uploads"
): Promise<UploadedFile> {
  const config = await getOssConfig();
  const bytes = Buffer.from(await file.arrayBuffer());
  const objectKey = objectKeyFor(file.name, dir);
  const start = Date.now();

  try {
    await createClient(config).put(objectKey, bytes, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeFilename(file.name)}"`,
      },
    });
  } catch (err) {
    log.error({ key: objectKey, size: file.size, err }, "OSS 上传失败");
    throw err;
  }

  const durationMs = Date.now() - start;
  log.info({ key: objectKey, size: file.size, durationMs }, "OSS 上传完成");

  return {
    key: objectKey,
    url: publicUrl(config, objectKey),
    name: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
  };
}

export async function uploadBufferToOss(
  buffer: Buffer,
  filename: string,
  contentType: string,
  dir = "uploads"
): Promise<UploadedFile> {
  const config = await getOssConfig();
  const objectKey = objectKeyFor(filename, dir);
  const start = Date.now();

  try {
    await createClient(config).put(objectKey, buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${safeFilename(filename)}"`,
      },
    });
  } catch (err) {
    log.error({ key: objectKey, size: buffer.byteLength, err }, "OSS 上传失败");
    throw err;
  }

  const durationMs = Date.now() - start;
  log.info({ key: objectKey, size: buffer.byteLength, durationMs }, "OSS 上传完成");

  return {
    key: objectKey,
    url: publicUrl(config, objectKey),
    name: filename,
    size: buffer.byteLength,
    contentType,
  };
}

export async function uploadBufferToOssKey(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<UploadedFile> {
  const config = await getOssConfig();
  const objectKey = safeObjectKey(key);
  const start = Date.now();

  try {
    await createClient(config).put(objectKey, buffer, {
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch (err) {
    log.error({ key: objectKey, size: buffer.byteLength, err }, "OSS 指定 key 上传失败");
    throw err;
  }

  log.info(
    { key: objectKey, size: buffer.byteLength, durationMs: Date.now() - start },
    "OSS 指定 key 上传完成"
  );

  return {
    key: objectKey,
    url: publicUrl(config, objectKey),
    name: path.basename(objectKey),
    size: buffer.byteLength,
    contentType,
  };
}

export async function deleteFromOss(key: string) {
  const config = await getOssConfig();
  const start = Date.now();
  try {
    await createClient(config).delete(key);
    log.debug({ key, durationMs: Date.now() - start }, "OSS 删除完成");
  } catch (err) {
    log.warn({ key, err }, "OSS 删除失败");
    throw err;
  }
}

/**
 * 从本地文件上传到 OSS。
 * 调用方已在前端做分片续传，这里服务端拿到合并后的本地文件后整体上传。
 * 不用 ali-oss 的 multipartUpload：其在 Node 22 undici 下抛
 * RequestContentLengthMismatchError（body 长度与 Content-Length 不匹配）。
 * 改用 put（buffer）路径，与 uploadBufferToOss 一致；MAX_FILE_SIZE 100MB 可整体入内存。
 */
export async function multipartUploadFileToOss(
  localPath: string,
  filename: string,
  contentType: string,
  dir = "uploads",
  onProgress?: (p: number) => void
): Promise<UploadedFile> {
  const config = await getOssConfig();
  const objectKey = objectKeyFor(filename, dir);
  const client = createClient(config);
  const start = Date.now();
  const { default: fs } = await import("node:fs/promises");
  const buffer = await fs.readFile(localPath);
  onProgress?.(0.5);
  try {
    await client.put(objectKey, buffer, {
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeFilename(filename)}"`,
      },
    });
  } catch (err) {
    log.error({ key: objectKey, filename, err }, "OSS 上传失败");
    throw err;
  }
  const durationMs = Date.now() - start;
  log.info(
    { key: objectKey, size: buffer.byteLength, durationMs },
    "OSS 上传完成（buffer）"
  );
  onProgress?.(1);
  return {
    key: objectKey,
    url: publicUrl(config, objectKey),
    name: filename,
    size: buffer.byteLength,
    contentType: contentType || "application/octet-stream",
  };
}

/** 上传一个临时探针文件并删除，验证 OSS 配置可用 */
export async function testOssConfig() {
  const uploaded = await uploadBufferToOss(
    Buffer.from(`inkpress oss test ${new Date().toISOString()}\n`),
    "inkpress-oss-test.txt",
    "text/plain",
    "system-tests"
  );
  await deleteFromOss(uploaded.key);
  return uploaded;
}

/** 按 mime 决定 OSS 存储目录与 Asset kind */
export function classifyByContentType(contentType: string): {
  kind: "image" | "video" | "audio" | "file";
  dir: string;
} {
  if (contentType.startsWith("image/")) return { kind: "image", dir: "images" };
  if (contentType.startsWith("video/")) return { kind: "video", dir: "videos" };
  if (contentType.startsWith("audio/")) return { kind: "audio", dir: "audios" };
  return { kind: "file", dir: "files" };
}
