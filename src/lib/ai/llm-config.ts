import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";

export const LLM_CONFIG_KEY = "inkpress.llm";

export type LlmModel = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type LlmConfig = {
  id: string;
  name: string;
  apiProvider: string; // openai-compatible
  baseUrl: string;
  apiKey: string;
  models: LlmModel[];
  enabled: boolean;
  isDefault: boolean;
  temperature: number;
};

export type SelectedLlmConfig = LlmConfig & {
  model: LlmModel;
};

/** 对外暴露的供应商（脱敏：去掉 apiKey / baseUrl） */
export type PublicLlmProvider = Pick<
  LlmConfig,
  "id" | "name" | "apiProvider" | "models" | "enabled" | "isDefault" | "temperature"
>;

function readString(config: JsonObject, fields: string[]) {
  for (const field of fields) {
    const value = config[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readBoolean(config: JsonObject, field: string, fallback: boolean) {
  const value = config[field];
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(config: JsonObject, field: string, fallback: number) {
  const value = config[field];
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(2, Math.max(0, value));
}

function normalizeModel(raw: unknown, index: number): LlmModel {
  if (typeof raw === "string" && raw.trim()) {
    return { id: raw.trim(), name: raw.trim(), isDefault: index === 0 };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const model = raw as JsonObject;
    const id = readString(model, ["id", "model", "name"]);
    if (!id) throw new Error(`LLM 模型 ${index + 1} 缺少 id/model/name。`);
    return {
      id,
      name: readString(model, ["name", "label"]) || id,
      isDefault:
        readBoolean(model, "default", index === 0) ||
        readBoolean(model, "isDefault", false),
    };
  }
  throw new Error(`LLM 模型 ${index + 1} 必须是字符串或 JSON 对象。`);
}

function readModels(config: JsonObject) {
  const rawModels = config.models;
  const rawModel = config.model ?? config.modelName;
  const models = Array.isArray(rawModels)
    ? rawModels.map(normalizeModel)
    : rawModel
      ? (Array.isArray(rawModel) ? rawModel : [rawModel]).map(normalizeModel)
      : [];

  if (!models.length) return [];
  // 至少标记一个 default；多个 default 时只认第一个
  if (!models.some((model) => model.isDefault)) {
    return [{ ...models[0], isDefault: true }, ...models.slice(1)];
  }
  return models.map((model, index) => ({
    ...model,
    isDefault:
      model.isDefault && !models.slice(0, index).some((item) => item.isDefault),
  }));
}

function normalizeLlmConfig(raw: JsonObject, index: number): LlmConfig {
  const apiProvider = readString(raw, [
    "apiProvider",
    "provider",
    "type",
    "vendor",
  ]);
  const id =
    readString(raw, ["id", "code"]) || apiProvider || `llm-${index + 1}`;
  const name =
    readString(raw, ["name", "label"]) || apiProvider || id;
  const baseUrl = readString(raw, [
    "baseUrl",
    "baseURL",
    "apiUrl",
    "api",
    "endpoint",
  ]).replace(/\/+$/, "");
  const apiKey = readString(raw, ["apiKey", "key", "token"]);
  const models = readModels(raw);

  const missing = [
    !apiProvider && "apiProvider",
    !baseUrl && "baseUrl/apiUrl",
    !apiKey && "apiKey/key",
    !models.length && "model",
  ].filter(Boolean);
  if (missing.length)
    throw new Error(`LLM 配置 ${name} 缺少字段：${missing.join(", ")}。`);

  return {
    id,
    name,
    apiProvider,
    baseUrl,
    apiKey,
    models,
    enabled: readBoolean(raw, "enabled", true),
    isDefault:
      readBoolean(raw, "default", false) || readBoolean(raw, "isDefault", false),
    temperature: readNumber(raw, "temperature", 0.7),
  };
}

export function parseLlmConfigs(value: string): LlmConfig[] {
  const raw = parseJsonObjectOrArrayConfig(value, "LLM 配置");
  const items = Array.isArray(raw) ? raw : [raw];
  if (!items.length) throw new Error("LLM 配置数组不能为空。");

  const configs = items.map(normalizeLlmConfig);
  const ids = new Set<string>();
  for (const config of configs) {
    if (ids.has(config.id)) throw new Error(`LLM 配置 id 重复：${config.id}。`);
    ids.add(config.id);
  }
  // 最多一个 default
  const defaultSeen: boolean[] = [];
  return configs.map((config, i) => {
    const isDef = config.isDefault && !defaultSeen.includes(true);
    defaultSeen.push(isDef);
    return { ...config, isDefault: isDef };
  });
}

export async function getLlmConfigs(): Promise<LlmConfig[]> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: LLM_CONFIG_KEY },
  });
  if (!item) return [];
  return parseLlmConfigs(item.value);
}

export async function getPublicLlmProviders(): Promise<PublicLlmProvider[]> {
  return (await getLlmConfigs()).map(
    ({ apiKey: _apiKey, baseUrl: _baseUrl, ...provider }) => provider
  );
}

/**
 * 选择一个生效的 LLM 配置 + 模型。
 * - providerId/modelId 指定时精确匹配；未指定时取 default（或第一个 enabled）。
 */
export async function chooseLlmConfig(
  providerId?: string | null,
  modelId?: string | null
): Promise<SelectedLlmConfig | null> {
  const configs = (await getLlmConfigs()).filter((config) => config.enabled);
  if (!configs.length) return null;

  let config: LlmConfig;
  if (providerId) {
    const matched = configs.find(
      (item) => item.id === providerId || item.apiProvider === providerId
    );
    if (matched) config = matched;
    else throw new Error(`未找到可用 LLM 供应商：${providerId}。`);
  } else {
    config = configs.find((item) => item.isDefault) ?? configs[0];
  }

  if (modelId) {
    const model = config.models.find(
      (item) => item.id === modelId || item.name === modelId
    );
    if (model) return { ...config, model };
    throw new Error(`供应商 ${config.name} 未配置模型：${modelId}。`);
  }
  return {
    ...config,
    model: config.models.find((model) => model.isDefault) ?? config.models[0],
  };
}
