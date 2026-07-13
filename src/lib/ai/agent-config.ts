import { prisma } from "@/lib/db";
import { decryptConfigValueForUse } from "@/lib/config-secrets";

export const AGENT_CONFIG_KEY = "inkpress.agent";
export const AGENT_CONFIG_VERSION = 3;
const LEGACY_AGENT_DEFAULT_STEPS = new Set([12, 30]);

export type AgentProjectConfig = {
  id: string;
  name: string;
  root: string;
};

export type AgentConfig = {
  tavilyApiKey: string;
  /** 兼容旧配置字段；新版本不再暴露或使用长期信任项目。 */
  projects: AgentProjectConfig[];
  /** SDK maxTurns：单轮工具往返/Agent 步数上限。 */
  maxSteps: number;
  /** 应用层整轮兜底超时。 */
  runtimeTimeoutSeconds: number;
  /** 底层 Claude API 单次请求超时。 */
  apiTimeoutSeconds: number;
  /** 底层 Claude API 最大重试次数。 */
  apiMaxRetries: number;
  /** 后台/异步子 Agent 无流事件卡住检测。 */
  asyncAgentStallTimeoutSeconds: number;
  /** 流响应 body 空闲超时。 */
  streamIdleTimeoutSeconds: number;
};

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  tavilyApiKey: "",
  projects: [],
  maxSteps: 1000,
  runtimeTimeoutSeconds: 30 * 60,
  apiTimeoutSeconds: 15 * 60,
  apiMaxRetries: 12,
  asyncAgentStallTimeoutSeconds: 15 * 60,
  streamIdleTimeoutSeconds: 5 * 60,
};

function numberFromRaw(
  raw: Record<string, unknown>,
  key: string,
  fallback: number,
  options: { integer?: boolean } = {}
) {
  const value = raw[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return options.integer ? Math.round(parsed) : parsed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseAgentConfig(value?: string | null): AgentConfig {
  if (!value) return { ...DEFAULT_AGENT_CONFIG, projects: [] };
  const raw = JSON.parse(value) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("写作 Agent 配置必须是 JSON 对象。");
  }
  const requestedSteps = numberFromRaw(raw, "maxSteps", DEFAULT_AGENT_CONFIG.maxSteps, {
    integer: true,
  });
  const requestedRuntimeTimeoutSeconds = numberFromRaw(
    raw,
    "runtimeTimeoutSeconds",
    DEFAULT_AGENT_CONFIG.runtimeTimeoutSeconds,
    { integer: true }
  );
  const requestedApiTimeoutSeconds = numberFromRaw(
    raw,
    "apiTimeoutSeconds",
    DEFAULT_AGENT_CONFIG.apiTimeoutSeconds,
    { integer: true }
  );
  const requestedApiMaxRetries = numberFromRaw(
    raw,
    "apiMaxRetries",
    DEFAULT_AGENT_CONFIG.apiMaxRetries,
    { integer: true }
  );
  const requestedAsyncAgentStallTimeoutSeconds = numberFromRaw(
    raw,
    "asyncAgentStallTimeoutSeconds",
    DEFAULT_AGENT_CONFIG.asyncAgentStallTimeoutSeconds,
    { integer: true }
  );
  const requestedStreamIdleTimeoutSeconds = numberFromRaw(
    raw,
    "streamIdleTimeoutSeconds",
    DEFAULT_AGENT_CONFIG.streamIdleTimeoutSeconds,
    { integer: true }
  );
  const isLegacyConfig = raw.configVersion !== AGENT_CONFIG_VERSION;
  const upgradedSteps =
    isLegacyConfig && LEGACY_AGENT_DEFAULT_STEPS.has(requestedSteps)
      ? DEFAULT_AGENT_CONFIG.maxSteps
      : requestedSteps;
  return {
    tavilyApiKey:
      typeof raw.tavilyApiKey === "string" ? raw.tavilyApiKey.trim() : "",
    projects: [],
    maxSteps: clamp(upgradedSteps, 3, 1000),
    runtimeTimeoutSeconds: clamp(requestedRuntimeTimeoutSeconds, 30, 60 * 60),
    apiTimeoutSeconds: clamp(requestedApiTimeoutSeconds, 30, 60 * 60),
    apiMaxRetries: clamp(requestedApiMaxRetries, 0, 15),
    asyncAgentStallTimeoutSeconds: clamp(
      requestedAsyncAgentStallTimeoutSeconds,
      30,
      60 * 60
    ),
    streamIdleTimeoutSeconds: clamp(requestedStreamIdleTimeoutSeconds, 300, 60 * 60),
  };
}

export async function getAgentConfig(): Promise<AgentConfig> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: AGENT_CONFIG_KEY },
  });
  return parseAgentConfig(decryptConfigValueForUse(AGENT_CONFIG_KEY, row?.value));
}
