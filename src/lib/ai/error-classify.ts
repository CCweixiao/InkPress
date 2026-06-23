/**
 * 错误归类（前后端共享）。
 *
 * 把 LLM/请求错误的原始信息归类为 { category, label, suggestion, raw, statusCode }，
 * 前端据此渲染「中文短句 + 修复建议 + 可展开原始错误」（设计文档 §2.7），
 * 后端意图路由 / 流式 onError 复用同一份归类逻辑。
 *
 * 只做纯字符串/字段归类，无副作用，方便单测。
 */

export type ErrorCategory =
  | "quota"
  | "auth"
  | "model-not-found"
  | "no-structured-output"
  | "rate-limit"
  | "timeout"
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
  /** HTTP 状态码（若错误对象携带，如 AI_APICallError.statusCode）。 */
  statusCode?: number;
};

type RetryErrorLike = {
  name?: string;
  lastError?: { message?: string; statusCode?: number } | Error;
  errors?: Array<{ message?: string; statusCode?: number } | Error>;
  cause?: { message?: string; statusCode?: number };
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

/** 从错误对象（含 AI_RetryError 内层）尽力提取 HTTP 状态码。 */
function extractStatusCode(err: unknown): number | undefined {
  const direct = err as { statusCode?: number; status?: number };
  if (typeof direct.statusCode === "number") return direct.statusCode;
  if (typeof direct.status === "number") return direct.status;
  const retryErr = err as RetryErrorLike;
  const inner = retryErr.lastError;
  if (inner && typeof (inner as { statusCode?: number }).statusCode === "number") {
    return (inner as { statusCode: number }).statusCode;
  }
  return undefined;
}

const SETTINGS_HINT = "在「设置 → 系统配置 → AI 模型」中";

const RULES: Array<{
  category: ErrorCategory;
  test: RegExp;
  label: string;
  suggestion: string;
}> = [
  {
    category: "quota",
    test: /余额不足|额度|配额|请充值|insufficient|quota|payment required|exceeded your current quota/i,
    label: "模型余额不足或额度已尽",
    suggestion: `请充值，或${SETTINGS_HINT}切换供应商/模型。`,
  },
  {
    category: "auth",
    test: /401|unauthorized|invalid api key|invalid_api_key|forbidden|鉴权失败|key.{0,4}(无效|过期|错误)/i,
    label: "API Key 无效或已过期",
    suggestion: `请检查${SETTINGS_HINT}的供应商配置。`,
  },
  {
    category: "model-not-found",
    test: /model.*not found|does not exist|未知模型|model_not_found|模型.{0,4}不存在/i,
    label: "所选模型不存在",
    suggestion: `请${SETTINGS_HINT}更换为该供应商支持的模型。`,
  },
  {
    category: "no-structured-output",
    test: /tool.?call|function.?call|tools?.+(unsupported|not supported)|不支持.+工具|structured|json.?schema|no tool call/i,
    label: "模型不支持结构化输出",
    suggestion: `请切换到支持 Tool Calling 的模型。`,
  },
  {
    // 速率限制：含厂商中文文案（智谱「访问量过大」「稍后再试」等），不依赖消息里出现 429 字样
    category: "rate-limit",
    test: /rate limit|too many requests|429|访问量过大|访问频率|过于频繁|稍后再试|当前繁忙|频次限制|触发限流/i,
    label: "请求被限流",
    suggestion: "模型当前访问量过大，请稍后重试，或更换模型。",
  },
  {
    category: "timeout",
    test: /timeout|timed out|ETIMEDOUT|ECONNRESET|请求超时/i,
    label: "请求超时",
    suggestion: "请重试，或更换响应更快的模型。",
  },
  {
    category: "network",
    test: /fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|failed to fetch|网络/i,
    label: "网络连接失败",
    suggestion: "请检查网络或代理设置后重试。",
  },
];

/** 状态码 → category（服务端 AI_APICallError 携带精确状态码时最可靠）。 */
function categoryByStatus(code: number): ErrorCategory | undefined {
  if (code === 429) return "rate-limit";
  if (code === 401 || code === 403) return "auth";
  if (code === 402) return "quota";
  if (code === 408 || code === 504) return "timeout";
  return undefined;
}

/** 把任意错误归类。err 可以是 Error / string / AI_RetryError / AI_APICallError / 未知对象。 */
export function classifyError(err: unknown): ClassifiedError {
  const text = unwrapMessage(err);
  const statusCode = extractStatusCode(err);
  // 状态码优先（精确），其次按消息文本（含厂商中文文案）匹配
  const byStatus = statusCode ? categoryByStatus(statusCode) : undefined;
  const matched =
    (byStatus && RULES.find((r) => r.category === byStatus)) ??
    RULES.find((r) => r.test.test(text));
  if (matched) {
    return {
      category: matched.category,
      label: matched.label,
      suggestion: matched.suggestion,
      raw: text.slice(0, 500),
      statusCode,
    };
  }
  return {
    category: "unknown",
    label: "请求失败，请稍后重试",
    suggestion: "若多次失败，请检查模型与网络配置。",
    raw: text.slice(0, 500),
    statusCode,
  };
}
