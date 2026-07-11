import presets from "@/data/llm-presets.json";

/**
 * LLM 厂商预设模板（只读，前后端共享单一数据源）。
 *
 * 与 inkpress.llm（用户实际配置，含 apiKey）区分：
 * - 本清单只存厂商的 baseUrl / apiProvider / 常见模型名，不含密钥。
 * - 用户在设置页选择某个预设 → 填入 apiKey → 保存到 inkpress.llm。
 *
 * 所有厂商统一走 Anthropic /messages 协议（见 src/lib/ai/provider.ts）。
 */

/** 预设模板项（与 LlmConfig 形状接近，但 apiKey 固定为空） */
export type LlmPreset = {
  id: string;
  name: string;
  apiProvider: string;
  baseUrl: string;
  /**
   * 模型列表拉取用的独立 base（OpenAI 兼容风格）。
   * 部分厂商的 Anthropic 兼容端点不支持 /v1/models（如智谱），
   * 但其 OpenAI 兼容端点提供 /models，通过此字段指定。
   * 缺省时用 {baseUrl}/v1/models（Anthropic 风格）。
   */
  modelsBaseUrl?: string;
  models: { id: string; name: string }[];
  docsUrl?: string;
};

export const LLM_PRESETS: readonly LlmPreset[] = presets as readonly LlmPreset[];
