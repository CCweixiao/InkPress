import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/ai/agent-config", () => ({
  getAgentConfig: vi.fn(),
}));

import {
  parseWebResearchConfig,
  getWebResearchConfig,
  DEFAULT_WEB_RESEARCH_CONFIG,
} from "../../src/lib/ai/web-research-config";
import { prisma } from "@/lib/db";
import { getAgentConfig } from "@/lib/ai/agent-config";

const systemConfig = prisma.systemConfig as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const getAgent = getAgentConfig as unknown as ReturnType<typeof vi.fn>;

describe("parseWebResearchConfig", () => {
  it("null/undefined → 默认", () => {
    expect(parseWebResearchConfig(null)).toEqual(DEFAULT_WEB_RESEARCH_CONFIG);
    expect(parseWebResearchConfig(undefined)).toEqual(DEFAULT_WEB_RESEARCH_CONFIG);
  });
  it("解析对象", () => {
    const cfg = parseWebResearchConfig(
      JSON.stringify({ tavilyApiKey: "tvly-x", autoApprove: true })
    );
    expect(cfg.tavilyApiKey).toBe("tvly-x");
    expect(cfg.autoApprove).toBe(true);
  });
  it("缺字段走默认（autoApprove 非布尔 → false）", () => {
    const cfg = parseWebResearchConfig(JSON.stringify({ tavilyApiKey: "k" }));
    expect(cfg.tavilyApiKey).toBe("k");
    expect(cfg.autoApprove).toBe(false);
  });
  it("非对象抛错", () => {
    expect(() => parseWebResearchConfig(JSON.stringify([1, 2]))).toThrow(/对象/);
    expect(() => parseWebResearchConfig(JSON.stringify("x"))).toThrow(/对象/);
  });
});

describe("getWebResearchConfig", () => {
  beforeEach(() => {
    systemConfig.findUnique.mockReset();
    getAgent.mockReset();
  });

  it("本配置有 tavily → 用本配置，不读 agent", async () => {
    systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify({ tavilyApiKey: "tvly-new", autoApprove: true }),
    });
    const cfg = await getWebResearchConfig();
    expect(cfg.tavilyApiKey).toBe("tvly-new");
    expect(cfg.autoApprove).toBe(true);
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("本配置无 tavily + agent 有 → 回落 agent（迁移兼容）", async () => {
    systemConfig.findUnique.mockResolvedValue({
      value: JSON.stringify({ tavilyApiKey: "", autoApprove: false }),
    });
    getAgent.mockResolvedValue({ tavilyApiKey: "tvly-old" });
    const cfg = await getWebResearchConfig();
    expect(cfg.tavilyApiKey).toBe("tvly-old");
  });

  it("本配置不存在（null）+ agent 有 → 回落 agent", async () => {
    systemConfig.findUnique.mockResolvedValue(null);
    getAgent.mockResolvedValue({ tavilyApiKey: "tvly-old" });
    const cfg = await getWebResearchConfig();
    expect(cfg.tavilyApiKey).toBe("tvly-old");
  });

  it("两边都无 → 空", async () => {
    systemConfig.findUnique.mockResolvedValue(null);
    getAgent.mockResolvedValue({ tavilyApiKey: "" });
    const cfg = await getWebResearchConfig();
    expect(cfg.tavilyApiKey).toBe("");
  });
});
