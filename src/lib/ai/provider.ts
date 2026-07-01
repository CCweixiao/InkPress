import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { chooseLlmConfig, type SelectedLlmConfig } from "@/lib/ai/llm-config";
import { moduleLogger } from "@/lib/logger";

const log = moduleLogger("ai.provider");

/**
 * 从数据库的「模型配置」加载 LanguageModel（统一走 Anthropic /messages 协议，
 * 覆盖 Anthropic 官方 / 智谱 GLM / OpenRouter 等兼容厂商）。
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
  // 所有厂商统一走 Anthropic /messages 协议：
  // Anthropic 官方 / 智谱 GLM（BigModel）/ OpenRouter 等均提供 Anthropic 兼容端点，
  // 只需配置正确的 baseUrl + apiKey + 模型名即可。
  const provider = createAnthropic({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  });
  return provider(config.model.id);
}
