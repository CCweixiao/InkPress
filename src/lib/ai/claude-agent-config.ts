import { prisma } from "@/lib/db";

/**
 * Claude Agent Runtime 相关配置。
 *
 * 设计依据：docs/agent-engines.md。
 * Claude Agent SDK（@anthropic-ai/claude-agent-sdk）起原生子进程，靠环境变量
 * ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN 选择后端。InkPress 约定密钥进 DB
 * （SystemConfig）而非 env，因此 runtime 会读取本配置后注入到子进程 env。
 *
 * 默认指向智谱 BigModel 的 Anthropic 兼容端点（用户选择「试连 GLM」），
 * 也可改为官方 Anthropic / Bedrock / Vertex 兼容配置。
 */

export const CLAUDE_AGENT_CONFIG_KEY = "inkpress.claude-agent";

export type ClaudeAgentConfig = {
  /** Anthropic 兼容端点地址。 */
  baseUrl: string;
  /** 端点鉴权 token（BigModel 的 API Key）。 */
  apiKey: string;
  /** 请求使用的模型 id（透传给 SDK options.model）。 */
  model: string;
};

export const DEFAULT_CLAUDE_AGENT_CONFIG: ClaudeAgentConfig = {
  baseUrl: "https://open.bigmodel.cn/api/anthropic",
  apiKey: "",
  model: "glm-4.6",
};

export function parseClaudeAgentConfig(value?: string | null): ClaudeAgentConfig {
  if (!value) return { ...DEFAULT_CLAUDE_AGENT_CONFIG };
  const raw = JSON.parse(value) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Claude Agent 配置必须是 JSON 对象。");
  }
  const cfg = raw as Record<string, unknown>;
  return {
    baseUrl:
      typeof cfg.baseUrl === "string" && cfg.baseUrl.trim()
        ? cfg.baseUrl.trim()
        : DEFAULT_CLAUDE_AGENT_CONFIG.baseUrl,
    apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "",
    model:
      typeof cfg.model === "string" && cfg.model.trim()
        ? cfg.model.trim()
        : DEFAULT_CLAUDE_AGENT_CONFIG.model,
  };
}

export async function getClaudeAgentConfig(): Promise<ClaudeAgentConfig> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: CLAUDE_AGENT_CONFIG_KEY },
  });
  return parseClaudeAgentConfig(row?.value);
}
