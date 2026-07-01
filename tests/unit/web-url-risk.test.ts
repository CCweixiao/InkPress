import { describe, expect, it } from "vitest";
import {
  assessWebUrlRisk,
  summarizeRiskForAllowlist,
} from "../../src/lib/ai/web-url-risk";

describe("assessWebUrlRisk", () => {
  it("把 HTTPS 官方开发者文档识别为低风险", () => {
    const risk = assessWebUrlRisk("https://docs.anthropic.com/en/docs/claude-code");
    expect(risk.domain).toBe("docs.anthropic.com");
    expect(risk.isHttps).toBe(true);
    expect(risk.isKnownAuthority).toBe(true);
    expect(risk.isLikelyOfficial).toBe(true);
    expect(risk.riskLevel).toBe("low");
    expect(risk.signals).toContain("HTTPS");
  });

  it("把 GitHub 仓库来源识别为开发者/仓库来源", () => {
    const risk = assessWebUrlRisk("https://github.com/anthropics/claude-agent-sdk-python");
    expect(risk.domain).toBe("github.com");
    expect(risk.isRepositorySource).toBe(true);
    expect(risk.isDeveloperSource).toBe(true);
    expect(risk.riskLevel).toBe("low");
  });

  it("对非 HTTPS 或未知域给出警告", () => {
    const httpRisk = assessWebUrlRisk("http://example.com/page");
    expect(httpRisk.riskLevel).toBe("high");
    expect(httpRisk.warnings).toContain("非 HTTPS");

    const unknownRisk = assessWebUrlRisk("https://unknown-example-site.test/page");
    expect(unknownRisk.riskLevel).toBe("medium");
    expect(unknownRisk.warnings).toContain("域名未在内置权威来源列表中");
  });
});

describe("summarizeRiskForAllowlist", () => {
  it("生成可写入白名单 note 的摘要", () => {
    const risk = assessWebUrlRisk("https://github.com/owner/repo");
    expect(summarizeRiskForAllowlist(risk)).toContain("低风险");
    expect(summarizeRiskForAllowlist(risk).length).toBeLessThanOrEqual(200);
  });
});
