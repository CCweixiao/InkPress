import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  OSS_CONFIG_KEY,
  type OssConfig,
  parseOssConfig,
} from "@/lib/oss-config";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("oss");

export type UploadedFile = {
  key: string;
  url: string;
  name: string;
  size: number;
  contentType: string;
};

export async function getOssConfig(): Promise<OssConfig> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: OSS_CONFIG_KEY },
  });
  if (!item) throw new Error("尚未配置 OSS，请先在「设置」中配置 OSS。");
  return parseOssConfig(item.value);
}

/** OSS 是否已配置（不抛错，用于判断是否走 OSS 上传） */
export async function hasOssConfig(): Promise<boolean> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: OSS_CONFIG_KEY },
  });
  if (!item) return false;
  try {
    parseOssConfig(item.value);
    return true;
  } catch {
    return false;
  }
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
 * 从本地文件分片上传到 OSS（断点续传：基于 ali-oss 的 checkpoint）。
 * 用于分片上传路由：客户端把分片汇总到本地临时文件后，调用此方法整体上传。
 * partSize 默认 1MB；progress 回调用于可选的进度上报。
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
  // ali-oss multipartUpload：服务端断点续传（若同 key+file 的上传中断，可续传）
  try {
    await client.multipartUpload(objectKey, localPath, {
      partSize: 1024 * 1024, // 1MB / part
      headers: {
        "Content-Type": contentType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${safeFilename(filename)}"`,
      },
      progress: (p: number) => {
        onProgress?.(p);
        return Promise.resolve();
      },
    });
  } catch (err) {
    log.error({ key: objectKey, filename, err }, "OSS 分片上传失败");
    throw err;
  }
  const stat = await import("node:fs").then((fs) => fs.promises.stat(localPath));
  const durationMs = Date.now() - start;
  log.info(
    { key: objectKey, size: stat.size, durationMs },
    "OSS 分片上传完成"
  );
  return {
    key: objectKey,
    url: publicUrl(config, objectKey),
    name: filename,
    size: stat.size,
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
  kind: "image" | "video" | "file";
  dir: string;
} {
  if (contentType.startsWith("image/")) return { kind: "image", dir: "images" };
  if (contentType.startsWith("video/")) return { kind: "video", dir: "videos" };
  return { kind: "file", dir: "files" };
}
