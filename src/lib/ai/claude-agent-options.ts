import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { CanUseTool, Options } from "@anthropic-ai/claude-agent-sdk";
import { getClaudeAgentConfig } from "@/lib/ai/claude-agent-config";
import { buildInkPressSystemPrompt } from "@/lib/ai/system-prompt";
import { createInkPressMcpServer } from "@/lib/ai/inkpress-mcp-server";
import { listSkills } from "@/lib/ai/skills";
import type { CodeSourceReference } from "@/lib/ai/code-source";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { prisma } from "@/lib/db";
import {
  claudeAllowedTools,
  evaluateToolPermission,
  stripToolPrefix,
} from "@/lib/ai/permission-engine";
import {
  abortApproval,
  registerPendingApproval,
} from "@/lib/ai/pending-approvals";
import { createPrismaSessionStore } from "@/lib/ai/claude-session-store";
import { claudeAgentRuntimeDir } from "@/lib/paths";
import path from "node:path";

export type ClaudeAgentTarget = {
  kind: "article" | "technical-document";
  id: string;
  title: string;
  markdown: string;
  digest?: string;
  documentType?: string;
  snapshotHash?: string;
};

export type BuildClaudeAgentOptionsInput = {
  target: ClaudeAgentTarget;
  sessionId: string;
  /** 仅 propose_technical_document_revision 的 sourceSnapshotJson 用。 */
  codeSource?: CodeSourceReference;
  /** P5：SDK 会话 id，非空时 resume 该会话（跨轮/跨刷新记忆）；空则新会话。 */
  claudeAgentSessionId?: string;
  /** 斜杠命令建议 Claude 优先加载的 Skill；外层不再做 LLM 意图路由。 */
  preferredSkillIds?: string[];
  /** 向 UI 流写 UIMessage chunk（MCP handler 用它发工具卡片）。 */
  emit: (part: never) => void;
};

/** sha256(token)，落 approvalTokenHash（mirror CodeSourceGrant 的 hashToken 约定）。 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** sha256(JSON(input))，落 inputHash 供审计。 */
function hashInput(input: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * P3 权限闸门：SDK 在每个工具执行前回调此函数。
 *
 - allow（已在 allowedTools 里）→ 直接放行（理论上不会进到这里，兜底）。
 - deny → 拒绝。
 - ask → 落一行 pending ToolActionGrant，emit `data-tool-approval` 审批卡，await 进程内
 *   blocking-Promise（pending-approvals）；外部 /api/ai/agent-approvals 决议后唤醒，**同一条
 *   in-flight query 继续**。请求中止（断连/停止）→ reject 并标 grant expired。
 */
function buildCanUseTool(ctx: {
  sessionId: string;
  emit: (part: never) => void;
}): CanUseTool {
  return async (toolName, input, options) => {
    const bareName = stripToolPrefix(toolName);
    const decision = evaluateToolPermission(bareName);
    // SDK 运行时校验 PermissionResult：allow 分支必须带 updatedInput（record），
    // 即使类型标注为可选——缺省 undefined 会被 Zod 拒成 invalid_union。故原样回传 input。
    if (decision === "allow") return { behavior: "allow", updatedInput: input };
    if (decision === "deny")
      return { behavior: "deny", message: `工具 ${bareName} 已被禁用。` };

    const approvalToken = crypto.randomBytes(24).toString("base64url");
    const grant = await prisma.toolActionGrant.create({
      data: {
        sessionId: ctx.sessionId,
        toolName: bareName,
        inputHash: hashInput(input),
        approvalTokenHash: hashToken(approvalToken),
        status: "pending",
      },
    });
    ctx.emit({
      type: "data-tool-approval",
      id: crypto.randomUUID(),
      data: {
        grantId: grant.id,
        toolName: bareName,
        displayName: options.displayName,
        input,
        approvalToken,
      },
    } as never);

    // 请求中止（断连/用户停止）→ 唤醒 await 并标 expired，避免 Promise 永挂。
    const onAbort = () => {
      abortApproval(grant.id);
      void prisma.toolActionGrant
        .update({ where: { id: grant.id }, data: { status: "expired" } })
        .catch(() => undefined);
    };
    if (!options.signal.aborted) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    let userDecision: "allow" | "deny";
    try {
      userDecision = await registerPendingApproval(grant.id, bareName);
    } catch {
      return { behavior: "deny", message: "审批已中止（连接断开）。" };
    } finally {
      options.signal.removeEventListener("abort", onAbort);
    }

    // grant.status 由 POST /api/ai/agent-approvals 写（单一事实源）；此处只据用户决定返回。
    return userDecision === "allow"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "用户拒绝了该操作。" };
  };
}

/**
 * 构造 Claude Agent SDK 的 Options。
 *
 * P1 变化：挂载 InkPress MCP 工具（in-process，handler 闭包持有本次 ctx），
 * 通过 allowedTools 自动批准；tools:[] 仍禁用所有内置工具，只用 MCP 工具。
 *
 * - options.env 整体替换 process.env，必须保留 PATH/HOME 等。
 * - backend（baseUrl/apiKey）从 DB 的 SystemConfig 读取后注入 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN。
 * - settingSources: [] 进入 SDK 隔离模式；persistSession/sessionStore/resume 交给 Claude Agent SDK 管理。
 */
export async function buildClaudeAgentOptions(
  input: BuildClaudeAgentOptionsInput
): Promise<Options> {
  const cfg = await getClaudeAgentConfig();
  if (!cfg.apiKey) {
    throw new Error(
      "Claude Agent 后端未配置 API Key：请在「设置 → 写作 Agent → Claude Agent 后端」填写后保存，再重试。"
    );
  }

  const skillCatalog = await listSkills();
  const agentConfig = await getAgentConfig();
  const mcpServer = createInkPressMcpServer({
    target: input.target,
    sessionId: input.sessionId,
    codeSource: input.codeSource,
    agentConfig,
    skillCatalog,
    emit: input.emit,
  });

  const runtimeDir = claudeAgentRuntimeDir();
  const claudeConfigDir = path.join(runtimeDir, "config");
  const claudeWorkspaceDir = path.join(runtimeDir, "workspace");
  await fs.mkdir(claudeConfigDir, { recursive: true });
  await fs.mkdir(claudeWorkspaceDir, { recursive: true });

  const env: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_BASE_URL: cfg.baseUrl,
    ANTHROPIC_AUTH_TOKEN: cfg.apiKey || undefined,
    ANTHROPIC_API_KEY: undefined,
    CLAUDE_AGENT_SDK_CLIENT_APP: "inkpress/0.3.0",
    // SDK 本地配置/transcript 写到 InkPress 主目录下的隔离目录，不污染用户 ~/.claude。
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };

  return {
    env,
    systemPrompt: buildInkPressSystemPrompt({
      target: input.target,
      skillCatalog,
      preferredSkillIds: input.preferredSkillIds,
      codeSource: input.codeSource,
    }),
    model: cfg.model,
    // 固定 cwd，避免 SDK 默认绑定到 InkPress 开发仓库或用户本地 Claude Code 工作目录。
    cwd: claudeWorkspaceDir,
    includePartialMessages: true,
    mcpServers: { inkpress: mcpServer },
    // allow 工具自动批准；ask 工具（如 set_article_digest）不在此列 → 触发 canUseTool 审批闸门。
    allowedTools: claudeAllowedTools(),
    canUseTool: buildCanUseTool({ sessionId: input.sessionId, emit: input.emit }),
    // 禁用所有内置工具（Read/Edit/Bash/...），只用 InkPress MCP 工具。
    tools: [],
    settingSources: [],
    // P5：持久化 + 镜像到 Prisma SessionStore；resume 让 Claude 跨轮/跨刷新记忆。
    persistSession: true,
    sessionStore: createPrismaSessionStore(),
    ...(input.claudeAgentSessionId
      ? { resume: input.claudeAgentSessionId }
      : {}),
  };
}
