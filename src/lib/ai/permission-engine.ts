/**
 * InkPress 权限引擎（A+ 服务端权威 checkpoint 风格，呼应 [[permission-system-design]]）。
 *
 * 策略数据来自 registry 的 `permission` 字段（单一事实源，呼应
 * [[declarative-registry-over-hardcode]]）。本引擎把 ALLOW/DENY/ASK 三态映射成 SDK 的三根旋钮：
 * - allow → 进入 `allowedTools`（自动批准，不触发 canUseTool）
 * - ask   → 不进 allowedTools，触发 canUseTool，由 buildCanUseTool 弹审批卡并 await
 * - deny  → 进入 `disallowedTools`（模型上下文里直接移除）
 *
 * web_fetch 是特例：即便用户开启全局自动放权，也仍不进入 allowedTools，
 * 统一经过 canUseTool 做动态白名单/自动放行提示，执行层再做 SSRF 守卫。
 *
 * 未知工具默认 ask（最小信任：未显式 allow 的工具一律需审批）。
 */
import { INKPRESS_TOOLS } from "@/lib/ai/tools/registry";

export type PermissionDecision = "allow" | "ask" | "deny";

/** SDK MCP 工具完整名前缀。 */
export const MCP_PREFIX = "mcp__inkpress__";

/** 模型看到的是 mcp__inkpress__<name>；此处还原裸名用于匹配 registry。 */
export function stripToolPrefix(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name;
}

const DECISION_BY_NAME: ReadonlyMap<string, PermissionDecision> = new Map(
  INKPRESS_TOOLS.map((t) => [t.name, t.permission])
);

/** 评估单个工具的静态权限决策。未知工具默认 ask。 */
export function evaluateToolPermission(bareName: string): PermissionDecision {
  return DECISION_BY_NAME.get(bareName) ?? "ask";
}

/** allow 工具的完整名（喂 SDK allowedTools，自动批准、不触发 canUseTool）。 */
export function claudeAllowedTools(enabledNames?: ReadonlySet<string>): string[] {
  return INKPRESS_TOOLS.filter(
    (t) => t.permission === "allow" && (!enabledNames || enabledNames.has(t.name))
  ).map(
    (t) => MCP_PREFIX + t.name
  );
}

/** deny 工具的完整名（喂 SDK disallowedTools，模型上下文里直接移除）。本期为空。 */
export function claudeDisallowedTools(): string[] {
  return INKPRESS_TOOLS.filter((t) => t.permission === "deny").map(
    (t) => MCP_PREFIX + t.name
  );
}
