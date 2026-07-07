import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@/lib/errors";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("oss");

let _client: OSS | null = null;

/**
 * 规范化 OSS region 为 ali-oss SDK 需要的格式。
 * 接受 "shanghai" / "cn-shanghai" / "oss-cn-shanghai"，统一输出 "cn-shanghai"。
 * 备份脚本（ossutil）直接拼 endpoint，容忍省略 cn- 前缀；但 ali-oss SDK 需要完整格式。
 */
export function normalizeRegion(raw: string): string {
  let r = raw.trim().replace(/^oss-/, "");
  // 纯区域名（如 shanghai / hangzhou / beijing）补 cn- 前缀
  if (!r.includes("-")) {
    r = `cn-${r}`;
  }
  return r;
}

/**
 * 阿里云 OSS 客户端（懒加载单例）。
 * 复用现有 OSS_PUBLISH_* 环境变量（曾被 scripts/backup-to-oss.sh 唯一消费）。
 * 缺失关键配置时抛 AppError(INTERNAL_ERROR)，由调用方 try/catch → failFromError。
 */
export function getOssClient(): OSS {
  if (_client) return _client;
  const regionRaw = process.env.OSS_PUBLISH_REGION?.trim();
  const bucket = process.env.OSS_PUBLISH_BUCKET?.trim();
  const accessKeyId = process.env.OSS_PUBLISH_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.OSS_PUBLISH_ACCESS_KEY_SECRET?.trim();
  if (!regionRaw || !bucket || !accessKeyId || !accessKeySecret) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      "OSS 未配置（缺少 OSS_PUBLISH_REGION/BUCKET/ACCESS_KEY_ID/SECRET）"
    );
  }
  const region = normalizeRegion(regionRaw);
  _client = new OSS({
    region: `oss-${region}`,
    bucket,
    accessKeyId,
    accessKeySecret,
    secure: true,
  });
  log.info({ region, bucket }, "OSS 客户端已初始化");
  return _client;
}

/** 构造工单图片对象 Key：tickets/{userId}/{uuid}.{ext} */
export function buildTicketObjectKey(userId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8);
  return `tickets/${userId}/${randomUUID()}${safeExt ? `.${safeExt}` : ""}`;
}

/** 上传对象到 OSS */
export async function putObject(
  key: string,
  buf: Buffer,
  contentType: string
): Promise<void> {
  await getOssClient().put(key, buf, {
    mime: contentType,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=31536000",
    },
  });
}

/** 生成私有 Bucket 对象的签名 URL（默认 15 分钟有效） */
export function signObjectUrl(
  key: string,
  expiresSec = 900,
  response?: Record<string, string>
): string {
  return getOssClient().signatureUrl(key, { expires: expiresSec, response });
}

/**
 * 从一个完整的 OSS URL 提取 object key 并签发短期访问 URL。
 * 用于发布产物下载场景：DB 中存的是 OSS 完整直链，运行时签名后 302 跳转。
 *
 * - URL hostname 匹配当前配置 bucket → 提取 pathname 作为 key → 签名
 * - URL hostname 不匹配（如未来接 CDN / 其他源）→ 原样返回
 *
 * **安装包强制 attachment**：DMG/EXE/ZIP 等扩展名通过签名 URL 的
 * `response-content-disposition` 显式强制下载，避免关掉 Bucket force-download
 * 后浏览器把安装包当普通资源预览（图片则保持内联渲染）。
 *
 * @param rawUrl OSS 完整 URL（来自 DB 的 downloadUrl 字段）
 * @param expiresSec 签名有效期秒数，默认 600（10 分钟）
 */
export function signOssUrlFromUrl(rawUrl: string, expiresSec = 600): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    // URL 解析失败，原样返回（调用方自行处理）
    return rawUrl;
  }

  const regionRaw = process.env.OSS_PUBLISH_REGION?.trim();
  const bucket = process.env.OSS_PUBLISH_BUCKET?.trim();
  if (!regionRaw || !bucket) {
    // OSS 未配置，无法签名
    return rawUrl;
  }

  const expectedHost = `${bucket}.oss-${normalizeRegion(regionRaw)}.aliyuncs.com`;
  if (u.hostname !== expectedHost) {
    // 非 OSS bucket 域名（可能是 CDN、其他源），原样返回
    return rawUrl;
  }

  // 提取 object key（pathname 去掉前导 /）
  const objectKey = decodeURIComponent(u.pathname.slice(1));
  if (!objectKey) {
    return rawUrl;
  }

  const response = buildDownloadResponse(u.pathname);
  return signObjectUrl(objectKey, expiresSec, response);
}

const DOWNLOAD_EXTENSIONS = /\.(dmg|exe|msi|zip|tar\.gz|tgz|AppImage|deb|rpm|pkg)$/i;

/**
 * 安装包 / 压缩包扩展名 → 让 OSS 签名 URL 显式返回 Content-Disposition: attachment。
 * 关掉 Bucket force-download 后，仅靠 Bucket 默认行为 DMG 不再触发下载，
 * 必须通过签名 URL 的 response 参数覆盖响应头。
 */
function buildDownloadResponse(
  pathname: string
): { "content-disposition": string } | undefined {
  if (!DOWNLOAD_EXTENSIONS.test(pathname)) return undefined;
  const filename = pathname.split("/").filter(Boolean).pop() ?? "download";
  // RFC 6266：filename 仅允许 ASCII，特殊字符用 filename* 编码
  const safe = filename.replace(/["\\]/g, "");
  return { "content-disposition": `attachment; filename="${safe}"` };
}

/** 删除对象（用于用户移除已上传图片，避免孤儿） */
export async function deleteObject(key: string): Promise<void> {
  try {
    await getOssClient().delete(key);
  } catch (err) {
    log.error({ err, key }, "OSS 删除对象失败（已忽略）");
  }
}
