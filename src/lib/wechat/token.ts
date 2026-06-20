const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";

type Cached = { value: string; expiresAt: number };

// 模块级单实例缓存。
// TODO: 多实例部署需换 Redis 共享缓存，避免并发刷新导致 token 互相失效。
let cached: Cached | null = null;
let refreshPromise: Promise<string> | null = null;

/**
 * 获取 access_token（带缓存，TTL 内不重复请求）
 * 使用 stable_token 接口（force_refresh:false），与历史 getAccessToken 路径隔离。
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }
  // 避免并发刷新（stampede）
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appid || !secret) {
      throw new Error(
        "未配置 WX_APPID / WX_SECRET，请在 .env 或设置页填写公众号凭证"
      );
    }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid,
        secret,
        force_refresh: forceRefresh,
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    if (data.errcode || !data.access_token) {
      throw new Error(
        `获取 access_token 失败：${data.errcode ?? ""} ${data.errmsg ?? ""}`
      );
    }
    // 提前 5 分钟过期，留安全边际
    cached = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 - 5 * 60 * 1000,
    };
    refreshPromise = null;
    return cached.value;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
