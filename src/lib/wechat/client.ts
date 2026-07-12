import { getAccessToken } from "./token";
import crypto from "node:crypto";

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
  init?: { method?: "GET" | "POST"; query?: Record<string, string>; accountId?: string }
): Promise<WxResponse> {
  const method = init?.method ?? "POST";
  return wxJsonWithRetry(path, body, method, init?.query, init?.accountId, false);
}

async function wxJsonWithRetry(
  path: string,
  body: unknown,
  method: "GET" | "POST",
  query: Record<string, string> | undefined,
  accountId: string | undefined, retried: boolean
): Promise<WxResponse> {
  const token = await getAccessToken(accountId);
  const qs = new URLSearchParams({ access_token: token, ...query });
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const raw = await res.text();
  let data: WxResponse;
  try {
    data = JSON.parse(raw) as WxResponse;
  } catch {
    throw new Error(
      `微信接口 ${path} 返回非 JSON 响应（HTTP ${res.status}${raw ? `，${raw.slice(0, 120)}` : "，响应为空"}）。`
    );
  }

  if (data.errcode === 40001 && !retried) {
    // token 失效，强刷后重试一次
    await getAccessToken(accountId, true);
    return wxJsonWithRetry(path, body, method, query, accountId, true);
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
  query: Record<string, string> = {}, accountId?: string
): Promise<WxResponse> {
  const token = await getAccessToken(accountId);
  const qs = new URLSearchParams({ access_token: token, ...query });
  const url = `${BASE}${path}?${qs}`;
  // 微信媒体上传接口要求 HTTP Header 必须包含 Content-Length。
  // undici fetch 对 FormData 体不保证设置 Content-Length（可能走 chunked），
  // 导致微信收不到 media 字段 → 41005 media data missing。
  // 手动构建 multipart body 并显式设置 Content-Length 解决此问题。
  const { body, boundary } = await buildMultipartBody(formData);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.byteLength),
    },
    body,
  });
  const raw = await res.text();
  try {
    return JSON.parse(raw) as WxResponse;
  } catch {
    throw new Error(
      `微信接口 ${path} 返回非 JSON 响应（HTTP ${res.status}${raw ? `，${raw.slice(0, 120)}` : "，响应为空"}）。`
    );
  }
}

/**
 * 手动构建 multipart/form-data 请求体。
 * 确保 Content-Length 可计算并显式设置，兼容微信媒体上传接口。
 */
async function buildMultipartBody(
  formData: FormData
): Promise<{ body: ArrayBuffer; boundary: string }> {
  const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of formData.entries()) {
    if (value instanceof Blob) {
      const filename = (value as File).name || key;
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"; filename="${filename}"\r\n` +
            `Content-Type: ${value.type || "application/octet-stream"}\r\n\r\n`
        )
      );
      chunks.push(Buffer.from(await value.arrayBuffer()));
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${String(value)}\r\n`
        )
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const combined = Buffer.concat(chunks);
  // 拷贝到独立 ArrayBuffer（Buffer 内部可能是大池子的视图，slice 取出精确区间）
  return {
    body: combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength),
    boundary,
  };
}

/** 抛错：当 errcode 非 0 */
export function ensureOk(data: WxResponse, ctx: string): void {
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`${ctx} 失败：${data.errcode} ${data.errmsg ?? ""}`);
  }
}
