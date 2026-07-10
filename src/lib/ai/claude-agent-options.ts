import crypto from "node:crypto";
import fs from "node:fs/promises";
import type {
  CanUseTool,
  Options,
  PostCompactHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { chooseLlmConfig } from "@/lib/ai/llm-config";
import { buildInkPressSystemPrompt, SNIPPET_FUSION_HINT } from "@/lib/ai/system-prompt";
import { buildSubagents } from "@/lib/ai/subagents";
import { createInkPressMcpServer } from "@/lib/ai/inkpress-mcp-server";
import { listSkills } from "@/lib/ai/skills";
import type { CodeSourceReference } from "@/lib/ai/code-source";
import { getAgentConfig } from "@/lib/ai/agent-config";
import { getWebResearchConfig } from "@/lib/ai/web-research-config";
import { isDomainAllowed, normalizeDomain } from "@/lib/ai/web-allowlist";
import { assessWebUrlRisk } from "@/lib/ai/web-url-risk";
import { prisma } from "@/lib/db";
import {
  claudeAllowedTools,
  evaluateToolPermission,
  stripToolPrefix,
} from "@/lib/ai/permission-engine";
import {
  PENDING_APPROVAL_TTL_MS,
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
  /** P3 文章类型 profile id（article 时影响 prompt 引导 + 默认 skill）。 */
  profileId?: string;
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
  /** 聊天框选择的供应商 id（动态注入到 SDK env）。 */
  providerId?: string | null;
  /** 聊天框选择的模型 id。 */
  modelId?: string | null;
  /** 向 UI 流写 UIMessage chunk（MCP handler 用它发工具卡片）。 */
  emit: (part: never) => void;
  /** P1：本轮最后一条 user 消息文本（runtime 侧 lastUserText），用于检测 {{snippet:}} 引用。 */
  lastUserText?: string;
};

type InkPressClaudeAgentOptions = Options & {
  maxTurns?: number;
  maxBudgetUsd?: number;
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
  autoApprove: boolean;
}): CanUseTool {
  return async (toolName, input, options) => {
    const bareName = stripToolPrefix(toolName);
    const decision = evaluateToolPermission(bareName);
    // SDK 运行时校验 PermissionResult：allow 分支必须带 updatedInput（record），
    // 即使类型标注为可选——缺省 undefined 会被 Zod 拒成 invalid_union。故原样回传 input。
    if (decision === "allow") return { behavior: "allow", updatedInput: input };
    if (decision === "deny")
      return { behavior: "deny", message: `工具 ${bareName} 已被禁用。` };

    // P2.5：web_fetch 域名白名单 / 自动放权短路——命中则不弹审批卡，并 emit 提示 step
    // （前端 AgentStepBlock 免费渲染，让用户知道这次为何没问）。
    let webFetchUrl = "";
    let webFetchRisk: ReturnType<typeof assessWebUrlRisk> | null = null;
    if (
      bareName === "web_fetch" &&
      typeof (input as Record<string, unknown> | null)?.url === "string"
    ) {
      webFetchUrl = String((input as Record<string, unknown>).url);
      webFetchRisk = assessWebUrlRisk(webFetchUrl);
      const domain = normalizeDomain(
        String((input as Record<string, unknown>).url)
      );
      if (ctx.autoApprove) {
        ctx.emit({
          type: "data-agent-step",
          id: crypto.randomUUID(),
          data: {
            kind: "intent",
            title: "已自动放权联网抓取",
            detail: domain
              ? `直接读取 ${domain}（已开启自动放权）`
              : "已开启自动放权",
            status: "completed",
          },
        } as never);
        return { behavior: "allow", updatedInput: input };
      }
      if (domain && (await isDomainAllowed(domain))) {
        ctx.emit({
          type: "data-agent-step",
          id: crypto.randomUUID(),
          data: {
            kind: "intent",
            title: "白名单自动放行",
            detail: `${domain} 在信任域名白名单中`,
            status: "completed",
          },
        } as never);
        return { behavior: "allow", updatedInput: input };
      }
    }

    const approvalToken = crypto.randomBytes(24).toString("base64url");
    const grant = await prisma.toolActionGrant.create({
      data: {
        sessionId: ctx.sessionId,
        toolName: bareName,
        inputHash: hashInput(input),
        approvalTokenHash: hashToken(approvalToken),
        decisionJson: JSON.stringify({
          input,
          riskAssessment: webFetchRisk,
          approvalKind: bareName === "web_fetch" ? "external_network" : "tool",
        }),
        status: "pending",
      },
    });
    const pendingBatchCount =
      bareName === "web_fetch"
        ? await prisma.toolActionGrant.count({
            where: {
              sessionId: ctx.sessionId,
              toolName: "web_fetch",
              status: "pending",
            },
          })
        : 1;
    ctx.emit({
      type: "data-tool-approval",
      id: crypto.randomUUID(),
      data: {
        grantId: grant.id,
        toolName: bareName,
        displayName: options.displayName,
        input,
        url: webFetchUrl || undefined,
        domain: webFetchRisk?.domain,
        riskAssessment: webFetchRisk,
        batch: {
          enabled: bareName === "web_fetch",
          pendingCount: pendingBatchCount,
          scope: "session:web_fetch",
        },
        approvalToken,
      },
    } as never);

    const expireGrant = async () => {
      await prisma.toolActionGrant
        .update({
          where: { id: grant.id },
          data: { status: "expired", approvalTokenHash: null },
        })
        .catch(() => undefined);
    };

    const userDecision = await registerPendingApproval(grant.id, bareName, {
      signal: options.signal,
      timeoutMs: PENDING_APPROVAL_TTL_MS,
      onExpire: expireGrant,
    });

    if (userDecision === "deny" && options.signal.aborted) {
      await expireGrant();
      return { behavior: "deny", message: "审批已过期或连接已断开，请重新发送。" };
    }

    if (userDecision === "deny") {
      const latest = await prisma.toolActionGrant
        .findUnique({ where: { id: grant.id }, select: { status: true } })
        .catch(() => null);
      if (latest?.status === "expired") {
        return { behavior: "deny", message: "审批已过期，请重新发送。" };
      }
    }

    // grant.status 由 POST /api/ai/agent-approvals 写（单一事实源）；此处只据用户决定返回。
    return userDecision === "allow"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "用户拒绝了该操作。" };
  };
}

function buildCompactHooks(ctx: { sessionId: string }): Options["hooks"] {
  return {
    PostCompact: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostCompact") {
              return {};
            }
            const compact = input as PostCompactHookInput;
            const summary = compact.compact_summary.trim();
            if (summary) {
              await prisma.agentChatSession
                .update({
                  where: { id: ctx.sessionId },
                  data: {
                    summary,
                    summaryUpToPosition: -1,
                    claudeAgentLastEventAt: new Date(),
                  },
                })
                .catch(() => undefined);
            }
            return {};
          },
        ],
      },
    ],
  };
}

/**
 * 构造 Claude Agent SDK 的 Options。
 *
 * P1 变化：挂载 InkPress MCP 工具（in-process，handler 闭包持有本次 ctx），
 * 通过 allowedTools 自动批准；内置工具只开放 Agent，用于 SDK 原生子 agent 委派。
 *
 * - options.env 整体替换 process.env，必须保留 PATH/HOME 等。
 * - backend（baseUrl/apiKey）从 DB 的 SystemConfig 读取后注入 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN。
 * - settingSources: [] 进入 SDK 隔离模式；persistSession/sessionStore/resume 交给 Claude Agent SDK 管理。
 */
export async function buildClaudeAgentOptions(
  input: BuildClaudeAgentOptionsInput
): Promise<InkPressClaudeAgentOptions> {
  const selected = await chooseLlmConfig(input.providerId, input.modelId);
  if (!selected || !selected.apiKey) {
    throw new Error(
      "未配置 AI 模型：请在「设置 → 系统配置 → AI 模型」中添加至少一个 Anthropic 兼容供应商并填入 API Key。"
    );
  }

  const skillCatalog = await listSkills();
  const agentConfig = await getAgentConfig();
  const webResearch = await getWebResearchConfig();
  const mcpServer = createInkPressMcpServer({
    target: input.target,
    sessionId: input.sessionId,
    codeSource: input.codeSource,
    agentConfig,
    webResearch,
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
    ANTHROPIC_BASE_URL: selected.baseUrl,
    ANTHROPIC_AUTH_TOKEN: selected.apiKey || undefined,
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
      tavilyApiKey: webResearch.tavilyApiKey,
      snippetsHint: input.lastUserText?.includes("{{snippet:")
        ? SNIPPET_FUSION_HINT
        : undefined,
    }),
    model: selected.model.id,
    maxTurns: agentConfig.maxSteps,
    maxBudgetUsd: agentConfig.maxBudgetUsd,
    // 固定 cwd，避免 SDK 默认绑定到 InkPress 开发仓库或用户本地 Claude Code 工作目录。
    cwd: claudeWorkspaceDir,
    includePartialMessages: true,
    mcpServers: { inkpress: mcpServer },
    // P4：声明的子 agent（research/review/fact_check），模型经内置 Agent 工具调起；
    // forwardSubagentText:false → 子任务内部历史不进主会话，只回 finalText。
    agents: buildSubagents(),
    forwardSubagentText: false,
    agentProgressSummaries: true,
    // allow 工具自动批准；web_fetch 即便全局 autoApprove 也不进 allowedTools，
    // 统一走 canUseTool 以保留自动放行提示、白名单判断和未来审计入口。
    allowedTools: [...claudeAllowedTools(), "Agent"],
    canUseTool: buildCanUseTool({
      sessionId: input.sessionId,
      emit: input.emit,
      autoApprove: webResearch.autoApprove,
    }),
    hooks: buildCompactHooks({ sessionId: input.sessionId }),
    // 只启用 SDK 内置 Agent 工具来调起子 agent；Read/Edit/Bash/WebFetch 等内置工具仍不暴露。
    tools: ["Agent"],
    settingSources: [],
    // P5：持久化 + 镜像到 Prisma SessionStore；resume 让 Claude 跨轮/跨刷新记忆。
    persistSession: true,
    sessionStore: createPrismaSessionStore(),
    ...(input.claudeAgentSessionId
      ? { resume: input.claudeAgentSessionId }
      : {}),
  };
}
