import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type {
  AgentConfig,
  AgentProjectConfig,
} from "@/lib/ai/agent-config";
import type { SkillCatalogItem } from "@/lib/ai/skills";
import {
  buildCandidateFromLocator,
  extractCodeSourceCandidate,
  type CodeSourceCandidate,
  type CodeSourceReference,
} from "@/lib/ai/code-source";
import { moduleLogger } from "@/lib/logger";
import { classifyError } from "@/lib/ai/error-classify";

const log = moduleLogger("ai.router");

export const agentIntentSchema = z.enum([
  "question",
  "create-article",
  "polish",
  "review",
  "research",
  "project-explore",
  "write-technical-doc",
  "project-to-article",
  "project-change-analysis",
  "write-change-document",
  "change-to-article",
  "summarize",
  "out-of-scope",
]);
export type AgentIntent = z.infer<typeof agentIntentSchema>;

// schema 宽松：intent 接收任意字符串（后处理归一化），其余字段 .catch 兜底，
// 避免 LLM 返回的结构化对象因严格 zod 校验（enum/类型/缺字段）被判 "did not match schema"。
const routeSchema = z.object({
  intent: z.string(),
  skillIds: z.array(z.string()).max(4).catch([]),
  needsWeb: z.boolean().catch(false),
  needsAssets: z.boolean().catch(false),
  needsProject: z.boolean().catch(false),
  needsGitHistory: z.boolean().catch(false),
  needsProposal: z.boolean().catch(false),
  projectId: z.string().nullable().catch(null),
  projectLocator: z.string().nullable().catch(null),
  rationale: z.string().catch(""),
});

export type AgentRoute = z.infer<typeof routeSchema> & {
  project?: AgentProjectConfig;
  codeSourceCandidate?: CodeSourceCandidate;
  codeSource?: CodeSourceReference;
  ambiguityQuestion?: string;
  activeTools: string[];
};

// 动作性黑名单：仅作为 LLM 不可用时的兜底拒绝规则。关键词强制带「动词 + 受控对象」组合，
// 避免误伤「写一篇关于支付/重构的文章」这类合法写作需求（写作类意图优先级高于本黑名单）。
const OUT_OF_SCOPE_PATTERN =
  /(支付|转账|汇款|退款|提现)(?:给|到|至|一笔|订单)?|(?:修改|改动|更新|编写|开发|实现|重构|删除|清理|清空|执行|运行|部署|发布)(?:代码|源码|程序|脚本|SQL|命令|数据库|表|记录|数据|文件|配置|依赖|包)|(?:执行|跑|运行|启动)\s*(?:SQL|脚本|命令|迁移|migration)|(?:drop\s+table|drop\s+database|truncate)|(?:查库|查询数据库|导出数据|导出报表|跑报表|拉数据)|(?:重启|关机|停服|kill|杀进程|改密码|重置密码)|(?:发短信|发邮件|推送通知|群发|批量发送)/i;

/**
 * 意图路由的声明式注册表（吸收 opencode 数据驱动分发的理念）。
 * 关键词正则集中到 computeContext，意图判定集中到 INTENT_RULES（数组顺序即优先级），
 * 能力需求集中到 deriveNeeds。加一个 intent = 加一条 INTENT_RULES，无需改 switch/三元链。
 */
type IntentContext = {
  text: string;
  isProject: boolean;
  isGitHistory: boolean;
  isArticle: boolean;
  isTechnicalDoc: boolean;
  isResearch: boolean;
  isReview: boolean;
  isPolish: boolean;
  isSummarize: boolean;
  isCreate: boolean;
};

function computeContext(message: string): IntentContext {
  const text = message.toLowerCase();
  return {
    text,
    isProject:
      /项目|代码|源码|仓库|repo|repository|模块|架构|调用链|调用栈/.test(text),
    isGitHistory:
      /git\s*(?:diff|log)|commit|提交(?:记录|历史)?|版本区间|更新日志|变更记录|release\s*note|pr\b|v?\d+(?:\.\d+)+\s*(?:到|至|~|～|→|\.\.)\s*v?\d+(?:\.\d+)+/i.test(
        text
      ),
    isArticle: /公众号|文章|博客|写成文章|技术文章|功能介绍|版本复盘/.test(text),
    isTechnicalDoc:
      /(技术文档|架构文档|调用链文档|模块文档|依赖分析文档|实现说明)/.test(text),
    isResearch: /搜索|查找|联网|资料|最新|事实|调研|来源/.test(text),
    isReview: /审校|校对|检查|错别字|逻辑问题|事实核查/.test(text),
    isPolish:
      /润色|改写|优化|精简|扩写|调整文章|修改文章|去\s*ai\s*味|去除ai|机器味|机器人味|像真人|人味/.test(
        text
      ),
    isSummarize:
      /总结|摘要|概括|提炼|要点|归纳|梗概|digest|小结|tldr|tl;?dr/i.test(text),
    isCreate: /写一篇|生成文章|创作|撰写|写成文章/.test(text),
  };
}

type IntentRule = {
  intent: AgentIntent;
  when: (ctx: IntentContext) => boolean;
  skills: string[];
};

// 顺序即优先级（等价原 fallbackRoute 三元链从高到低）。
const INTENT_RULES: IntentRule[] = [
  {
    intent: "change-to-article",
    when: (c) => c.isGitHistory && c.isArticle,
    skills: ["code-change-analysis", "project-to-article", "wechat-writing"],
  },
  {
    intent: "write-change-document",
    when: (c) => c.isGitHistory && c.isTechnicalDoc,
    skills: ["code-change-analysis", "technical-documentation"],
  },
  {
    intent: "project-change-analysis",
    when: (c) => c.isGitHistory,
    skills: ["code-change-analysis"],
  },
  {
    intent: "project-to-article",
    when: (c) => c.isProject && c.isArticle,
    skills: ["codebase-exploration", "project-to-article", "wechat-writing"],
  },
  {
    intent: "write-technical-doc",
    when: (c) => c.isTechnicalDoc,
    skills: ["codebase-exploration", "technical-documentation"],
  },
  {
    intent: "project-explore",
    when: (c) => c.isProject,
    skills: ["codebase-exploration"],
  },
  { intent: "review", when: (c) => c.isReview, skills: ["editorial-review"] },
  { intent: "polish", when: (c) => c.isPolish, skills: ["de-ai-writing"] },
  { intent: "research", when: (c) => c.isResearch, skills: ["web-research"] },
  { intent: "summarize", when: (c) => c.isSummarize, skills: ["article-summary"] },
  { intent: "create-article", when: (c) => c.isCreate, skills: ["wechat-writing"] },
  {
    intent: "out-of-scope",
    when: (c) => OUT_OF_SCOPE_PATTERN.test(c.text),
    skills: [],
  },
];

function deriveNeeds(ctx: IntentContext) {
  const needsProposal =
    ctx.isCreate ||
    ctx.isPolish ||
    ctx.isTechnicalDoc ||
    (ctx.isProject && ctx.isArticle) ||
    (ctx.isGitHistory && ctx.isTechnicalDoc) ||
    (ctx.isGitHistory && ctx.isArticle) ||
    /修改|重写|写成|生成文章|撰写/.test(ctx.text);
  return {
    needsWeb: ctx.isResearch,
    needsAssets: ctx.isCreate || ctx.isPolish || needsProposal,
    needsProject: ctx.isProject || ctx.isTechnicalDoc || ctx.isGitHistory,
    needsGitHistory: ctx.isGitHistory,
    needsProposal,
  };
}

function fallbackRoute(message: string): z.infer<typeof routeSchema> {
  const ctx = computeContext(message);
  const matched = INTENT_RULES.find((rule) => rule.when(ctx));
  const intent: AgentIntent = matched?.intent ?? "question";
  return {
    intent,
    skillIds: [],
    ...deriveNeeds(ctx),
    projectId: null,
    projectLocator: null,
    rationale: "使用规则路由完成意图识别。",
  };
}

function matchProjectFromText(
  message: string,
  projects: AgentProjectConfig[]
) {
  const lower = message.toLowerCase();
  return projects.filter((project) => {
    const basename = project.root.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
    return [project.id, project.name, basename].some(
      (value) => value && lower.includes(value.toLowerCase())
    );
  });
}

function defaultSkillsForIntent(intent: string): string[] {
  return INTENT_RULES.find((rule) => rule.intent === intent)?.skills ?? [];
}

export async function routeAgentRequest(input: {
  model: LanguageModel;
  message: string;
  skills: SkillCatalogItem[];
  config: AgentConfig;
  previousProjectId?: string | null;
  targetKind?: "article" | "technical-document";
}): Promise<AgentRoute> {
  const skillCatalog = input.skills
    .map((skill) => `${skill.id} | ${skill.skillKey} | ${skill.description}`)
    .join("\n");
  const projectCatalog = input.config.projects
    .map((project) => `${project.id} | ${project.name} | ${project.root}`)
    .join("\n");

  let routed: z.infer<typeof routeSchema>;
  let llmRouted = true;
  let routeErrorReason = "";
  try {
    const result = await generateObject({
      model: input.model,
      schema: routeSchema,
      system: `你是写作 Agent 的轻量意图路由器，只做任务分类和能力选择。
不得回答用户问题。只选择确实需要的 Skill 与工具。
项目只有在用户明确要求分析本地项目、源码、模块或仓库时才需要。
提交历史、Git Diff、版本更新和 PR 分析必须设置 needsGitHistory。
创作、扩写、润色需要扫描文章素材；普通问答和纯审校不强制扫描。
只有用户要求创建或修改文章正文时才启用文章提案。
技术文档与公众号文章是不同目标：代码证据整理成内部文档属于 write-technical-doc；面向公众号读者写文章属于 project-to-article。

【能力范围（仅支持以下方向）】
- 公众号/技术文章的创作、扩写、润色、审校、改写
- 为已有文章生成摘要、要点清单或 TL;DR（intent=summarize）：压缩已有正文，不创建或修改正文，不调用文章提案工具
- 围绕代码项目做只读分析（架构、调用链、模块说明），整理成技术文档或公众号文章
- Git 提交/Diff/版本区间的只读变更分析，整理成变更文档或文章
- 联网搜索与资料调研，辅助写作

【拒绝策略】
当用户请求明显超出上述能力范围时（例如：修改/编写源代码、执行命令、支付/转账/退款、操作数据库增删改、发短信邮件、系统运维、查库导出报表、破解/攻击），必须返回 intent="out-of-scope"，并在 rationale 中用中文说明为何拒绝、引导用户回到支持的能力。注意：用户请求「写一篇关于支付/重构/某技术的文章」属于合法写作需求，不得拒绝。

【代码源定位 projectLocator】
若用户消息包含明确的本地绝对路径（如 /Users/.../ProjectName）或 GitHub 仓库地址（https://github.com/owner/repo），将其原样填入 projectLocator 字段（去掉前后空白和标点）。若用户未提及任何代码源，projectLocator 填 null。

可用 Skill：
${skillCatalog || "（无）"}

长期信任项目：
${projectCatalog || "（无）"}`,
      prompt: input.message,
      temperature: 0,
      maxRetries: 1,
    });
    routed = result.object;
  } catch (err) {
    llmRouted = false;
    routeErrorReason = classifyError(err).label;
    log.warn(
      { err, routeErrorReason },
      "意图路由 LLM 失败，回退到规则路由"
    );
    routed = fallbackRoute(input.message);
  }
  const deterministic = fallbackRoute(input.message);
  // 决策 A：LLM 优先。但 LLM 返回的 intent 必须是合法枚举值，否则回落规则；
  // needs* 永远取「规则 ∪ LLM」并集（能力只多不少）。
  const validIntents = new Set<string>(agentIntentSchema.options);
  const llmIntentOk = llmRouted && validIntents.has(routed.intent);
  const finalIntent: AgentIntent = llmIntentOk
    ? (routed.intent as AgentIntent)
    : (deterministic.intent as AgentIntent);
  routed = {
    ...routed,
    intent: finalIntent,
    needsWeb: routed.needsWeb || deterministic.needsWeb,
    needsAssets: routed.needsAssets || deterministic.needsAssets,
    needsProject: routed.needsProject || deterministic.needsProject,
    needsGitHistory: routed.needsGitHistory || deterministic.needsGitHistory,
    needsProposal: routed.needsProposal || deterministic.needsProposal,
    rationale: llmIntentOk
      ? routed.rationale
      : routeErrorReason
        ? `${routed.rationale}；LLM 不可用（${routeErrorReason}），已用规则路由。`
        : `${routed.rationale}；LLM 返回的意图不在支持范围，已用规则路由。`,
  };

  // 优先级：正则识别 > LLM projectLocator > 已配置项目兜底。
  // 正则会漏掉中文紧贴的路径（LOCAL_PATH_PATTERN 前导白名单不含 CJK），LLM projectLocator 兜底。
  let codeSourceCandidate = extractCodeSourceCandidate(
    input.message,
    input.config.projects
  );
  if (!codeSourceCandidate && routed.projectLocator) {
    codeSourceCandidate = await buildCandidateFromLocator(routed.projectLocator);
  }
  if (codeSourceCandidate) {
    routed.needsProject = true;
    if (routed.intent === "question") {
      routed.intent = "project-explore";
      routed.rationale = `${routed.rationale}；检测到明确代码源。`;
    }
  }

  const availableSkillIds = new Set(
    input.skills.flatMap((skill) => [skill.id, skill.skillKey])
  );
  const requestedSkills = [
    ...routed.skillIds,
    ...defaultSkillsForIntent(routed.intent),
  ].filter((id, index, list) => availableSkillIds.has(id) && list.indexOf(id) === index);

  const directMatches = matchProjectFromText(
    input.message,
    input.config.projects
  );
  let project: AgentProjectConfig | undefined;
  if (codeSourceCandidate?.kind === "configured-project") {
    project = input.config.projects.find(
      (candidate) => candidate.id === codeSourceCandidate.projectId
    );
  } else if (directMatches.length === 1) {
    project = directMatches[0];
  } else if (routed.projectId) {
    project = input.config.projects.find(
      (candidate) => candidate.id === routed.projectId
    );
  } else if (routed.needsProject && input.previousProjectId) {
    project = input.config.projects.find(
      (candidate) => candidate.id === input.previousProjectId
    );
  } else if (
    routed.needsProject &&
    !codeSourceCandidate &&
    input.config.projects.length === 1
  ) {
    // 仅当没有任何明确的代码源候选时，才兜底选中唯一信任项目，
    // 避免用户给了新项目路径却被静默替换成长期信任项目（如 aiwaji 误选）。
    project = input.config.projects[0];
  }

  let ambiguityQuestion: string | undefined;
  if (routed.needsProject && !project) {
    if (
      codeSourceCandidate?.kind === "local-path" ||
      codeSourceCandidate?.kind === "github-repository"
    ) {
      ambiguityQuestion = undefined;
    } else if (input.config.projects.length === 0) {
      ambiguityQuestion =
        "请在对话中提供本地项目绝对路径、GitHub 公开仓库地址，或先在设置页添加长期信任项目。";
    } else {
      ambiguityQuestion = `你希望我分析哪个项目？可用项目：${input.config.projects
        .map((item) => item.name)
        .join("、")}。`;
    }
  }

  const needsAssets =
    input.targetKind !== "technical-document" &&
    (routed.needsAssets || routed.needsProposal);
  const activeTools = [
    "set_task_plan",
    "load_skill",
    "read_skill_resource",
    // 文章/技术文档的提案工具始终可用：意图路由可能把写作请求误判为 question，
    // 但只要目标是文章，模型就应能调用提交工具，避免正文以纯文本形式输出而无法落盘。
    input.targetKind === "technical-document"
      ? "propose_technical_document_revision"
      : "propose_article_revision",
    // 文章目标的素材工具始终可用：让模型能查看并按需插图，
    // 不再受 needsAssets 门控（避免写作请求误判为 question 时素材缺失）。
    ...(input.targetKind === "article"
      ? ["article_assets", "set_article_digest"]
      : []),
    ...(routed.needsWeb ? ["web_search", "web_extract"] : []),
    ...(project ? ["explore_project"] : []),
    ...(routed.needsGitHistory && project ? ["analyze_code_changes"] : []),
  ];

  const route: AgentRoute = {
    ...routed,
    needsAssets,
    skillIds: requestedSkills.slice(0, 4),
    project,
    codeSourceCandidate: codeSourceCandidate ?? undefined,
    ambiguityQuestion,
    activeTools,
  };

  log.info(
    {
      llmRouted,
      intent: route.intent,
      skillIds: route.skillIds,
      activeTools: route.activeTools,
      projectId: route.project?.id ?? null,
      codeSource: route.codeSourceCandidate?.displayName ?? null,
      needsWeb: route.needsWeb,
      needsProject: route.needsProject,
      needsGitHistory: route.needsGitHistory,
      needsProposal: route.needsProposal,
      ambiguous: !!route.ambiguityQuestion,
    },
    "意图路由完成"
  );

  return route;
}
