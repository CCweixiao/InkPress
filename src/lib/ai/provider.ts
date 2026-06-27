import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { chooseLlmConfig, type SelectedLlmConfig } from "@/lib/ai/llm-config";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.provider");

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
    log.debug(
      {
        providerId: selected.id,
        modelId: selected.model.id,
        baseUrl: selected.baseUrl,
      },
      "已加载 AI 模型"
    );
    return { model: createModel(selected), config: selected };
  }
  log.error({ providerId, modelId }, "未配置任何 AI 模型供应商");
  throw new Error(
    "尚未配置 AI 模型，请先在「设置 → 系统配置 → AI 模型」中添加至少一个供应商并填入 API Key。"
  );
}

function createModel(config: SelectedLlmConfig): LanguageModel {
  // 所有非 Anthropic 厂商统一走 openai-compatible 通道：
  // OpenAI / DeepSeek / Azure / OpenRouter / Ollama / 阿里云百炼(DashScope)/ 智谱 GLM 等，
  // 只需配置正确的 baseUrl + apiKey + 模型名即可。
  // Anthropic 走独立的 /messages 协议，与 openai-compatible 不兼容，需单独接入（暂未支持）。
  if (config.apiProvider.toLowerCase() === "anthropic") {
    throw new Error(
      "Anthropic 暂未接入：它使用 /messages 协议，与项目的 openai-compatible 通道不兼容。请在设置中选择其他 OpenAI 兼容厂商，或使用 OpenRouter 中转 Claude。"
    );
  }
  const provider = createOpenAICompatible({
    name: config.id,
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  return provider(config.model.id);
}
