import { describe, expect, it } from "vitest";
import { classifyError } from "../../src/lib/ai/error-classify";

describe("classifyError", () => {
  it("归类余额/配额错误", () => {
    const r = classifyError({ name: "AI_RetryError", lastError: { message: "exceeded your current quota" } });
    expect(r.category).toBe("quota");
    expect(r.label).toBe("模型余额不足或额度已尽");
    expect(r.suggestion).toBeTruthy();
  });

  it("归类鉴权失败", () => {
    expect(classifyError(new Error("401 Unauthorized")).category).toBe("auth");
    expect(classifyError("Invalid API Key").category).toBe("auth");
  });

  it("归类模型不存在", () => {
    expect(classifyError("model not found: foo").category).toBe("model-not-found");
  });

  it("归类不支持结构化输出", () => {
    expect(
      classifyError("no tool call was made").category
    ).toBe("no-structured-output");
  });

  it("归类限流", () => {
    expect(classifyError("429 Too Many Requests").category).toBe("rate-limit");
  });

  it("归类厂商中文限流文案（智谱「访问量过大」），即使消息里没有 429", () => {
    // 客户端只拿到消息文本的场景
    const r = classifyError(new Error("该模型当前访问量过大，请您稍后再试"));
    expect(r.category).toBe("rate-limit");
    expect(r.label).toBe("请求被限流");
  });

  it("AI_RetryError 包裹的 AI_APICallError（带 statusCode 429）→ 限流并保留状态码", () => {
    const r = classifyError({
      name: "AI_RetryError",
      message: "Failed after 2 attempts. Last error: 该模型当前访问量过大",
      lastError: {
        message: "该模型当前访问量过大，请您稍后再试",
        statusCode: 429,
      },
    });
    expect(r.category).toBe("rate-limit");
    expect(r.statusCode).toBe(429);
    expect(r.raw).toContain("访问量过大");
  });

  it("归类超时", () => {
    expect(classifyError("ETIMEDOUT").category).toBe("timeout");
  });

  it("归类大模型供应商服务异常", () => {
    expect(classifyError({ message: "Service Unavailable", statusCode: 503 }).category).toBe("provider-service");
    expect(classifyError("model overloaded, please try again").category).toBe("provider-service");
  });

  it("归类网络错误", () => {
    expect(classifyError("fetch failed").category).toBe("network");
    expect(classifyError("TypeError: terminated UND_ERR_SOCKET other side closed").category).toBe("network");
    expect(classifyError("socket hang up").category).toBe("network");
  });

  it("归类 GitHub API 限流（code-source 403/429，文案不匹配通用 rate-limit 规则）", () => {
    const r = classifyError(new Error("GitHub API 访问受限，请稍后重试或配置 GitHub Token。"));
    expect(r.category).toBe("rate-limit");
    expect(r.label).toBe("GitHub API 访问受限");
    expect(r.suggestion).toContain("GitHub Token");
  });

  it("归类 GitHub 仓库不可访问（私有/不存在/无权，code-source 404）", () => {
    const r = classifyError(
      new Error("GitHub 仓库不存在，或为无权访问的私有仓库（私有仓库需配置有权限的 Token）。")
    );
    expect(r.category).toBe("auth");
    expect(r.label).toBe("GitHub 仓库不可访问");
  });

  it("归类其他 GitHub 请求失败（code-source 兜底文案，冒号后无空格）", () => {
    expect(classifyError(new Error("GitHub：Server Error")).category).toBe("network");
    expect(classifyError(new Error("GitHub 请求失败（502）。")).category).toBe("network");
  });

  it("GitHub Token 无效优先命中 auth 而非「仓库不可访问」", () => {
    // 同时含「Token 无效」与「私有仓库」，应被更精确的 Token 无效规则优先捕获
    const r = classifyError(
      new Error("GitHub Token 无效，或仓库不存在/为私有仓库（私有仓库需配置有权限的 Token）。")
    );
    expect(r.label).toBe("GitHub Token 无效或已过期");
  });

  it("未知错误落到 unknown 并保留原文", () => {
    const r = classifyError(new Error("something weird happened"));
    expect(r.category).toBe("unknown");
    expect(r.raw).toContain("something weird");
  });

  it("AI_RetryError 解包到底层 message 再归类", () => {
    const r = classifyError({
      name: "AI_RetryError",
      lastError: new Error("rate limit exceeded"),
    });
    expect(r.category).toBe("rate-limit");
  });

  it("非 Error/非 string 输入不抛错", () => {
    const r = classifyError({ foo: "bar" });
    expect(r.category).toBe("unknown");
    expect(r.raw).toContain("foo");
  });

  it("保留错误对象的 code/status/cause 方便诊断", () => {
    const cause = new Error("other side closed");
    (cause as Error & { code: string }).code = "UND_ERR_SOCKET";
    const error = new Error("terminated") as Error & {
      code: string;
      statusCode: number;
      cause: Error;
    };
    error.code = "UND_ERR_SOCKET";
    error.statusCode = 502;
    error.cause = cause;
    const r = classifyError(error);
    expect(r.category).toBe("network");
    expect(r.raw).toContain("UND_ERR_SOCKET");
    expect(r.raw).toContain("other side closed");
  });

  it("raw 截断超长文本", () => {
    const long = "x".repeat(1000);
    expect(classifyError(long).raw.length).toBeLessThanOrEqual(500);
  });
});
