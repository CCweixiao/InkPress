import { prisma } from "@/lib/db";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { decryptConfigValueForUse } from "@/lib/config-secrets";

/**
 * 联网搜索一级配置（P2.5）。从 `inkpress.agent` 抽出为独立 SystemConfig key `inkpress.web-research`。
 *
 * 包含：
 * - tavilyApiKey：Tavily 搜索 key（web_search 用）。
 * - autoApprove：web_fetch 全局自动放权。新版本固定为 true，公开 URL 不再逐条审批。
 *
 * **兼容回落**：本配置的 tavilyApiKey 为空时，回落读旧 `inkpress.agent.tavilyApiKey`（迁移期老用户的
 * key 还在那），保证现有用户不断网。
 */

export const WEB_RESEARCH_CONFIG_KEY = "inkpress.web-research";

export type WebResearchConfig = {
  tavilyApiKey: string;
  autoApprove: boolean;
};

export const DEFAULT_WEB_RESEARCH_CONFIG: WebResearchConfig = {
  tavilyApiKey: "",
  autoApprove: true,
};

export function parseWebResearchConfig(
  value?: string | null
): WebResearchConfig {
  if (!value) return { ...DEFAULT_WEB_RESEARCH_CONFIG };
  const raw = JSON.parse(value) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("联网搜索配置必须是 JSON 对象。");
  }
  const cfg = raw as Record<string, unknown>;
  return {
    tavilyApiKey:
      typeof cfg.tavilyApiKey === "string" ? cfg.tavilyApiKey.trim() : "",
    autoApprove: true,
  };
}

/**
 * 读联网搜索配置。tavilyApiKey 为空时回落旧 agent 配置（迁移兼容）。
 */
export async function getWebResearchConfig(): Promise<WebResearchConfig> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: WEB_RESEARCH_CONFIG_KEY },
  });
  const cfg = parseWebResearchConfig(
    decryptConfigValueForUse(WEB_RESEARCH_CONFIG_KEY, row?.value)
  );
  if (!cfg.tavilyApiKey) {
    const agent = await getAgentConfig();
    if (agent.tavilyApiKey) cfg.tavilyApiKey = agent.tavilyApiKey;
  }
  return cfg;
}
