import { parseJsonObjectOrArrayConfig } from "@/lib/system-config";
import { decryptConfigValueForUse } from "@/lib/config-secrets";
import { prisma } from "@/lib/db";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.embedding-config");

export const EMBEDDING_CONFIG_KEY = "inkpress.embedding";

export const EMBEDDING_DIMENSIONS = [256, 512, 1024, 2048] as const;
export type EmbeddingDimensions = (typeof EMBEDDING_DIMENSIONS)[number];

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions: EmbeddingDimensions;
};

/** 智谱 OpenAI 兼容 embedding 端点默认值（设置表单预填）。 */
export const DEFAULT_EMBEDDING_CONFIG = {
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  model: "embedding-3",
  dimensions: 1024 as EmbeddingDimensions,
};

function readString(obj: Record<string, unknown>, fields: string[]): string {
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * 解析 embedding 配置 JSON（与 llm-config 同款校验风格，被 system-config 路由复用）。
 * - baseUrl 去尾斜杠；apiKey 必填；model 缺省 embedding-3。
 * - dimensions 缺省/非法（非 256/512/1024/2048）回落 1024。
 */
export function parseEmbeddingConfig(value: string): EmbeddingConfig {
  const raw = parseJsonObjectOrArrayConfig(value, "embedding 配置");
  const obj = (
    Array.isArray(raw) ? (raw[0] ?? {}) : raw
  ) as Record<string, unknown>;
  const baseUrl = readString(obj, ["baseUrl", "baseURL", "endpoint"]).replace(/\/+$/, "");
  const apiKey = readString(obj, ["apiKey", "key", "token"]);
  const model = readString(obj, ["model", "modelName"]) || DEFAULT_EMBEDDING_CONFIG.model;
  const dimsRaw = Number(obj.dimensions);
  const dimensions = (EMBEDDING_DIMENSIONS as readonly number[]).includes(dimsRaw)
    ? (dimsRaw as EmbeddingDimensions)
    : DEFAULT_EMBEDDING_CONFIG.dimensions;
  const missing = [!baseUrl && "baseUrl", !apiKey && "apiKey"].filter(Boolean);
  if (missing.length) throw new Error(`embedding 配置缺少字段：${missing.join(", ")}。`);
  return { baseUrl, apiKey, model, dimensions };
}

/**
 * 读取 embedding 配置并解密 apiKey。不存在/解析失败 → null（不抛错，调用方据此跳过）。
 * 解密走 config-secrets 的 CONFIG_SECRET_FIELDS 注册，保证存读一致。
 */
export async function getEmbeddingConfig(): Promise<EmbeddingConfig | null> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: EMBEDDING_CONFIG_KEY },
  });
  if (!item) return null;
  try {
    const decrypted = decryptConfigValueForUse(EMBEDDING_CONFIG_KEY, item.value);
    return parseEmbeddingConfig(decrypted ?? "");
  } catch (e) {
    log.warn({ err: e }, "inkpress.embedding 解析失败（回落 null）");
    return null;
  }
}
