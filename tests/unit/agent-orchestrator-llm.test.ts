import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 整文件 mock `ai` 的 generateObject，用于验证「LLM 优先」裁决（决策 A）与 projectLocator 兜底。
// 独立成文，避免 vi.mock 污染 agent-orchestrator.test.ts 里依赖 generateObject 抛错的 failingModel 用例。
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from "ai";
import { routeAgentRequest } from "../../src/lib/ai/agent-orchestrator";

const baseConfig = {
  tavilyApiKey: "",
  maxSteps: 12,
  contextBudgetTokens: 32000,
  projects: [],
};

const roots: string[] = [];

afterEach(async () => {
  vi.mocked(generateObject).mockReset();
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("routeAgentRequest — LLM 优先裁决（决策 A）", () => {
  it("保留 LLM 判定的 intent，不被规则覆盖", async () => {
    // 消息含「项目」，规则路由会判 project-explore，但 LLM 优先应保留 create-article
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: "create-article",
        skillIds: [],
        needsWeb: false,
        needsAssets: false,
        needsProject: false,
        needsGitHistory: false,
        needsProposal: true,
        projectId: null,
        projectLocator: null,
        rationale: "LLM 判定为公众号创作。",
      },
    } as never);

    const route = await routeAgentRequest({
      model: {} as never,
      message: "帮我把这个项目的发现写成文章",
      skills: [],
      config: baseConfig,
    });

    expect(route.intent).toBe("create-article");
  });

  it("LLM 失败时回退到规则 intent", async () => {
    vi.mocked(generateObject).mockRejectedValue(new Error("LLM 不可用"));

    const route = await routeAgentRequest({
      model: {} as never,
      message: "请把当前文章润色得像真人写的，去掉 AI 味",
      skills: [],
      config: baseConfig,
    });

    expect(route.intent).toBe("polish");
    expect(route.rationale).toContain("LLM 不可用");
  });

  it("LLM 判定 out-of-scope 时不被规则改写为合法意图", async () => {
    // 消息含「代码」（规则会判 project-explore），但 LLM 判定超范围应保留
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: "out-of-scope",
        skillIds: [],
        needsWeb: false,
        needsAssets: false,
        needsProject: false,
        needsGitHistory: false,
        needsProposal: false,
        projectId: null,
        projectLocator: null,
        rationale: "用户要求修改源代码，超出写作助手能力。",
      },
    } as never);

    const route = await routeAgentRequest({
      model: {} as never,
      message: "帮我把登录代码改成 OAuth",
      skills: [],
      config: baseConfig,
    });

    expect(route.intent).toBe("out-of-scope");
  });
});

describe("routeAgentRequest — clarify 反问（不硬猜）", () => {
  it("LLM 判定需要澄清时，输出 ambiguityQuestion（route.ts 会据此反问、不跑 Agent）", async () => {
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: "question",
        skillIds: [],
        needsWeb: false,
        needsAssets: false,
        needsProject: false,
        needsGitHistory: false,
        needsProposal: false,
        projectId: null,
        projectLocator: null,
        rationale: "输入含糊，信息不足。",
        clarify: "你想让我做什么呢？可以告诉我主题和要求。",
      },
    } as never);

    const route = await routeAgentRequest({
      model: {} as never,
      message: "那个",
      skills: [],
      config: baseConfig,
    });

    expect(route.ambiguityQuestion).toBe(
      "你想让我做什么呢？可以告诉我主题和要求。"
    );
    expect(route.intent).toBe("question");
  });
});

describe("routeAgentRequest — projectLocator 兜底（根治 aiwaji 误选）", () => {
  it("正则漏掉中文紧贴路径时，用 LLM projectLocator 兜底且不误选唯一信任项目", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkpress-loc-"));
    roots.push(root);
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        intent: "project-explore",
        skillIds: [],
        needsWeb: false,
        needsAssets: false,
        needsProject: true,
        needsGitHistory: false,
        needsProposal: false,
        projectId: null,
        projectLocator: root,
        rationale: "探索本地项目。",
      },
    } as never);

    const route = await routeAgentRequest({
      model: {} as never,
      // 路径紧贴中文「目」，LOCAL_PATH_PATTERN 前导白名单不含 CJK，正则必然漏识别
      message: `探索项目${root}的架构`,
      skills: [],
      config: {
        ...baseConfig,
        // 即便信任列表里有唯一项目 aiwaji，也不应被静默选中
        projects: [{ id: "aiwaji", name: "aiwaji", root: "/tmp/aiwaji" }],
      },
    });

    expect(route.codeSourceCandidate).toMatchObject({
      kind: "local-path",
      root: await fs.realpath(root),
    });
    expect(route.project?.id).toBeUndefined();
  });
});
