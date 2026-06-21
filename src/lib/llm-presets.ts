import { prisma } from "@/lib/db";
import {
  parseJsonObjectOrArrayConfig,
  type JsonObject,
} from "@/lib/system-config";

/**
 * LLM 厂商预设模板（只读）。
 *
 * 与 inkpress.llm（用户实际配置，含 apiKey）区分：
 * - inkpress.llm.presets 只存厂商的 baseUrl / apiProvider / 常见模型名，不含密钥。
 * - 用户在设置页选择某个预设 → 填入 apiKey → 保存到 inkpress.llm。
 */

export const LLM_PRESETS_KEY = "inkpress.llm.presets";

/** 预设模板项（与 LlmConfig 形状接近，但 apiKey 固定为空） */
export type LlmPreset = {
  id: string;
  name: string;
  apiProvider: string;
  baseUrl: string;
  models: { id: string; name: string }[];
  docsUrl?: string;
};

/** 内置厂商预设（也作为 data.sql 种子） */
export const BUILTIN_LLM_PRESETS: LlmPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    apiProvider: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
    ],
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiProvider: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
    docsUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    apiProvider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-opus-4", name: "Claude Opus 4" },
    ],
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiProvider: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
    ],
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    apiProvider: "openai",
    baseUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o mini" },
    ],
    docsUrl: "https://portal.azure.com",
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    apiProvider: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      { id: "qwen2.5:32b", name: "Qwen2.5 32B" },
      { id: "llama3.3:70b", name: "Llama 3.3 70B" },
    ],
    docsUrl: "https://ollama.com",
  },
];

function readString(c: JsonObject, fields: string[]): string {
  for (const f of fields) {
    const v = c[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** 解析预设模板列表 */
export function parseLlmPresets(value: string): LlmPreset[] {
  const raw = parseJsonObjectOrArrayConfig(value, "LLM 预设");
  const items = (Array.isArray(raw) ? raw : [raw]) as JsonObject[];
  return items.map((c, i) => {
    const id = readString(c, ["id", "code"]) || `preset-${i + 1}`;
    const name = readString(c, ["name", "label"]) || id;
    const apiProvider = readString(c, ["apiProvider", "provider", "type"]);
    const baseUrl = readString(c, ["baseUrl", "baseURL", "apiUrl"]);
    const rawModels = c.models;
    const models = Array.isArray(rawModels)
      ? (rawModels as JsonObject[])
          .map((m) => readString(m, ["id", "model", "name"]))
          .filter(Boolean)
          .map((mid) => ({ id: mid, name: mid }))
      : [];
    const docsUrl = readString(c, ["docsUrl", "docs"]);
    if (!apiProvider || !baseUrl) {
      throw new Error(`LLM 预设 ${name} 缺少 apiProvider 或 baseUrl。`);
    }
    return { id, name, apiProvider, baseUrl, models, ...(docsUrl ? { docsUrl } : {}) };
  });
}

/** 读取预设模板（DB 无记录时返回内置预设，不抛错） */
export async function getLlmPresets(): Promise<LlmPreset[]> {
  const item = await prisma.systemConfig.findUnique({
    where: { key: LLM_PRESETS_KEY },
  });
  if (!item) return BUILTIN_LLM_PRESETS;
  try {
    return parseLlmPresets(item.value);
  } catch {
    return BUILTIN_LLM_PRESETS;
  }
}
