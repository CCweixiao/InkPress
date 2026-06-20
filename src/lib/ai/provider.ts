import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * 根据 AI_MODEL 环境变量解析 provider + model。
 * 格式："<provider>:<model>"，如 "anthropic:claude-3-5-sonnet-latest"、"openai:gpt-4o"
 */
export function getModel() {
  const spec = process.env.AI_MODEL ?? "anthropic:claude-3-5-sonnet-latest";
  const [provider, ...modelParts] = spec.split(":");
  const model = modelParts.join(":") || "claude-3-5-sonnet-latest";

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("未配置 ANTHROPIC_API_KEY（在 .env 或设置页填写）");
    }
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic(model);
  }

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("未配置 OPENAI_API_KEY（在 .env 或设置页填写）");
    }
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(model);
  }

  throw new Error(`不支持的 AI provider：${provider}（仅支持 anthropic / openai）`);
}
