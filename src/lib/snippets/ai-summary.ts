import { generateText } from "ai";
import { moduleLogger } from "@/lib/logger";
import { getModel } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";

const log = moduleLogger("snippets.ai-summary");

/** 送入摘要决策的最小字段集（结构兼容 prisma Snippet，多出的字段无碍）。 */
export type SnippetSummaryInput = {
  kind: string;
  content: string;
  quoteSource?: string | null;
  linkUrl?: string | null;
  linkTitle?: string | null;
  linkDescription?: string | null;
};

export type SummaryStrategy = "ai" | "copy" | "skip";

/** 生成 system prompt（verbatim，被 generateAiSummary 复用）。 */
export const AI_SUMMARY_SYSTEM =
  "你是素材整理助手。用一句不超过 30 字的中文概括以下素材的核心，直接输出概括，不要前缀、不要引号、不要解释。";

/** 输入截断上限，防超长 prompt。 */
const PROMPT_MAX_CHARS = 1000;

/** 摘要最大字数（normalize 后）。 */
const SUMMARY_MAX_CHARS = 40;

/**
 * 决策生成策略（按优先级）：
 * 1. link 且有非空 linkDescription → "copy"（直接用 OG 描述，零 AI 调用）
 * 2. image → "skip"（caption 由 content.slice 兜底）
 * 3. content 过短（<3）→ "skip"
 * 4. 其他（text/quote/无 OG 的 link）→ "ai"
 */
export function decideStrategy(s: SnippetSummaryInput): SummaryStrategy {
  if (s.kind === "link" && (s.linkDescription ?? "").trim()) return "copy";
  if (s.kind === "image") return "skip";
  if (s.content.trim().length < 3) return "skip";
  return "ai";
}

/** 拼装送给 LLM 的正文（按 kind 附加上下文），截断到 PROMPT_MAX_CHARS。 */
export function composePromptInput(s: SnippetSummaryInput): string {
  const parts: string[] = [s.content];
  if (s.kind === "quote") {
    const src = (s.quoteSource ?? "").trim();
    if (src) parts.push(`—— ${src}`);
  }
  if (s.kind === "link") {
    const where = (s.linkTitle ?? s.linkUrl ?? "").trim();
    if (where) parts.push(`链接：${where}`);
  }
  return parts.join("\n").slice(0, PROMPT_MAX_CHARS);
}

/** 成对首尾引号（中/英、双/单）。 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["“", "”"], // 中文双引号 “ ”
  ['"', '"'], // 英文双引号
  ["‘", "’"], // 中文单引号 ‘ ’
  ["'", "'"], // 英文单引号
];

/** trim → 去成对首尾引号 → 截断 ≤40 字 → 空串返 null。 */
export function normalizeAiSummary(raw: string): string | null {
  let t = (raw ?? "").trim();
  if (!t) return null;
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length >= 2 && t[0] === open && t[t.length - 1] === close) {
      t = t.slice(1, -1).trim();
      break;
    }
  }
  if (!t) return null;
  return t.slice(0, SUMMARY_MAX_CHARS);
}

/**
 * 生成单条素材的 aiSummary。
 * - "skip" → null（不调 AI）
 * - "copy" → normalize(linkDescription)
 * - "ai"   → getModel + generateText（temperature 0.3 / maxOutputTokens 60 / maxRetries 1）
 * 全程吞错：失败返 null，由调用方决定是否写回（留空则消费者回落 content.slice）。
 */
export async function generateAiSummary(
  s: SnippetSummaryInput
): Promise<string | null> {
  const strategy = decideStrategy(s);
  if (strategy === "skip") return null;
  if (strategy === "copy") return normalizeAiSummary((s.linkDescription ?? ""));
  try {
    const { model } = await getModel();
    const prompt = composePromptInput(s);
    const { text } = await generateText({
      model,
      system: AI_SUMMARY_SYSTEM,
      prompt,
      temperature: 0.3,
      maxOutputTokens: 60,
      maxRetries: 1,
    });
    return normalizeAiSummary(text);
  } catch (e) {
    log.warn({ err: e, kind: s.kind }, "生成 aiSummary 失败（留空回落 content.slice）");
    return null;
  }
}

/**
 * 加载 → 生成 → 写回 aiSummary。fire-and-forget 入口（由 POST/PATCH 的 after() 调用）。
 * 全程吞错：任何异常只 warn，不影响已返回的 201/200。
 */
export async function generateAndSaveAiSummary(
  snippetId: string
): Promise<void> {
  try {
    const s = await prisma.snippet.findUnique({ where: { id: snippetId } });
    if (!s) return;
    const aiSummary = await generateAiSummary(s);
    if (aiSummary === null) return;
    await prisma.snippet.update({
      where: { id: snippetId },
      data: { aiSummary },
    });
  } catch (e) {
    log.warn({ err: e, snippetId }, "generateAndSaveAiSummary 失败（不阻断）");
  }
}
