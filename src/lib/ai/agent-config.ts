import { prisma } from "@/lib/db";

export const AGENT_CONFIG_KEY = "inkpress.agent";

export type AgentProjectConfig = {
  id: string;
  name: string;
  root: string;
};

export type AgentConfig = {
  tavilyApiKey: string;
  githubToken?: string;
  projects: AgentProjectConfig[];
  maxSteps: number;
  contextBudgetTokens: number;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  tavilyApiKey: "",
  githubToken: "",
  projects: [],
  maxSteps: 12,
  contextBudgetTokens: 32_000,
};

export function parseAgentConfig(value?: string | null): AgentConfig {
  if (!value) return { ...DEFAULT_AGENT_CONFIG, projects: [] };
  const raw = JSON.parse(value) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("写作 Agent 配置必须是 JSON 对象。");
  }
  const projectsRaw = Array.isArray(raw.projects) ? raw.projects : [];
  const ids = new Set<string>();
  const projects = projectsRaw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`项目配置 ${index + 1} 无效。`);
    }
    const candidate = item as Record<string, unknown>;
    const id = String(candidate.id ?? "").trim();
    const name = String(candidate.name ?? "").trim();
    const root = String(candidate.root ?? "").trim();
    if (!id || !name || !root) {
      throw new Error(`项目配置 ${index + 1} 必须填写 id、name 和 root。`);
    }
    if (ids.has(id)) throw new Error(`项目配置 id 重复：${id}。`);
    ids.add(id);
    return { id, name, root };
  });
  const requestedSteps =
    typeof raw.maxSteps === "number" && Number.isFinite(raw.maxSteps)
      ? Math.round(raw.maxSteps)
      : DEFAULT_AGENT_CONFIG.maxSteps;
  const requestedBudget =
    typeof raw.contextBudgetTokens === "number" &&
    Number.isFinite(raw.contextBudgetTokens)
      ? Math.round(raw.contextBudgetTokens)
      : DEFAULT_AGENT_CONFIG.contextBudgetTokens;
  return {
    tavilyApiKey:
      typeof raw.tavilyApiKey === "string" ? raw.tavilyApiKey.trim() : "",
    githubToken:
      typeof raw.githubToken === "string" ? raw.githubToken.trim() : "",
    projects,
    maxSteps: Math.min(20, Math.max(3, requestedSteps)),
    contextBudgetTokens: Math.min(200_000, Math.max(8_000, requestedBudget)),
  };
}

export async function getAgentConfig(): Promise<AgentConfig> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: AGENT_CONFIG_KEY },
  });
  return parseAgentConfig(row?.value);
}
