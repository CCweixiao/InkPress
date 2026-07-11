import { assertSafePublicUrl } from "@/lib/ai/safe-web";

/** 从上游 /v1/models 拉取后归一化的模型条目。 */
export type FetchedModel = { id: string; name: string };

export type ModelFetchErrorCode =
  | "invalid_url"
  | "ssrf_blocked"
  | "unauthorized"
  | "timeout"
  | "upstream_error"
  | "parse_error"
  | "network_error";

/** 模型拉取过程中的归一化错误，route 层据此映射 HTTP 状态码。 */
export class ModelFetchError extends Error {
  constructor(
    public readonly code: ModelFetchErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ModelFetchError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 拉取模型列表并归一化。
 *
 * 端点选择：
 * - 缺省（Anthropic 风格）：`{baseUrl}/v1/models`，认证用 `x-api-key`。
 * - 当 `modelsBaseUrl` 提供时（OpenAI 兼容风格，如智谱）：`{modelsBaseUrl}/models`。
 *   此时同时发 `Authorization: Bearer`，兼容 OpenAI 风格鉴权（服务端各取所需）。
 *
 * 设计要点：
 * - 复用 assertSafePublicUrl 做 SSRF 防护（含 DNS 解析 + 私网拦截），两个 base 都校验。
 * - 不跟随重定向（redirect: "error"）：避免被引导到内网地址。
 * - fetchImpl 可注入，便于单测；缺省用全局 fetch。
 * - 超时通过 AbortController 实现，归一化为 "timeout" 错误。
 * - normalize 兼容 Anthropic（{data:[{id,display_name}]}）与 OpenAI（{data:[{id}]}）两种响应。
 */
export async function fetchAnthropicModels(input: {
  baseUrl: string;
  apiKey: string;
  /** OpenAI 兼容端点 base，用于拉取模型列表（部分厂商的 Anthropic 端点不支持 /v1/models）。 */
  modelsBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<FetchedModel[]> {
  const trimmedBase = input.baseUrl.trim();
  const trimmedKey = input.apiKey.trim();
  if (!trimmedBase || !trimmedKey) {
    throw new ModelFetchError("invalid_url", "Base URL 和 API Key 不能为空。");
  }

  const safeFromUrl = async (raw: string) => {
    try {
      return await assertSafePublicUrl(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ModelFetchError(
        /本机|内网|保留|loopback|private/i.test(msg) ? "ssrf_blocked" : "invalid_url",
        msg
      );
    }
  };

  const safeBase = await safeFromUrl(trimmedBase);
  // 端点：有 modelsBaseUrl 走 OpenAI 风格在其路径后接 /models，否则 Anthropic 风格 {baseUrl}/v1/models。
  // 注意：不能用 new URL("/models", base)——绝对路径 /models 会替换整个 pathname，丢掉 /api/paas/v4。
  const trimmedModelsBase = input.modelsBaseUrl?.trim();
  const modelsUrl = trimmedModelsBase
    ? (await safeFromUrl(trimmedModelsBase)).replace(/\/+$/, "") + "/models"
    : new URL("/v1/models", safeBase).toString();
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(modelsUrl, {
      method: "GET",
      headers: {
        // 双认证头：Anthropic 端点读 x-api-key，OpenAI 兼容端点读 Bearer；服务端各取所需。
        "x-api-key": trimmedKey,
        Authorization: `Bearer ${trimmedKey}`,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
      },
      signal: controller.signal,
      redirect: "error",
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ModelFetchError(
        "timeout",
        `请求超时（${Math.round(timeoutMs / 1000)}s），请检查 Base URL 或稍后重试。`
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ModelFetchError("network_error", `无法连接到上游服务：${msg}`);
  }
  clearTimeout(timer);

  if (response.status === 401 || response.status === 403) {
    throw new ModelFetchError(
      "unauthorized",
      "API Key 无效或无权限访问模型列表。"
    );
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      /* 忽略响应体读取失败 */
    }
    throw new ModelFetchError(
      "upstream_error",
      `上游返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`
    );
  }

  // Content-Type 守卫：若返回 HTML（如智谱 Anthropic 端点不支持 /v1/models 返回 web 页面），
  // 提前给出清晰提示，而非让 response.json() 抛「Unexpected token <」。
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new ModelFetchError(
      "parse_error",
      "该端点未返回 JSON（服务可能不支持模型列表接口，请改用手动添加模型 ID）。"
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ModelFetchError("parse_error", `返回内容不是有效 JSON：${msg}`);
  }

  const models = normalizeModelsPayload(payload);
  if (models.length === 0) {
    throw new ModelFetchError(
      "parse_error",
      "返回格式无法识别（服务可能不支持 /v1/models 端点）。"
    );
  }
  return models;
}

/**
 * 解析 Anthropic /v1/models 响应，归一化为 [{ id, name }]。
 * 容忍字段缺失：display_name 缺失时回退到 id；type 非 "model" 的条目跳过。
 * 按 id 升序排序，保证可重现。
 */
function normalizeModelsPayload(payload: unknown): FetchedModel[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models: FetchedModel[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!id) continue;
    // type 字段存在时，仅保留 type === "model"；缺失则放行（兼容不同实现）。
    if ("type" in obj && obj.type !== undefined && obj.type !== "model") continue;
    const displayName = typeof obj.display_name === "string" ? obj.display_name.trim() : "";
    models.push({ id, name: displayName || id });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}
