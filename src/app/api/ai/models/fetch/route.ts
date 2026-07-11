import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fetchAnthropicModels,
  ModelFetchError,
  type ModelFetchErrorCode,
} from "@/lib/ai/model-fetcher";
import { getLlmConfigs } from "@/lib/ai/llm-config";
import { LLM_PRESETS } from "@/lib/llm-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 入参支持两种模式（二选一）：
 * - { providerId }：已保存 provider，从 DB 读解密后的明文 apiKey + baseUrl。
 *   解决前端拿到的是脱敏占位符 "********" 无法发起请求的问题。
 * - { baseUrl, apiKey }：未保存 provider，前端表单直传当前值。
 */
const bodySchema = z
  .object({
    providerId: z.string().trim().optional(),
    baseUrl: z.string().trim().optional(),
    apiKey: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.providerId) return; // providerId 优先，其余忽略
    if (!data.baseUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请填写 Base URL。", path: ["baseUrl"] });
    }
    if (!data.apiKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "请填写 API Key。", path: ["apiKey"] });
    }
  });

/** ModelFetchErrorCode → HTTP 状态码映射。 */
const STATUS_BY_CODE: Record<ModelFetchErrorCode, number> = {
  invalid_url: 400,
  ssrf_blocked: 403,
  unauthorized: 401,
  timeout: 408,
  upstream_error: 502,
  parse_error: 422,
  network_error: 502,
};

/**
 * 从 Anthropic 兼容端点拉取模型列表。
 * 已保存 provider 传 { providerId }（服务端从 DB 解密 key）；
 * 未保存 provider 传 { baseUrl, apiKey }（前端表单当前值）。
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是有效 JSON。" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数校验失败。" },
      { status: 400 }
    );
  }

  // providerId 模式：从 DB 读明文 key + baseUrl；从预设查 modelsBaseUrl（DB 旧配置可能没此字段）
  let baseUrl: string;
  let apiKey: string;
  let modelsBaseUrl: string | undefined;
  if (parsed.data.providerId) {
    const configs = await getLlmConfigs();
    const provider = configs.find((c) => c.id === parsed.data.providerId);
    if (!provider) {
      return NextResponse.json(
        { error: "未找到该供应商配置，请先保存后再拉取。" },
        { status: 404 }
      );
    }
    baseUrl = provider.baseUrl;
    apiKey = provider.apiKey;
    modelsBaseUrl = LLM_PRESETS.find((p) => p.id === parsed.data.providerId)?.modelsBaseUrl;
  } else {
    baseUrl = parsed.data.baseUrl!;
    apiKey = parsed.data.apiKey!;
  }

  try {
    const models = await fetchAnthropicModels({ baseUrl, apiKey, modelsBaseUrl });
    return NextResponse.json({ models });
  } catch (err) {
    if (err instanceof ModelFetchError) {
      const status = STATUS_BY_CODE[err.code] ?? 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    return NextResponse.json({ error: "拉取模型列表时发生未知错误。" }, { status: 500 });
  }
}
