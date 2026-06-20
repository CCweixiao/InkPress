import { getAccessToken } from "./token";

const BASE = "https://api.weixin.qq.com/cgi-bin";

export type WxResponse = {
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
};

/**
 * 微信 API 统一调用：
 * - 自动拼 access_token
 * - errcode===40001（token 失效）→ 强刷 token 重试一次
 * - errcode===40164（IP 未加白名单）→ 友好提示
 * - 其余 errcode 抛带 errmsg 的错
 */
export async function wxJson(
  path: string,
  body: unknown,
  init?: { method?: "GET" | "POST"; query?: Record<string, string> }
): Promise<WxResponse> {
  const method = init?.method ?? "POST";
  return wxJsonWithRetry(path, body, method, init?.query, false);
}

async function wxJsonWithRetry(
  path: string,
  body: unknown,
  method: "GET" | "POST",
  query: Record<string, string> | undefined,
  retried: boolean
): Promise<WxResponse> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ access_token: token, ...query });
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as WxResponse;

  if (data.errcode === 40001 && !retried) {
    // token 失效，强刷后重试一次
    await getAccessToken(true);
    return wxJsonWithRetry(path, body, method, query, true);
  }
  if (data.errcode === 40164) {
    throw new Error(
      "调用失败：服务器出口 IP 不在公众号 IP 白名单内（公众平台 → 基本配置 → IP 白名单）"
    );
  }
  return data;
}

/** 上传文件（multipart/form-data），返回解析后的 JSON */
export async function wxUpload(
  path: string,
  formData: FormData,
  query: Record<string, string> = {}
): Promise<WxResponse> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ access_token: token, ...query });
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, { method: "POST", body: formData });
  return (await res.json()) as WxResponse;
}

/** 抛错：当 errcode 非 0 */
export function ensureOk(data: WxResponse, ctx: string): void {
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`${ctx} 失败：${data.errcode} ${data.errmsg ?? ""}`);
  }
}
