/**
 * HTTP 请求辅助：客户端 IP 提取、UA 截断等。
 */

/**
 * 从请求头解析客户端 IP。
 * 反代（Docker / Nginx）下取 X-Forwarded-For 首段；回退到 x-real-ip。
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** 截断 UA，避免日志/存储过长 */
export function truncateUa(ua: string | null, max = 256): string | null {
  if (!ua) return null;
  return ua.length > max ? ua.slice(0, max) : ua;
}
