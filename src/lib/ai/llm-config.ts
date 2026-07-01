import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.llm-config");

export const LLM_CONFIG_KEY = "inkpress.llm";

/** 旧 claude-agent 配置 key（迁移期读时回落 + 启动迁移用，不再对外暴露编辑入口）。 */
const CLAUDE_AGENT_CONFIG_KEY = "inkpress.claude-agent";

const DEFAULT_CLAUDE_AGENT_BASE_URL = "https://open.bigmodel.cn/api/anthropic";
const DEFAULT_CLAUDE_AGENT_MODEL = "glm-4.6";
const MIGRATED_PROVIDER_ID = "claude-agent-migrated";

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
  apiProvider: string; // anthropic
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
 * - default 只认显式字段；若没有任何显式 default，parseLlmConfigs 再统一挑全局默认。
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
      isDefault: false,
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
        readBoolean(model, "default", false) ||
        readBoolean(model, "isDefault", false),
    };
  }
  throw new Error(`LLM 模型 ${index + 1} 必须是字符串或 JSON 对象。`);
}

/** 读取 models 数组，透传 legacyProviderEnabled；供应商内显式 default 至多一个（首个胜出）。 */
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
  if (item) {
    try {
      return parseLlmConfigs(item.value);
    } catch (e) {
      log.warn({ err: e }, "inkpress.llm 解析失败，尝试 claude-agent 回落");
    }
  }
  // 读时回落：inkpress.llm 为空/不存在/解析失败时，尝试旧 claude-agent 配置
  const fallback = await tryClaudeAgentFallback();
  return fallback ? [fallback] : [];
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
    item.config.id === providerId;

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

/* ------------------- claude-agent 迁移与读时回落 ------------------- */

/** 解析旧 inkpress.claude-agent 配置（私有，仅供迁移/回落用）。 */
function parseClaudeAgentConfig(value?: string | null): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const cfg = raw as Record<string, unknown>;
    const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
    if (!apiKey) return null;
    return {
      baseUrl:
        typeof cfg.baseUrl === "string" && cfg.baseUrl.trim()
          ? cfg.baseUrl.trim()
          : DEFAULT_CLAUDE_AGENT_BASE_URL,
      apiKey,
      model:
        typeof cfg.model === "string" && cfg.model.trim()
          ? cfg.model.trim()
          : DEFAULT_CLAUDE_AGENT_MODEL,
    };
  } catch {
    return null;
  }
}

/** 读旧 claude-agent 配置行（私有）。 */
async function readClaudeAgentConfig(): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
} | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: CLAUDE_AGENT_CONFIG_KEY },
  });
  return parseClaudeAgentConfig(row?.value);
}

/**
 * 读时回落：当 inkpress.llm 为空时，用旧 claude-agent 配置构造一个临时 LlmConfig。
 * 保证迁移函数未执行（首升级）时系统也能工作。
 */
async function tryClaudeAgentFallback(): Promise<LlmConfig | null> {
  const cfg = await readClaudeAgentConfig();
  if (!cfg) return null;
  log.info("inkpress.llm 为空，回落使用 claude-agent 配置");
  return {
    id: MIGRATED_PROVIDER_ID,
    name: "Claude Agent（已迁移）",
    apiProvider: "anthropic",
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    models: [
      { id: cfg.model, name: cfg.model, enabled: true, isDefault: true },
    ],
    temperature: 0.7,
  };
}

/**
 * 启动时自动迁移：把旧 inkpress.claude-agent 配置转为 inkpress.llm 中的一个 provider。
 * 幂等——已有 claude-agent-migrated provider 时不重复写入。
 * 不删 inkpress.claude-agent key（留作备份，代码不再读它）。
 */
export async function migrateClaudeAgentConfig(): Promise<void> {
  const cfg = await readClaudeAgentConfig();
  if (!cfg) return;

  const existing = await prisma.systemConfig.findUnique({
    where: { key: LLM_CONFIG_KEY },
  });

  // 解析已有 llm configs，检查是否已迁移
  let configs: LlmConfig[] = [];
  let llmWasEmpty = true;
  if (existing) {
    try {
      configs = parseLlmConfigs(existing.value);
      llmWasEmpty = configs.length === 0;
    } catch {
      // 解析失败也尝试迁移（覆盖坏数据风险由幂等标记规避）
    }
  }

  if (configs.some((c) => c.id === MIGRATED_PROVIDER_ID)) {
    return; // 已迁移
  }

  const migratedProvider: LlmConfig = {
    id: MIGRATED_PROVIDER_ID,
    name: "Claude Agent（已迁移）",
    apiProvider: "anthropic",
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    models: [
      {
        id: cfg.model,
        name: cfg.model,
        enabled: true,
        isDefault: llmWasEmpty,
      },
    ],
    temperature: 0.7,
  };

  const newConfigs = [...configs, migratedProvider];
  // 若 llm 原本为空，把迁移 provider 的模型设为唯一 default
  if (llmWasEmpty) {
    for (const c of newConfigs) {
      for (const m of c.models) {
        m.isDefault = m === migratedProvider.models[0];
      }
    }
  }

  const value = JSON.stringify(newConfigs, null, 2);
  await prisma.systemConfig.upsert({
    where: { key: LLM_CONFIG_KEY },
    update: { value },
    create: { key: LLM_CONFIG_KEY, value },
  });
  log.info("claude-agent 配置已迁移到 inkpress.llm");
}
