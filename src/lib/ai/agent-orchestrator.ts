import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type {
  AgentConfig,
  AgentProjectConfig,
} from "@/lib/ai/agent-config";
import type { SkillCatalogItem } from "@/lib/ai/skills";
import {
  extractCodeSourceCandidate,
  type CodeSourceCandidate,
  type CodeSourceReference,
} from "@/lib/ai/code-source";
import { moduleLogger } from "@/lib/logger";

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
]);
export type AgentIntent = z.infer<typeof agentIntentSchema>;

const routeSchema = z.object({
  intent: agentIntentSchema,
  skillIds: z.array(z.string()).max(4),
  needsWeb: z.boolean(),
  needsAssets: z.boolean(),
  needsProject: z.boolean(),
  needsGitHistory: z.boolean().default(false),
  needsProposal: z.boolean(),
  projectId: z.string().nullable(),
  rationale: z.string().max(300),
});

export type AgentRoute = z.infer<typeof routeSchema> & {
  project?: AgentProjectConfig;
  codeSourceCandidate?: CodeSourceCandidate;
  codeSource?: CodeSourceReference;
  ambiguityQuestion?: string;
  activeTools: string[];
};

function fallbackRoute(message: string): z.infer<typeof routeSchema> {
  const text = message.toLowerCase();
  const project =
    /项目|代码|源码|仓库|repo|repository|模块|架构|调用链|调用栈/.test(text);
  const technicalDoc =
    /(技术文档|架构文档|调用链文档|模块文档|依赖分析文档|实现说明)/.test(text);
  const projectArticle =
    project && /(公众号|文章|博客|写成文章|技术文章)/.test(text);
  const gitHistory =
    /git\s*(?:diff|log)|commit|提交(?:记录|历史)?|版本区间|更新日志|变更记录|release\s*note|pr\b|v?\d+(?:\.\d+)+\s*(?:到|至|~|～|→|\.\.)\s*v?\d+(?:\.\d+)+/i.test(
      text
    );
  const changeArticle =
    gitHistory && /(公众号|文章|博客|功能介绍|版本复盘|写成文章)/.test(text);
  const changeDocument =
    gitHistory && /(技术文档|变更文档|更新文档|实现说明)/.test(text);
  const research = /搜索|查找|联网|资料|最新|事实|调研|来源/.test(text);
  const review = /审校|校对|检查|错别字|逻辑问题|事实核查/.test(text);
  const polish =
    /润色|改写|优化|精简|扩写|调整文章|修改文章|去\s*ai\s*味|去除ai|机器味|机器人味|像真人|人味/.test(
      text
    );
  const create = /写一篇|生成文章|创作|撰写|写成文章/.test(text);
  const intent: AgentIntent = changeArticle
    ? "change-to-article"
    : changeDocument
      ? "write-change-document"
      : gitHistory
        ? "project-change-analysis"
        : projectArticle
          ? "project-to-article"
          : technicalDoc
            ? "write-technical-doc"
            : project
              ? "project-explore"
        : review
          ? "review"
          : polish
            ? "polish"
            : research
              ? "research"
              : create
                ? "create-article"
                : "question";
  const needsProposal =
    create ||
    polish ||
    technicalDoc ||
    projectArticle ||
    changeDocument ||
    changeArticle ||
    /修改|重写|写成|生成文章|撰写/.test(text);
  return {
    intent,
    skillIds: [],
    needsWeb: research,
    needsAssets: create || polish || needsProposal,
    needsProject: project || technicalDoc || gitHistory,
    needsGitHistory: gitHistory,
    needsProposal,
    projectId: null,
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

function defaultSkillsForIntent(intent: AgentIntent) {
  switch (intent) {
    case "create-article":
      return ["wechat-writing"];
    case "polish":
      return ["de-ai-writing"];
    case "review":
      return ["editorial-review"];
    case "research":
      return ["web-research"];
    case "project-explore":
      return ["codebase-exploration"];
    case "write-technical-doc":
      return ["codebase-exploration", "technical-documentation"];
    case "project-to-article":
      return ["codebase-exploration", "project-to-article", "wechat-writing"];
    case "project-change-analysis":
      return ["code-change-analysis"];
    case "write-change-document":
      return ["code-change-analysis", "technical-documentation"];
    case "change-to-article":
      return ["code-change-analysis", "project-to-article", "wechat-writing"];
    default:
      return [];
  }
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
    log.warn({ err }, "意图路由 LLM 失败，回退到规则路由");
    routed = fallbackRoute(input.message);
  }
  const deterministic = fallbackRoute(input.message);
  if (deterministic.intent !== "question") {
    routed = {
      ...routed,
      intent: deterministic.intent,
      needsWeb: routed.needsWeb || deterministic.needsWeb,
      needsAssets: routed.needsAssets || deterministic.needsAssets,
      needsProject: routed.needsProject || deterministic.needsProject,
      needsGitHistory:
        routed.needsGitHistory || deterministic.needsGitHistory,
      needsProposal: routed.needsProposal || deterministic.needsProposal,
      rationale:
        routed.intent === deterministic.intent
          ? routed.rationale
          : `${routed.rationale}；确定性规则校正为 ${deterministic.intent}。`,
    };
  }

  const codeSourceCandidate = extractCodeSourceCandidate(
    input.message,
    input.config.projects
  );
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
  } else if (routed.needsProject && input.config.projects.length === 1) {
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
    ...(input.targetKind === "article" ? ["article_assets"] : []),
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
