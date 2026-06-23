/**
 * 错误归类（前后端共享）。
 *
 * 把 LLM/请求错误的原始信息归类为 { category, label, suggestion, raw }，
 * 前端据此渲染「中文短句 + 修复建议 + 可展开原始错误」（设计文档 §2.7），
 * 后端意图路由复用同一份归类逻辑写进 rationale 便于诊断。
 *
 * 只做纯字符串归类，无副作用，方便单测。
 */

export type ErrorCategory =
  | "quota"
  | "auth"
  | "model-not-found"
  | "no-structured-output"
  | "timeout"
  | "rate-limit"
  | "network"
  | "unknown";

export type ClassifiedError = {
  category: ErrorCategory;
  /** 中文短句，直接展示给用户。 */
  label: string;
  /** 修复建议。 */
  suggestion: string;
  /** 原始错误文本（截断），供「展开原始错误」诊断。 */
  raw: string;
};

type RetryErrorLike = {
  name?: string;
  lastError?: { message?: string } | Error;
  errors?: Array<{ message?: string } | Error>;
  cause?: { message?: string };
};

/** 解包 AI_RetryError 等包装错误，取最底层的 message。 */
function unwrapMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "请求失败";
  const retryErr = err as RetryErrorLike;
  if (retryErr?.name === "AI_RetryError" || /RetryError/i.test(raw)) {
    const inner =
      (retryErr.lastError instanceof Error
        ? retryErr.lastError.message
        : retryErr.lastError?.message) ??
      retryErr.errors?.find((e) => e)?.message ??
      retryErr.cause?.message ??
      raw;
    if (inner) return inner;
  }
  return raw;
}

const RULES: Array<{
  category: ErrorCategory;
  test: RegExp;
  label: string;
  suggestion: string;
}> = [
  {
    category: "quota",
    test: /余额不足|额度|配额|insufficient|quota|payment required|exceeded your current quota/i,
    label: "模型余额不足或额度已尽",
    suggestion: "检查供应商账户额度，或换一个可用模型。",
  },
  {
    category: "auth",
    test: /401|unauthorized|invalid api key|invalid_api_key|forbidden/i,
    label: "API Key 无效或已过期",
    suggestion: "在系统配置里更新该供应商的 API Key。",
  },
  {
    category: "model-not-found",
    test: /model.*not found|does not exist|未知模型|model_not_found/i,
    label: "所选模型不存在",
    suggestion: "换一个该供应商支持的模型。",
  },
  {
    category: "no-structured-output",
    test: /tool.?call|function.?call|tools?.+(unsupported|not supported)|不支持.+工具|structured|json.?schema|no tool call/i,
    label: "模型不支持结构化输出",
    suggestion: "换一个支持 function/tool calling 的模型。",
  },
  {
    category: "rate-limit",
    test: /rate limit|too many requests|429/i,
    label: "请求被限流",
    suggestion: "稍后重试，或降低请求频率。",
  },
  {
    category: "timeout",
    test: /timeout|timed out|ETIMEDOUT|ECONNRESET/i,
    label: "请求超时",
    suggestion: "重试，或换一个响应更快的模型。",
  },
  {
    category: "network",
    test: /fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Failed to fetch/i,
    label: "网络连接失败",
    suggestion: "检查网络或代理设置后重试。",
  },
];

/** 把任意错误归类。err 可以是 Error / string / AI_RetryError / 未知对象。 */
export function classifyError(err: unknown): ClassifiedError {
  const text = unwrapMessage(err);
  const matched = RULES.find((rule) => rule.test.test(text));
  if (matched) {
    return {
      category: matched.category,
      label: matched.label,
      suggestion: matched.suggestion,
      raw: text.slice(0, 500),
    };
  }
  return {
    category: "unknown",
    label: "请求失败，请稍后重试",
    suggestion: "若多次失败，请检查模型与网络配置。",
    raw: text.slice(0, 500),
  };
}
