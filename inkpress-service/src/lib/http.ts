/**
 * HTTP 请求辅助：客户端 IP 提取、UA 截断等。
 */
import { isIP } from "node:net";
import { AppError, ErrorCode } from "@/lib/errors";

const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
const MAX_FORWARDED_IPS = 10;

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutPort =
    trimmed.startsWith("[") && trimmed.includes("]")
      ? trimmed.slice(1, trimmed.indexOf("]"))
      : trimmed.replace(/:\d+$/, "");
  const ip = withoutPort.startsWith("::ffff:")
    ? withoutPort.slice("::ffff:".length)
    : withoutPort;
  return isIP(ip) ? ip : null;
}

/**
 * 从请求头解析客户端 IP。
 * 反代（Caddy / Docker）下取 X-Forwarded-For 首个合法 IP；回退到 x-real-ip。
 * 非法 / 伪造头一律丢弃，避免限流与审计被任意字符串污染。
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    for (const part of xff.split(",").slice(0, MAX_FORWARDED_IPS)) {
      const ip = normalizeIp(part);
      if (ip) return ip;
    }
  }
  const realIp = normalizeIp(headers.get("x-real-ip"));
  if (realIp) return realIp;
  return "unknown";
}

/** 截断 UA，避免日志/存储过长 */
export function truncateUa(ua: string | null, max = 256): string | null {
  if (!ua) return null;
  return ua.length > max ? ua.slice(0, max) : ua;
}

function assertContentLength(headers: Headers, limitBytes: number): void {
  const raw = headers.get("content-length");
  if (!raw) return;
  const size = Number(raw);
  if (Number.isFinite(size) && size > limitBytes) {
    throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE, "请求体过大");
  }
}

function assertJsonContentType(headers: Headers): void {
  const contentType = headers.get("content-type");
  if (!contentType) return;
  const mime = contentType.split(";")[0]?.trim().toLowerCase();
  if (mime !== "application/json" && !mime.endsWith("+json")) {
    throw new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE, "仅支持 JSON 请求体");
  }
}

export async function readTextBody(
  req: Request,
  opts: { limitBytes?: number; requireJsonContentType?: boolean } = {}
): Promise<string> {
  const limitBytes = opts.limitBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
  assertContentLength(req.headers, limitBytes);
  if (opts.requireJsonContentType) assertJsonContentType(req.headers);

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > limitBytes) {
    throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE, "请求体过大");
  }
  return raw;
}

export async function readJsonBody(
  req: Request,
  opts: { limitBytes?: number } = {}
): Promise<unknown> {
  const raw = await readTextBody(req, {
    limitBytes: opts.limitBytes,
    requireJsonContentType: true,
  });
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "请求体非法");
  }
}

export async function readOptionalJsonBody(
  req: Request,
  opts: { limitBytes?: number } = {}
): Promise<unknown | undefined> {
  const raw = await readTextBody(req, {
    limitBytes: opts.limitBytes,
    requireJsonContentType: true,
  });
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "请求体非法");
  }
}
