export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200_000;
export const MIN_MODEL_CONTEXT_WINDOW_TOKENS = 8_000;
export const MAX_MODEL_CONTEXT_WINDOW_TOKENS = 1_000_000;

const MODEL_CONTEXT_WINDOW_OVERRIDES: Record<string, number> = {
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-fable-5": 1_000_000,
  "claude-mythos-5": 1_000_000,
  "claude-mythos-preview": 1_000_000,
  "claude-sonnet-4-5": 200_000,
  "claude-haiku-4-5": 200_000,
  "glm-4.6": 200_000,
  "glm-4.5": 128_000,
  "kimi-k2.7-code-highspeed": 262_144,
  "kimi-k2.7-code": 262_144,
  "kimi-k2.6": 262_144,
  "minimax-m3": 1_000_000,
};

function normalizeModelId(modelId: string) {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/^anthropic\//, "")
    .replace(/^z-ai\//, "")
    .replace(/^zai\//, "")
    .replace(/^moonshotai\//, "")
    .replace(/^minimax\//, "");
}

export function clampModelContextWindowTokens(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  return Math.min(
    MAX_MODEL_CONTEXT_WINDOW_TOKENS,
    Math.max(MIN_MODEL_CONTEXT_WINDOW_TOKENS, Math.round(value))
  );
}

export function defaultContextWindowTokensForModel(modelId: string) {
  const normalized = normalizeModelId(modelId);
  const exact = MODEL_CONTEXT_WINDOW_OVERRIDES[normalized];
  if (exact) return exact;

  if (normalized.includes("minimax-m3")) return 1_000_000;
  if (normalized.includes("kimi-k2.7") || normalized.includes("kimi-k2.6")) {
    return 262_144;
  }
  if (normalized.includes("glm-4.6")) return 200_000;
  if (normalized.includes("glm-4.5")) return 128_000;
  if (
    normalized.includes("claude-sonnet-4-6") ||
    normalized.includes("claude-opus-4-") ||
    normalized.includes("claude-sonnet-5") ||
    normalized.includes("claude-fable-5") ||
    normalized.includes("claude-mythos")
  ) {
    return 1_000_000;
  }
  if (normalized.includes("claude")) return 200_000;

  return DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}

export function deriveAgentContextBudgetTokens(contextWindowTokens: number) {
  const safeWindow = clampModelContextWindowTokens(contextWindowTokens);
  if (safeWindow <= 32_000) return Math.max(8_000, Math.floor(safeWindow * 0.65));
  if (safeWindow <= 200_000) return Math.floor(safeWindow * 0.7);
  return Math.floor(safeWindow * 0.75);
}
