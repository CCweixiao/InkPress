import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { chooseLlmConfig, type SelectedLlmConfig } from "@/lib/ai/llm-config";

/**
 * 从数据库的「模型配置」加载 LanguageModel（统一走 openai-compatible 协议，
 * 覆盖 OpenAI / 智谱 GLM / DeepSeek 等兼容厂商）。
 *
 * 所有密钥与模型配置统一由 SystemConfig 表（inkpress.llm）管理，不再读取环境变量。
 * 未配置任何供应商时抛出清晰错误，引导用户到设置页配置。
 */
export async function getModel(
  providerId?: string | null,
  modelId?: string | null
): Promise<{ model: LanguageModel; config: SelectedLlmConfig | null }> {
  const selected = await chooseLlmConfig(providerId, modelId);
  if (selected) {
    return { model: createModel(selected), config: selected };
  }
  throw new Error(
    "尚未配置 AI 模型，请先在「设置 → 系统配置 → AI 模型」中添加至少一个供应商并填入 API Key。"
  );
}

function createModel(config: SelectedLlmConfig): LanguageModel {
  if (config.apiProvider.toLowerCase() !== "openai-compatible") {
    throw new Error(`暂不支持 LLM API Provider：${config.apiProvider}。`);
  }
  const provider = createOpenAICompatible({
    name: config.id,
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  return provider(config.model.id);
}
