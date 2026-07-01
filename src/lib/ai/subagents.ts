import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { MCP_PREFIX } from "@/lib/ai/permission-engine";

/**
 * InkPress 子 agent（P4，基于 Claude Agent SDK 原生 `Options.agents`）。
 *
 * 模型经内置 Agent/Task 工具调起；子 agent 有独立 prompt + tools + context，
 * 内部工具调用历史默认不进主会话（forwardSubagentText:false），只把 finalText 回流。
 * transcript 自动存 ClaudeAgentSessionEntry.subpath（listSubkeys 已闭环）。
 *
 * **tools 只用 allow 只读工具**——避免子 agent 内走 canUseTool 审批（子 agent 审批 UX 留后续）。
 * 设计依据：docs/agent-runtime-pdc.md §6。
 */

const RESEARCH_AGENT_PROMPT = `你是 InkPress 写作 Agent 的调研子 agent。专注深度调研：
- 联网搜索最新资料（web_search）、探索授权项目代码（project_overview / project_search / project_read）、按需加载写作 Skill（load_skill）。
返回**结构化调研发现**：关键事实、来源 URL 或代码位置、可用数据/引文，严格区分事实与推断。
**只返回调研摘要，不要撰写正文**。简洁、有据可查。`;

const REVIEW_AGENT_PROMPT = `你是 InkPress 写作 Agent 的审稿子 agent。审查主 agent 传给你的文章内容或大纲：
- 结合写作 Skill（load_skill）与已上传素材（article_assets）评估。
返回**具体改进建议**：结构问题、风格/语气、证据充分性、配图建议、事实存疑点，按优先级排列。
**只返回建议，不要修改正文**。`;

const FACT_CHECK_AGENT_PROMPT = `你是 InkPress 写作 Agent 的事实核查子 agent。用 web_search 核查主 agent 传给你的具体声明：
返回**逐条验证结果**：每条声明标注（属实 / 存疑 / 错误）+ 来源 URL。
**只返回核查结果，不要撰写正文**。不确定的明确标注，不要臆测。`;

/** 拼接 InkPress MCP 工具完整名。 */
const t = (name: string) => MCP_PREFIX + name;

/**
 * InkPress 声明的子 agent（research / review / fact_check）。
 * tools 只含 allow 只读工具，避免子 agent 内触发审批闸门。
 */
export const INKPRESS_SUBAGENTS: Record<string, AgentDefinition> = {
  research: {
    description:
      "深度调研（联网搜索 + 项目代码探索）。需要收集外部资料或读代码取证时调起。",
    prompt: RESEARCH_AGENT_PROMPT,
    tools: [
      t("web_search"),
      t("project_overview"),
      t("project_search"),
      t("project_read"),
      t("load_skill"),
    ],
  },
  review: {
    description:
      "审稿。审查主 agent 传来的文章内容/大纲，返回改进建议（不改正文）。",
    prompt: REVIEW_AGENT_PROMPT,
    tools: [t("load_skill"), t("article_assets")],
  },
  fact_check: {
    description:
      "事实核查。核查主 agent 传来的具体声明是否属实，返回验证结果 + 来源。",
    prompt: FACT_CHECK_AGENT_PROMPT,
    tools: [t("web_search")],
  },
};

/** 供 buildClaudeAgentOptions 注入 Options.agents。 */
export function buildSubagents(): Record<string, AgentDefinition> {
  return INKPRESS_SUBAGENTS;
}
