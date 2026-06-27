import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";

export const LLM_CONFIG_KEY = "inkpress.llm";

/**
 * 单个模型：enabled 控制是否在聊天下拉/选择器中可见；
 * isDefault 为「全局唯一默认模型」（跨供应商），由 parseLlmConfigs 归一化保证唯一。
 */
export type LlmModel = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
};

/** 供应商：仅保留连接信息，启用/默认全部下沉到模型级。 */
export type LlmConfig = {
  id: string;
  name: string;
  apiProvider: string; // openai-compatible
  baseUrl: string;
  apiKey: string;
  models: LlmModel[];
  temperature: number;
};

export type SelectedLlmConfig = LlmConfig & {
  model: LlmModel;
};

/** 对外暴露的供应商（脱敏：去掉 apiKey / baseUrl）。 */
export type PublicLlmProvider = Pick<
  LlmConfig,
  "id" | "name" | "apiProvider" | "models" | "temperature"
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

/**
 * 归一化单个模型。
 * - 字符串模型：视为旧格式，enabled 继承 legacyProviderEnabled。
 * - 对象模型：enabled 读字段，缺省回退 legacyProviderEnabled（迁移用）。
 * 供应商内 default 由 readModels 统一裁定（首个胜出），此处仅传透 index。
 */
function normalizeModel(
  raw: unknown,
  index: number,
  legacyProviderEnabled: boolean
): LlmModel {
  if (typeof raw === "string" && raw.trim()) {
    const id = raw.trim();
    return {
      id,
      name: id,
      enabled: legacyProviderEnabled,
      isDefault: index === 0,
    };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const model = raw as JsonObject;
    const id = readString(model, ["id", "model", "name"]);
    if (!id) throw new Error(`LLM 模型 ${index + 1} 缺少 id/model/name。`);
    return {
      id,
      name: readString(model, ["name", "label"]) || id,
      enabled: readBoolean(model, "enabled", legacyProviderEnabled),
      isDefault:
        readBoolean(model, "default", index === 0) ||
        readBoolean(model, "isDefault", false),
    };
  }
  throw new Error(`LLM 模型 ${index + 1} 必须是字符串或 JSON 对象。`);
}

/** 读取 models 数组，透传 legacyProviderEnabled；供应商内至多一个 default（首个胜出）。 */
function readModels(
  config: JsonObject,
  legacyProviderEnabled: boolean
): LlmModel[] {
  const rawModels = config.models;
  const rawModel = config.model ?? config.modelName;
  const models: LlmModel[] = Array.isArray(rawModels)
    ? rawModels.map((m, i) => normalizeModel(m, i, legacyProviderEnabled))
    : rawModel
      ? (Array.isArray(rawModel) ? rawModel : [rawModel]).map((m, i) =>
          normalizeModel(m, i, legacyProviderEnabled)
        )
      : [];

  if (!models.length) return [];
  if (!models.some((model) => model.isDefault)) {
    return [{ ...models[0], isDefault: true }, ...models.slice(1)];
  }
  // 多个 default 时只认第一个
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
  const name = readString(raw, ["name", "label"]) || apiProvider || id;
  const baseUrl = readString(raw, [
    "baseUrl",
    "baseURL",
    "apiUrl",
    "api",
    "endpoint",
  ]).replace(/\/+$/, "");
  const apiKey = readString(raw, ["apiKey", "key", "token"]);
  const legacyEnabled = readBoolean(raw, "enabled", true);
  const legacyDefault =
    readBoolean(raw, "default", false) || readBoolean(raw, "isDefault", false);
  const models = readModels(raw, legacyEnabled);

  // 旧供应商 default 且模型内无 default → 把首个模型提为 default
  if (legacyDefault && models.length && !models.some((m) => m.isDefault)) {
    models[0] = { ...models[0], isDefault: true };
  }

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
    temperature: readNumber(raw, "temperature", 0.7),
  };
}

export function parseLlmConfigs(value: string): LlmConfig[] {
  const raw = parseJsonObjectOrArrayConfig(value, "LLM 配置");
  const items = Array.isArray(raw) ? raw : [raw];
  if (!items.length) throw new Error("LLM 配置数组不能为空。");

  const configs = items.map(normalizeLlmConfig);

  // 唯一 id 校验
  const ids = new Set<string>();
  for (const config of configs) {
    if (ids.has(config.id)) throw new Error(`LLM 配置 id 重复：${config.id}。`);
    ids.add(config.id);
  }

  // 全局唯一 default 解析：模型对象由 normalizeModel 新建，可安全就地调整。
  const allModels = configs.flatMap((config) => config.models);
  const claimedDefault = allModels.find((model) => model.isDefault);
  const target =
    claimedDefault ??
    allModels.find((model) => model.enabled) ??
    allModels[0];
  for (const model of allModels) {
    model.isDefault = model === target;
  }

  return configs;
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
 * enabled 过滤下沉到模型级：先扁平化所有 (供应商, 启用模型) 组合。
 * 1. providerId + modelId → 精确匹配；未命中时回退到该供应商的 default/首个启用模型。
 * 2. 仅 providerId → 该供应商的 default 模型，否则其首个启用模型。
 * 3. 都没指定 → 全局 default（跨供应商），否则首个启用模型。
 */
export async function chooseLlmConfig(
  providerId?: string | null,
  modelId?: string | null
): Promise<SelectedLlmConfig | null> {
  const configs = await getLlmConfigs();
  const flat = configs.flatMap((config) =>
    config.models
      .filter((model) => model.enabled)
      .map((model) => ({ config, model }))
  );
  if (!flat.length) return null;

  const matchesProvider = (item: { config: LlmConfig }) =>
    item.config.id === providerId || item.config.apiProvider === providerId;

  if (providerId && modelId) {
    const exact = flat.find(
      (item) =>
        matchesProvider(item) &&
        (item.model.id === modelId || item.model.name === modelId)
    );
    if (exact) return { ...exact.config, model: exact.model };
  }

  if (providerId) {
    const providerItems = flat.filter(matchesProvider);
    if (!providerItems.length) {
      throw new Error(`未找到可用 LLM 供应商：${providerId}。`);
    }
    const picked =
      providerItems.find((item) => item.model.isDefault) ?? providerItems[0];
    return { ...picked.config, model: picked.model };
  }

  const def = flat.find((item) => item.model.isDefault) ?? flat[0];
  return { ...def.config, model: def.model };
}
