import { beforeEach, describe, expect, it, vi } from "vitest";
import { chooseLlmConfig, parseLlmConfigs } from "../../src/lib/ai/llm-config";
import { prisma } from "../../src/lib/db";

vi.mock("../../src/lib/db", () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(),
    },
  },
}));

const llmValue = JSON.stringify([
  {
    id: "anthropic",
    name: "Anthropic 官方",
    apiProvider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKey: "sk-ant",
    models: [
      { id: "claude-sonnet", name: "Claude Sonnet", enabled: true },
      { id: "claude-haiku", name: "Claude Haiku", enabled: true },
    ],
  },
  {
    id: "zhipu-glm",
    name: "智谱 GLM",
    apiProvider: "anthropic",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    apiKey: "sk-glm",
    models: [
      { id: "glm-4.6", name: "GLM-4.6", enabled: true, isDefault: true },
    ],
  },
]);

const findUnique = vi.mocked(prisma.systemConfig.findUnique);

describe("parseLlmConfigs", () => {
  it("全局默认模型跨供应商唯一", () => {
    const configs = parseLlmConfigs(llmValue);
    const defaults = configs.flatMap((config) =>
      config.models.filter((model) => model.isDefault)
    );

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe("glm-4.6");
  });

  it("为旧模型配置补齐默认上下文长度", () => {
    const configs = parseLlmConfigs(llmValue);

    expect(configs[0]?.models[0]?.contextWindowTokens).toBe(200000);
    expect(configs[1]?.models[0]?.contextWindowTokens).toBe(200000);
  });

  it("保留用户自定义模型上下文长度", () => {
    const configs = parseLlmConfigs(
      JSON.stringify({
        id: "custom",
        name: "Custom",
        apiProvider: "anthropic",
        baseUrl: "https://example.com",
        apiKey: "sk",
        models: [
          {
            id: "custom-model",
            name: "Custom Model",
            enabled: true,
            contextWindowTokens: 64000,
          },
        ],
      })
    );

    expect(configs[0]?.models[0]?.contextWindowTokens).toBe(64000);
  });
});

describe("chooseLlmConfig", () => {
  beforeEach(() => {
    findUnique.mockResolvedValue({
      id: "cfg",
      key: "inkpress.llm",
      value: llmValue,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  });

  it("按 provider id 精确选择，不把 apiProvider=anthropic 的所有供应商混在一起", async () => {
    const selected = await chooseLlmConfig("anthropic", null);

    expect(selected?.id).toBe("anthropic");
    expect(selected?.model.id).toBe("claude-sonnet");
    expect(selected?.baseUrl).toBe("https://api.anthropic.com");
  });

  it("未指定 provider/model 时使用全局默认模型", async () => {
    const selected = await chooseLlmConfig(null, null);

    expect(selected?.id).toBe("zhipu-glm");
    expect(selected?.model.id).toBe("glm-4.6");
  });

  it("指定 provider 和 model 时返回精确模型", async () => {
    const selected = await chooseLlmConfig("anthropic", "claude-haiku");

    expect(selected?.id).toBe("anthropic");
    expect(selected?.model.id).toBe("claude-haiku");
  });

  it("指定 provider 但 model 未命中时回退到该 provider 的首个启用模型", async () => {
    const selected = await chooseLlmConfig("anthropic", "missing-model");

    expect(selected?.id).toBe("anthropic");
    expect(selected?.model.id).toBe("claude-sonnet");
  });

  it("未知 provider 抛出清晰错误", async () => {
    await expect(chooseLlmConfig("missing-provider", null)).rejects.toThrow(
      "未找到可用 LLM 供应商：missing-provider。"
    );
  });
});
