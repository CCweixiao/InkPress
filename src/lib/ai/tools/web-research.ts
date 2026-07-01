import { assertSafePublicUrl } from "@/lib/ai/safe-web";

/**
 * Web research 原子能力（P2）：联网搜索 + 网页抓取。供 registry 的 web_search / web_fetch
 * 工具调用。纯逻辑（fetch 经 fetchImpl 注入，便于单测），无 InkPress 上下文依赖。
 *
 * - searchWithTavily：调 Tavily Search API（key 来自 AgentConfig.tavilyApiKey）。
 * - fetchWebPage：assertSafePublicUrl（SSRF 守卫）→ fetch → 简单 HTML→text 抽取 → 截断。
 *
 * 设计依据：docs/agent-runtime-pdc.md §9。HTML 抽取不引依赖（去标签 + 解码常见实体），
 * 质量一般但够用，后续可换 readability。
 */

/** 结构化网络来源（对齐 PDC §9.3）。前端渲染为 EvidenceChip（web-source）。 */
export type WebSource = {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  /** 抓取/搜索时间（ISO）。函数内生成，测试只断言其为 ISO 字符串、不锁具体值。 */
  fetchedAt: string;
  sourceType?: "official" | "news" | "blog" | "docs" | "paper" | "unknown";
};

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const MAX_FETCH_REDIRECTS = 5;

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
  answer?: string;
};

/**
 * 调 Tavily Search API。query 空 / 无 key 抛错（工具层捕获转 tool error）。
 * 返回结构化 WebSource[] + 原始 answer（若有）。
 */
export async function searchWithTavily(input: {
  query: string;
  apiKey: string;
  maxResults?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ results: WebSource[]; rawAnswer?: string }> {
  const query = input.query.trim();
  if (!query) throw new Error("搜索关键词不能为空。");
  if (!input.apiKey.trim()) throw new Error("未配置 Tavily API Key。");

  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(TAVILY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: input.apiKey,
      query,
      max_results: input.maxResults ?? 6,
      search_depth: "basic",
      include_answer: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily 搜索失败（${res.status}）：${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as TavilyResponse;
  const fetchedAt = isoNow();
  const results: WebSource[] = (data.results ?? [])
    .filter((r) => typeof r.url === "string" && r.url.trim() !== "")
    .map((r) => ({
      title: String(r.title ?? r.url ?? ""),
      url: String(r.url),
      snippet:
        typeof r.content === "string" && r.content
          ? r.content.slice(0, 1000)
          : undefined,
      publishedAt:
        typeof r.published_date === "string" && r.published_date
          ? r.published_date
          : undefined,
      fetchedAt,
      sourceType: "unknown",
    }));
  return {
    results,
    rawAnswer: typeof data.answer === "string" ? data.answer : undefined,
  };
}

/** ISO now（独立函数，测试可只在必要时校验格式）。 */
function isoNow(): string {
  return new Date().toISOString();
}

/**
 * 抓取单个 URL 正文：assertSafePublicUrl（SSRF 守卫）→ fetch → HTML→text 抽取 → 截断。
 * 私网/本机/保留地址在 fetch 前被拒（不做网络请求）。
 */
export async function fetchWebPage(input: {
  url: string;
  maxChars?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ url: string; title: string; text: string; fetchedAt: string }> {
  const fetchFn = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  try {
    const { response: res, url: finalUrl } = await fetchWithSafeRedirects({
      url: input.url,
      fetchFn,
      signal: controller.signal,
      timeoutMs: input.timeoutMs ?? 15_000,
    });
    if (!res.ok) {
      throw new Error(`网页返回 HTTP ${res.status}：${finalUrl}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    const html = await res.text();
    const maxChars = input.maxChars ?? 8000;
    const looksLikeHtml =
      /html/i.test(contentType) || /<html|<!doctype html|<body|<p[\s>]/i.test(html);
    const { title, text } = looksLikeHtml ? htmlToText(html) : { title: "", text: html };
    return {
      url: finalUrl,
      title: title || finalUrl,
      text: text.length > maxChars ? text.slice(0, maxChars) : text,
      fetchedAt: isoNow(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithSafeRedirects(input: {
  url: string;
  fetchFn: typeof fetch;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<{ response: Response; url: string }> {
  let safeUrl = await assertSafePublicUrl(input.url);
  for (let redirectCount = 0; redirectCount <= MAX_FETCH_REDIRECTS; redirectCount++) {
    const res = await input.fetchFn(safeUrl, {
      headers: {
        // 用浏览器化 UA + Accept，避免很多站点/CDN 对非浏览器 UA 返回 403/空壳。
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "manual",
      signal: input.signal,
    }).catch((err: unknown) => {
      // 区分超时（abort）/ 网络 / 其它，给前端可读的错误。
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`抓取超时（${input.timeoutMs}ms）：${safeUrl}`);
      }
      throw new Error(
        `网络请求失败：${err instanceof Error ? err.message : String(err)}`
      );
    });

    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return { response: res, url: safeUrl };
    }
    const location = res.headers.get("location");
    if (!location) {
      throw new Error(`网页重定向缺少 Location：${safeUrl}`);
    }
    const redirectedUrl = new URL(location, safeUrl).toString();
    safeUrl = await assertSafePublicUrl(redirectedUrl);
  }
  throw new Error(`网页重定向次数超过 ${MAX_FETCH_REDIRECTS} 次。`);
}

/** 简单 HTML→text 抽取：去 script/style/noscript/注释/标签 → 解码常见实体 → 压空白。 */
export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
  return { title, text };
}

/** 解码常见 HTML 实体（不引 full entity 表，覆盖高频）。 */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

/** 仅供测试用的 ISO 格式校验助手。 */
export function isIsoLike(s: unknown): boolean {
  return typeof s === "string" && ISO_RE.test(s);
}
