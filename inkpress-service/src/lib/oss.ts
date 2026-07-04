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
function normalizeRegion(raw: string): string {
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
export function signObjectUrl(key: string, expiresSec = 900): string {
  return getOssClient().signatureUrl(key, { expires: expiresSec });
}

/** 删除对象（用于用户移除已上传图片，避免孤儿） */
export async function deleteObject(key: string): Promise<void> {
  try {
    await getOssClient().delete(key);
  } catch (err) {
    log.error({ err, key }, "OSS 删除对象失败（已忽略）");
  }
}
