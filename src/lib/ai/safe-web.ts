import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("2001:db8:")
  );
}

export async function assertSafePublicUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("网址格式无效。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("仅允许读取 HTTP 或 HTTPS 网页。");
  }
  if (url.username || url.password) throw new Error("网址不能包含认证信息。");
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("拒绝访问本机或内网地址。");
  }
  const directType = net.isIP(hostname);
  const addresses = directType
    ? [{ address: hostname, family: directType }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address, family }) =>
      family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address)
    )
  ) {
    throw new Error("拒绝访问本机、内网或保留地址。");
  }
  return url.toString();
}
