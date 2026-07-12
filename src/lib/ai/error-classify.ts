/**
 * 错误归类（前后端共享）。
 *
 * 把 LLM/请求错误的原始信息归类为 { category, label, suggestion, raw, statusCode }，
 * 前端据此渲染「中文短句 + 修复建议 + 可展开原始错误」（设计文档 §2.7），
 * 后端接口 / 流式 onError 复用同一份归类逻辑。
 *
 * 只做纯字符串/字段归类，无副作用，方便单测。
 */

export type ErrorCategory =
  | "cancelled"
  | "quota"
  | "auth"
  | "model-not-found"
  | "no-structured-output"
  | "rate-limit"
  | "timeout"
  | "provider-service"
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

const DIAGNOSTIC_PREFIX = "诊断：";

function redactSensitiveText(text: string): string {
  return text
    .replace(
      /(api[_-]?key|token|authorization|auth[_-]?token|secret|password)(["'\s:=]+)([A-Za-z0-9._~+/=-]{8,})/gi,
      "$1$2[REDACTED]"
    )
    .replace(
      /(sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/g,
      "[REDACTED]"
    );
}

type RetryErrorLike = {
  name?: string;
  message?: string;
  code?: string | number;
  status?: number;
  statusCode?: number;
  lastError?: { message?: string; statusCode?: number } | Error;
  errors?: Array<{ message?: string; statusCode?: number } | Error>;
  cause?: { message?: string; code?: string | number; statusCode?: number };
};

function stringifyFallback(err: unknown): string {
  if (err instanceof Error) {
    const extra = err as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      cause?: { message?: unknown; code?: unknown };
    };
    const fields = [
      err.name && err.name !== "Error" ? err.name : "",
      err.message,
      typeof extra.code === "string" ? `code=${extra.code}` : "",
      typeof extra.status === "number" ? `status=${extra.status}` : "",
      typeof extra.statusCode === "number"
        ? `statusCode=${extra.statusCode}`
        : "",
      extra.cause?.message ? `cause=${String(extra.cause.message)}` : "",
      extra.cause?.code ? `causeCode=${String(extra.cause.code)}` : "",
    ].filter(Boolean);
    return fields.join(" · ") || "请求失败";
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const retryErr = err as RetryErrorLike;
    const fields = [
      retryErr.name,
      retryErr.message,
      retryErr.code === undefined ? undefined : `code=${String(retryErr.code)}`,
      retryErr.status === undefined ? undefined : `status=${retryErr.status}`,
      retryErr.statusCode === undefined
        ? undefined
        : `statusCode=${retryErr.statusCode}`,
      retryErr.cause?.message ? `cause=${retryErr.cause.message}` : undefined,
      retryErr.cause?.code === undefined
        ? undefined
        : `causeCode=${String(retryErr.cause.code)}`,
    ].filter(Boolean);
    if (fields.length) return fields.join(" · ");
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return "请求失败";
}

/** 解包 AI_RetryError 等包装错误，取最底层的 message。 */
function unwrapMessage(err: unknown): string {
  const raw = stringifyFallback(err);
  const retryErr = err as RetryErrorLike;
  if (retryErr?.name === "AI_RetryError" || /RetryError/i.test(raw)) {
    const inner =
      (retryErr.lastError instanceof Error
        ? stringifyFallback(retryErr.lastError)
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

/** 限流判定正则（rate-limit 规则与 isRateLimitError 共用）。 */
const RATE_LIMIT_TEST =
  /rate limit|too many requests|429|访问量过大|访问频率|过于频繁|稍后再试|当前繁忙|频次限制|触发限流/i;
const NETWORK_TEST =
  /fetch failed|network|ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EPIPE|EHOSTUNREACH|failed to fetch|网络|socket|socket hang up|connection (?:error|reset|refused|closed|terminated|aborted)|other side closed|premature close|terminated|UND_ERR|undici|tunnel|proxy|代理|dns|temporary failure|TLS|SSL|certificate|CERT_/i;
const PROVIDER_SERVICE_TEST =
  /\b50[023]\b|server error|internal server error|bad gateway|service unavailable|temporarily unavailable|model overloaded|overloaded|模型服务异常|服务暂时不可用|服务不可用|上游服务异常/i;
const CANCELLED_TEST =
  /aborted by user|cancel(?:led|ed) by user|user abort|user cancelled|user canceled|AbortError|操作已取消|对话已取消|用户取消|用户中断/i;

const RULES: Array<{
  category: ErrorCategory;
  test: RegExp;
  label: string;
  suggestion: string;
}> = [
  {
    category: "cancelled",
    test: CANCELLED_TEST,
    label: "任务已取消",
    suggestion: "Claude Code 进程已被用户中断，本次结果未继续生成。",
  },
  {
    // GitHub Token 无效/过期：代码源 clone 前的 API 探测（githubRequest）返回 Bad credentials。
    // 必须排在通用 auth 规则之前——后者只匹配 401/unauthorized/forbidden，漏掉 "Bad credentials"。
    category: "auth",
    test: /bad credentials|github[^。]*token.{0,6}(无效|过期|错误|invalid|expired)|令牌无权/i,
    label: "GitHub Token 无效或已过期",
    suggestion:
      "请在设置里更新写作 Agent 的 GitHub Token（或清空后对公开仓库匿名访问），再重试。",
  },
  {
    // GitHub API 限流（匿名 60 次/小时耗尽，code-source.ts 的 403/429 分支）：
    // 其文案「访问受限」「稍后重试」不匹配通用 rate-limit 规则（要求「访问频率」「稍后再试」），
    // 不补这条会落到 unknown 兜底，误提示「检查模型与网络配置」。
    category: "rate-limit",
    test: /GitHub.*(访问受限|限流)|API rate limit exceeded/i,
    label: "GitHub API 访问受限",
    suggestion:
      "匿名访问 GitHub 限流（60 次/小时）。请在设置里为写作 Agent 配置 GitHub Token（提升到 5000 次/小时）后重试。",
  },
  {
    // GitHub 仓库不可访问（404：私有 / 不存在 / 无权，code-source.ts 的 404 分支与私有仓库判断）：
    // 排在「Token 无效」auth 规则之后——Token 无效的文案由前者捕获，其余落到这里。
    category: "auth",
    test: /GitHub.*(私有仓库|仓库不存在|无权访问)|仓库为私有/i,
    label: "GitHub 仓库不可访问",
    suggestion:
      "仓库为私有或不存在。若是私有仓库，请在设置里为写作 Agent 配置有权限的 GitHub Token 后重试。",
  },
  {
    // 其他 GitHub 请求错误（code-source.ts 兜底「GitHub：{msg}」/「GitHub 请求失败（xxx）」）。
    category: "network",
    test: /GitHub[：:]|GitHub 请求失败/i,
    label: "GitHub 请求失败",
    suggestion:
      "访问 GitHub 失败，请检查网络或稍后重试；若反复受限，请在设置里为写作 Agent 配置 GitHub Token。",
  },
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
    test: RATE_LIMIT_TEST,
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
    category: "provider-service",
    test: PROVIDER_SERVICE_TEST,
    label: "模型服务暂时不可用",
    suggestion: "供应商服务可能短暂波动；系统会在安全条件下自动重试，也可以稍后手动重试或更换模型。",
  },
  {
    category: "network",
    test: NETWORK_TEST,
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
  if (code === 500 || code === 502 || code === 503) return "provider-service";
  return undefined;
}

/** 把任意错误归类。err 可以是 Error / string / AI_RetryError / AI_APICallError / 未知对象。 */
export function classifyError(err: unknown): ClassifiedError {
  const text = unwrapMessage(err);
  const statusCode = extractStatusCode(err);
  const cancelledByText = CANCELLED_TEST.test(text)
    ? RULES.find((r) => r.category === "cancelled")
    : undefined;
  // 显式网络层 code（如 UND_ERR_SOCKET/ECONNRESET）优先，其次状态码，再按供应商文案匹配。
  const networkByText = NETWORK_TEST.test(text)
    ? RULES.find((r) => r.category === "network")
    : undefined;
  const byStatus = statusCode ? categoryByStatus(statusCode) : undefined;
  const matched =
    cancelledByText ??
    networkByText ??
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

export function formatErrorForUser(err: unknown): string {
  const classified = classifyError(err);
  const details = [
    classified.statusCode ? `HTTP ${classified.statusCode}` : null,
    `category=${classified.category}`,
    classified.raw ? `raw=${redactSensitiveText(classified.raw)}` : null,
  ].filter(Boolean);
  return [
    classified.label,
    classified.suggestion,
    details.length ? `${DIAGNOSTIC_PREFIX}${details.join(" · ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseFormattedErrorMessage(message: string): ClassifiedError | null {
  const line = message
    .split(/\r?\n/)
    .find((part) => part.trim().startsWith(DIAGNOSTIC_PREFIX));
  if (!line) return null;
  const diagnostic = line.trim().slice(DIAGNOSTIC_PREFIX.length);
  const statusMatch = diagnostic.match(/HTTP\s+(\d{3})/i);
  const categoryMatch = diagnostic.match(/category=([a-z-]+)/i);
  const rawMatch = diagnostic.match(/(?:^| · )raw=([\s\S]*)$/);
  const category = categoryMatch?.[1] as ErrorCategory | undefined;
  if (!category) return null;
  return {
    category,
    label: message.split(/\r?\n/)[0]?.trim() || "请求失败，请稍后重试",
    suggestion: message.split(/\r?\n/)[1]?.trim() || "若多次失败，请检查模型与网络配置。",
    raw: rawMatch?.[1] ?? "",
    statusCode: statusMatch ? Number(statusMatch[1]) : undefined,
  };
}

/**
 * 是否为限流类错误（供 Claude Agent 外层重试循环判定）。
 * 状态码 429 优先，其次按消息文本匹配（含智谱「访问量过大」等厂商文案）。
 */
export function isRateLimitError(err: unknown): boolean {
  if (extractStatusCode(err) === 429) return true;
  return RATE_LIMIT_TEST.test(unwrapMessage(err));
}
