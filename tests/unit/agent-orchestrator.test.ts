import { describe, expect, it } from "vitest";
import { routeAgentRequest } from "../../src/lib/ai/agent-orchestrator";

const failingModel = {} as never;
const skills = [
  {
    id: "de-ai-writing",
    skillKey: "de-ai-writing",
    name: "中文去 AI 味润色",
    description: "保真润色中文文章并去除 AI 痕迹",
    source: "system" as const,
    hasResources: true,
  },
  {
    id: "code-change-analysis",
    skillKey: "code-change-analysis",
    name: "代码变更分析",
    description: "分析 Git 提交和 Diff",
    source: "system" as const,
    hasResources: true,
  },
  {
    id: "codebase-exploration",
    skillKey: "codebase-exploration",
    name: "只读代码探索",
    description: "分析源码项目并输出代码证据",
    source: "system" as const,
    hasResources: false,
  },
  {
    id: "technical-documentation",
    skillKey: "technical-documentation",
    name: "技术文档",
    description: "根据代码证据编写技术文档",
    source: "system" as const,
    hasResources: true,
  },
  {
    id: "wechat-writing",
    skillKey: "wechat-writing",
    name: "公众号写作",
    description: "写公众号文章",
    source: "system" as const,
    hasResources: true,
  },
  {
    id: "project-to-article",
    skillKey: "project-to-article",
    name: "项目转文章",
    description: "把项目写成文章",
    source: "system" as const,
    hasResources: false,
  },
];

describe("routeAgentRequest", () => {
  it("automatically selects an explicitly named project", async () => {
    const route = await routeAgentRequest({
      model: failingModel,
      message: "分析 datastoria 项目的源码架构",
      skills,
      config: {
        tavilyApiKey: "",
        maxSteps: 12,
        contextBudgetTokens: 32000,
        projects: [
          { id: "datastoria", name: "Datastoria", root: "/tmp/datastoria" },
          { id: "inkpress", name: "InkPress", root: "/tmp/InkPress" },
        ],
      },
    });
    expect(route.intent).toBe("project-explore");
    expect(route.project?.id).toBe("datastoria");
    expect(route.activeTools).toContain("explore_project");
    expect(route.skillIds).toContain("codebase-exploration");
  });

  it("separates technical documentation from project-to-article", async () => {
    const config = {
      tavilyApiKey: "",
      maxSteps: 12,
      contextBudgetTokens: 32000,
      projects: [{ id: "inkpress", name: "InkPress", root: "/tmp/InkPress" }],
    };
    const technical = await routeAgentRequest({
      model: failingModel,
      message: "为 InkPress 生成调用链技术文档",
      skills,
      config,
      targetKind: "technical-document",
    });
    expect(technical.intent).toBe("write-technical-doc");
    expect(technical.skillIds).toContain("technical-documentation");
    expect(technical.activeTools).toContain(
      "propose_technical_document_revision"
    );
    expect(technical.needsAssets).toBe(false);

    const article = await routeAgentRequest({
      model: failingModel,
      message: "把 InkPress 项目的实现写成公众号技术文章",
      skills,
      config,
      targetKind: "article",
    });
    expect(article.intent).toBe("project-to-article");
    expect(article.skillIds).toContain("project-to-article");
    expect(article.skillIds).toContain("wechat-writing");
  });

  it("asks when a project task is ambiguous", async () => {
    const route = await routeAgentRequest({
      model: failingModel,
      message: "分析本地项目的模块",
      skills,
      config: {
        tavilyApiKey: "",
        maxSteps: 12,
        contextBudgetTokens: 32000,
        projects: [
          { id: "a", name: "项目 A", root: "/tmp/a" },
          { id: "b", name: "项目 B", root: "/tmp/b" },
        ],
      },
    });
    expect(route.project).toBeUndefined();
    expect(route.ambiguityQuestion).toContain("项目 A");
  });

  it("loads de-ai-writing for Chinese polishing requests", async () => {
    const route = await routeAgentRequest({
      model: failingModel,
      message: "请把当前文章润色得像真人写的，去掉 AI 味",
      skills,
      config: {
        tavilyApiKey: "",
        maxSteps: 12,
        contextBudgetTokens: 32000,
        projects: [],
      },
    });
    expect(route.intent).toBe("polish");
    expect(route.skillIds).toContain("de-ai-writing");
    expect(route.needsAssets).toBe(true);
    expect(route.activeTools).toContain("propose_article_revision");
  });

  it("detects direct local paths and Git change article intent", async () => {
    const route = await routeAgentRequest({
      model: failingModel,
      message:
        "根据 /Users/jielongping/OpenProjects/aiwaji 最近一周的 commit 和 diff 写一篇公众号功能更新文章",
      skills,
      config: {
        tavilyApiKey: "",
        maxSteps: 12,
        contextBudgetTokens: 32000,
        projects: [],
      },
      targetKind: "article",
    });
    expect(route.intent).toBe("change-to-article");
    expect(route.needsGitHistory).toBe(true);
    expect(route.codeSourceCandidate).toMatchObject({
      kind: "local-path",
      displayName: "aiwaji",
    });
    expect(route.skillIds).toContain("code-change-analysis");
    expect(route.ambiguityQuestion).toBeUndefined();
  });
});
