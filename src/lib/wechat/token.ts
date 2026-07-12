const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";

type Cached = { value: string; expiresAt: number };

// 模块级单实例缓存。
// TODO: 多实例部署需换 Redis 共享缓存，避免并发刷新导致 token 互相失效。
const cached = new Map<string, Cached>();
const refreshPromises = new Map<string, Promise<string>>();

/**
 * 获取 access_token（带缓存，TTL 内不重复请求）
 * 使用 stable_token 接口（force_refresh:false），与历史 getAccessToken 路径隔离。
 * 凭证来源：SystemConfig 表（inkpress.wechat），由设置页管理。
 */
export async function getAccessToken(accountId?: string, forceRefresh = false): Promise<string> {
  const key = accountId ?? "legacy";
  const hit = cached.get(key);
  if (!forceRefresh && hit && Date.now() < hit.expiresAt) {
    return hit.value;
  }
  // 避免并发刷新（stampede）
  const pending = refreshPromises.get(key);
  if (pending) return pending;

  const refreshPromise = (async () => {
    const { getWechatAccountConfig } = await import("./config");
    const { appId: appid, secret } = await getWechatAccountConfig(accountId);
    if (!appid || !secret) {
      throw new Error("未配置微信公众号凭证，请在设置页填写 appId 与 secret");
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
    const raw = await res.text();
    let data: {
      access_token?: string;
      expires_in?: number;
      errcode?: number;
      errmsg?: string;
    };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      throw new Error(
        `获取 access_token 失败：微信接口返回非 JSON 响应（HTTP ${res.status}${raw ? `，${raw.slice(0, 120)}` : "，响应为空"}）。`
      );
    }
    if (data.errcode || !data.access_token) {
      throw new Error(
        `获取 access_token 失败：${data.errcode ?? ""} ${data.errmsg ?? ""}`
      );
    }
    // 提前 5 分钟过期，留安全边际
    cached.set(key, {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 - 5 * 60 * 1000,
    });
    return data.access_token;
  })();
  refreshPromises.set(key, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    refreshPromises.delete(key);
  }
}
